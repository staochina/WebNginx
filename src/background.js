'use strict';

import {
  getDynamicRules,
  getGlobalSwitch,
  setGlobalSwitch,
  setDebugEnabled,
  debugLog,
} from './common.js';
import { parseNginxConfig } from './nginxParser.js';

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
  if (request.action === 'setDebugLog') {
    console.clear();
    setDebugEnabled(!!request.value);
    console.log(
      '[WebNginx]',
      'Debug Log',
      request.value ? 'ON' : 'OFF',
      '(console cleared on toggle)',
    );
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'updateDynamicRules') {
    runExclusive(async () => {
      const globalSwitch = await getGlobalSwitch();
      debugLog('updateDynamicRules', {
        globalSwitch,
        inputLength: (request.input || '').length,
      });
      if (globalSwitch) {
        return updateDynamicRules(request.input);
      }
      const preview = parseNginxConfig(request.input);
      debugLog('global off — preview only', { ruleCount: preview.length });
      return preview;
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
      const rules = parseNginxConfig(request.input);
      debugLog('preview', { ruleCount: rules.length });
      sendResponse({ success: true, preview: rules });
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
      const ret = await updateDynamicRules(input);
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
    await updateDynamicRules(globalSwitch ? await getDynamicRules() : null);
    debugLog('initialized', { globalSwitch });
  } catch (error) {
    console.error('[WebNginx] Error during initialization:', error);
  }
});

async function updateDynamicRules(input) {
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  const oldRuleIds = oldRules.map((rule) => rule.id);
  const newRules = parseNginxConfig(input);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRuleIds,
    addRules: newRules,
  });
  debugLog('DNR updated', {
    removed: oldRuleIds.length,
    added: newRules.length,
    rules: newRules,
  });
  return newRules;
}
