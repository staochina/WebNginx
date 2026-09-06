'use strict';

import {
  getDynamicRules,
  getGlobalSwitch,
  setGlobalSwitch,
  setDebugEnabled,
  debugLog,
} from './common.js';
import { parseWebNginxConfig } from './nginxParser.js';
import {
  applyTransparentProxy,
  clearTransparentProxy,
  getProxyStatus,
  queryProxyStatus,
} from './proxyController.js';

const isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;

if (!isFirefox) {
  chrome.declarativeNetRequest.setExtensionActionOptions({
    displayActionCountAsBadgeText: true,
  });
}

/** Serialize DNR/icon/switch updates so init and popup messages cannot race. */
let applyQueue = Promise.resolve();

function runExclusive(task) {
  const next = applyQueue.then(task, task);
  applyQueue = next.catch(() => {});
  return next;
}

if (chrome.declarativeNetRequest?.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    debugLog('rule matched', {
      ruleId: info.rule?.ruleId,
      rulesetId: info.rule?.rulesetId,
      url: info.request?.url,
      method: info.request?.method,
      type: info.request?.type,
      tabId: info.request?.tabId,
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'setDebug') {
    console.clear();
    setDebugEnabled(!!request.value);
    console.log(
      '[WebNginx]',
      'Debug',
      request.value ? 'ON' : 'OFF',
      '(console cleared on toggle)',
    );
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'getProxyStatus') {
    runExclusive(async () => {
      // Re-apply routes after SW sleep so status matches a live listening proxy.
      const globalSwitch = await getGlobalSwitch();
      if (globalSwitch) {
        const input = await getDynamicRules();
        const parsed = parseWebNginxConfig(input || '');
        if (parsed.proxyRoutes.length > 0) {
          await applyTransparentProxy(parsed.proxyRoutes);
        } else {
          await clearTransparentProxy();
        }
      }
      return queryProxyStatus();
    })
      .then((status) => {
        sendResponse({ success: true, status });
      })
      .catch(async (error) => {
        debugLog('getProxyStatus failed', error.message);
        const status = await queryProxyStatus().catch(() => getProxyStatus());
        sendResponse({
          success: true,
          status: {
            ...status,
            connected: false,
            listening: false,
            running: false,
            error: error.message,
            lastError: error.message,
          },
        });
      });
    return true;
  }

  if (request.action === 'updateDynamicRules') {
    runExclusive(async () => {
      const globalSwitch = await getGlobalSwitch();
      debugLog('updateDynamicRules', {
        globalSwitch,
        inputLength: (request.input || '').length,
      });
      if (globalSwitch) {
        return updateRules(request.input);
      }
      const parsed = parseWebNginxConfig(request.input);
      debugLog('global off — preview only', {
        dnr: parsed.dnrRules.length,
        proxyRoutes: parsed.proxyRoutes.length,
      });
      return previewPayload(parsed);
    })
      .then((ret) => {
        sendResponse({ success: true, preview: ret });
      })
      .catch((error) => {
        debugLog('updateDynamicRules failed', error.message);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'preview') {
    try {
      const parsed = parseWebNginxConfig(request.input);
      debugLog('preview', {
        dnr: parsed.dnrRules.length,
        proxyRoutes: parsed.proxyRoutes.length,
      });
      sendResponse({ success: true, preview: previewPayload(parsed) });
    } catch (error) {
      debugLog('preview failed', error.message);
      sendResponse({ success: false, error: error.message });
    }
    return;
  }

  if (request.action === 'updateGlobalSwitch') {
    runExclusive(async () => {
      await setGlobalSwitch(!!request.value);
      const input = request.value
        ? request.input || (await getDynamicRules())
        : null;
      debugLog('updateGlobalSwitch', { enabled: !!request.value });
      const ret = await updateRules(input);
      const iconPath = request.value ? 'img/48.png' : 'img/off.png';
      await chrome.action.setIcon({ path: iconPath });
      return ret;
    })
      .then((ret) => {
        sendResponse({ success: true, preview: ret });
      })
      .catch((error) => {
        debugLog('updateGlobalSwitch failed', error.message);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

runExclusive(async () => {
  try {
    const globalSwitch = await getGlobalSwitch();
    const iconPath = globalSwitch ? 'img/48.png' : 'img/off.png';
    await chrome.action.setIcon({ path: iconPath });
    await updateRules(globalSwitch ? await getDynamicRules() : null);
    debugLog('initialized', { globalSwitch });
  } catch (error) {
    console.error('[WebNginx] Error during initialization:', error);
  }
});

function previewPayload(parsed) {
  return {
    dnrRules: parsed.dnrRules,
    proxyRoutes: parsed.proxyRoutes,
    length: parsed.dnrRules.length + parsed.proxyRoutes.length,
  };
}

async function updateRules(input) {
  if (!input || !String(input).trim()) {
    await replaceDnrRules([]);
    await clearTransparentProxy();
    return previewPayload({ dnrRules: [], proxyRoutes: [] });
  }

  const parsed = parseWebNginxConfig(input);
  await replaceDnrRules(parsed.dnrRules);

  try {
    await applyTransparentProxy(parsed.proxyRoutes);
  } catch (error) {
    if (parsed.proxyRoutes.length > 0) {
      throw new Error(
        `Transparent proxy failed: ${error.message}`,
      );
    }
    await clearTransparentProxy();
  }

  debugLog('rules updated', {
    dnr: parsed.dnrRules.length,
    proxyRoutes: parsed.proxyRoutes.length,
    proxy: getProxyStatus(),
  });
  return previewPayload(parsed);
}

async function replaceDnrRules(newRules) {
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  const oldRuleIds = oldRules.map((rule) => rule.id);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRuleIds,
    addRules: newRules,
  });
  debugLog('DNR updated', {
    removed: oldRuleIds.length,
    added: newRules.length,
    rules: newRules,
  });
}
