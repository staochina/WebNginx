'use strict';

import { debugLog, getProxyPort, DEFAULT_PROXY_PORT } from './common.js';
import { NATIVE_HOST_NAME } from './nginxParser.js';
import { buildPacScript, hostsFromProxyRoutes } from './pac.js';

const NATIVE_TIMEOUT_MS = 8000;

/** @type {chrome.runtime.Port|null} */
let nativePort = null;
/** @type {number} */
let listenPort = DEFAULT_PROXY_PORT;
/** @type {object|null} */
let lastStatus = null;
/** @type {string|null} */
let lastError = null;
/** @type {number} */
let nextReqId = 1;
/** @type {Map<number, {resolve: Function, reject: Function, timer: ReturnType<typeof setTimeout>}>} */
const pending = new Map();

/**
 * Badge/UI state from a status payload.
 * ON only when the local proxy port is actually listening.
 * @param {object|null|undefined} status
 * @returns {'on'|'off'}
 */
export function deriveProxyBadge(status) {
  if (status?.listening || status?.running) {
    return 'on';
  }
  return 'off';
}

export function getProxyStatus() {
  return {
    connected: !!nativePort,
    listening: !!(lastStatus && lastStatus.running),
    running: !!(lastStatus && lastStatus.running),
    listenPort,
    lastStatus,
    lastError,
    hostName: NATIVE_HOST_NAME,
    extensionId: chrome.runtime.id,
  };
}

/**
 * Live status for Options UI.
 * Uses the persistent native port when present; otherwise reports hostInstalled
 * via one-shot ping without treating that as ON.
 * @returns {Promise<object>}
 */
export async function queryProxyStatus() {
  if (nativePort) {
    try {
      const status = await sendNative({ type: 'getStatus' });
      lastStatus = status;
      lastError = null;
      listenPort = status.port || DEFAULT_PROXY_PORT;
      return {
        connected: true,
        listening: !!status.running,
        running: !!status.running,
        listenPort,
        lastStatus: status,
        hostInstalled: true,
        hostName: NATIVE_HOST_NAME,
        extensionId: chrome.runtime.id,
      };
    } catch (error) {
      lastError = error.message;
      nativePort = null;
    }
  }

  const installed = await probeHostInstalled();
  const configuredPort = await getProxyPort();
  return {
    connected: false,
    listening: false,
    running: false,
    listenPort: configuredPort,
    lastStatus: installed.response || null,
    lastError: installed.error || lastError,
    hostInstalled: installed.ok,
    error: installed.error,
    hostName: NATIVE_HOST_NAME,
    extensionId: chrome.runtime.id,
  };
}

/**
 * One-shot: can Chrome launch the native host at all?
 * Does NOT mean the proxy port is listening.
 */
function probeHostInstalled() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(
        NATIVE_HOST_NAME,
        { type: 'ping', id: 0 },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              ok: false,
              error: chrome.runtime.lastError.message,
              response: null,
            });
            return;
          }
          resolve({ ok: true, error: null, response });
        },
      );
    } catch (error) {
      resolve({ ok: false, error: error.message, response: null });
    }
  });
}

/**
 * Apply or clear transparent proxy based on routes.
 * @param {Array<object>|null} proxyRoutes
 */
export async function applyTransparentProxy(proxyRoutes) {
  const routes = proxyRoutes || [];
  if (routes.length === 0) {
    await clearTransparentProxy();
    return { mode: 'off', routes: 0 };
  }

  await ensureNativeConnected();
  const configuredPort = await getProxyPort();
  const response = await sendNative({
    type: 'setRoutes',
    routes,
    listenPort: configuredPort,
  });
  listenPort = response.port || configuredPort;
  lastStatus = response;
  lastError = null;

  const hosts = hostsFromProxyRoutes(routes);
  const pac = buildPacScript(hosts, listenPort);
  await setPacScript(pac);
  debugLog('PAC applied', { hosts, listenPort, routeCount: routes.length });
  return { mode: 'pac', routes: routes.length, hosts, listenPort };
}

export async function clearTransparentProxy() {
  await clearProxySettings();
  if (nativePort) {
    await sendNative({ type: 'setRoutes', routes: [] }).catch(() => {});
    try {
      nativePort.disconnect();
    } catch {
      /* ignore */
    }
    nativePort = null;
  }
  lastStatus = null;
  return { mode: 'off' };
}

function ensureNativeConnected() {
  if (nativePort) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    try {
      nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    } catch (error) {
      lastError = error.message;
      reject(
        new Error(
          `Native host not found (${NATIVE_HOST_NAME}). ` +
            `In webnginx-native/ run: make install-host EXT_ID=${chrome.runtime.id} ` +
            `then fully quit Chrome (Cmd+Q) and reopen. Original: ${error.message}`,
        ),
      );
      return;
    }

    nativePort.onMessage.addListener((msg) => {
      if (msg && typeof msg.id === 'number' && pending.has(msg.id)) {
        const entry = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.ok === false) {
          entry.reject(new Error(msg.error || 'native host error'));
        } else {
          entry.resolve(msg);
        }
        return;
      }
      if (msg?.type === 'status') {
        lastStatus = msg;
      }
    });

    nativePort.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError?.message || 'native host disconnected';
      lastError = err;
      debugLog('native host disconnected', err);
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(err));
      }
      pending.clear();
      nativePort = null;
      lastStatus = null;
    });

    sendNative({ type: 'ping' })
      .then((msg) => {
        lastStatus = msg;
        lastError = null;
        resolve();
      })
      .catch((error) => {
        lastError = error.message;
        try {
          nativePort?.disconnect();
        } catch {
          /* ignore */
        }
        nativePort = null;
        reject(error);
      });
  });
}

function sendNative(payload) {
  if (!nativePort) {
    return Promise.reject(new Error('Native host not connected'));
  }
  const id = nextReqId;
  nextReqId += 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Native host timeout (${payload.type})`));
    }, NATIVE_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    try {
      nativePort.postMessage({ ...payload, id });
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(error);
    }
  });
}

function setPacScript(data) {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.set(
      {
        value: {
          mode: 'pac_script',
          pacScript: { data, mandatory: false },
        },
        scope: 'regular',
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      },
    );
  });
}

function clearProxySettings() {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.clear({ scope: 'regular' }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}
