'use strict';

const MAX_KEYS = 9;
const CHUNK_SIZE = 7000;

export async function getDynamicRules() {
  const ruleKeys = Array.from({ length: MAX_KEYS }, (_, i) =>
    i === 0 ? 'rules' : `rules${i + 1}`,
  );
  const defaults = Object.fromEntries(ruleKeys.map((key) => [key, '']));
  const data = await chrome.storage.sync.get(defaults);
  return ruleKeys.map((key) => data[key]).join('');
}

export async function setDynamicRules(value) {
  if (value.length > MAX_KEYS * CHUNK_SIZE) {
    throw new Error(
      `Rule length is too large, max: ${MAX_KEYS * CHUNK_SIZE}, current: ${value.length}`,
    );
  }

  const parts = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    parts.push(value.slice(i, i + CHUNK_SIZE));
  }

  const obj = Array.from({ length: MAX_KEYS }).reduce((acc, _, i) => {
    const key = i === 0 ? 'rules' : `rules${i + 1}`;
    acc[key] = parts[i] || '';
    return acc;
  }, {});

  await chrome.storage.sync.set(obj);
}

export async function getGlobalSwitch() {
  const data = await chrome.storage.sync.get({ globalSwitch: true });
  return data.globalSwitch;
}

export async function setGlobalSwitch(value) {
  await chrome.storage.sync.set({ globalSwitch: value });
}

export const DEFAULT_PROXY_PORT = 17890;

export function parseProxyPort(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid proxy port: ${value} (use 1–65535)`);
  }
  return n;
}

export async function getProxyPort() {
  const data = await chrome.storage.sync.get({ proxyPort: DEFAULT_PROXY_PORT });
  try {
    return parseProxyPort(data.proxyPort);
  } catch {
    return DEFAULT_PROXY_PORT;
  }
}

export async function setProxyPort(value) {
  const port = parseProxyPort(value);
  await chrome.storage.sync.set({ proxyPort: port });
  return port;
}

/** Debug Mode: in-memory only (per JS context). When on, debugLog prints to console. */
let debugEnabled = false;

export function setDebugEnabled(value) {
  debugEnabled = !!value;
}

export function debugLog(...args) {
  if (debugEnabled) {
    console.log('[WebNginx]', ...args);
  }
}

export const DEFAULT_NGINX_TEMPLATE = `# Nginx-style rules. server_name is required.
# Pure proxy_pass → local MITM; rewrite/return/headers → DNR.
# Sample location is inactive — enable Active and Save to apply.

server {
    server_name www.abcd.com;
    location / {
        inactive on;
        proxy_pass http://127.0.0.1:8080;
    }
}
`;
