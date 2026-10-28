'use strict';

import { getGlobalSwitch, getDynamicRules } from './common.js';

document.addEventListener('DOMContentLoaded', onload);

function syncBrandIcon(enabled) {
  const brandIcon = document.getElementById('brandIcon');
  if (brandIcon) {
    brandIcon.src = enabled ? 'img/wn.svg' : 'img/wn-off.svg';
  }
}

async function onload() {
  const enableSwitch = document.getElementById('enableSwitch');
  const moreSettings = document.getElementById('moreSettings');

  const enabled = await getGlobalSwitch();
  enableSwitch.checked = enabled;
  syncBrandIcon(enabled);

  let busy = false;
  enableSwitch.addEventListener('change', async function () {
    if (busy) {
      this.checked = !this.checked;
      return;
    }

    busy = true;
    enableSwitch.disabled = true;
    const nextEnabled = this.checked;
    syncBrandIcon(nextEnabled);

    try {
      const rawRules = nextEnabled ? await getDynamicRules() : '';
      const response = await chrome.runtime.sendMessage({
        action: 'updateGlobalSwitch',
        value: nextEnabled,
        input: rawRules,
      });

      if (!response?.success) {
        this.checked = !nextEnabled;
        syncBrandIcon(!nextEnabled);
        alert(`Update failed, error: ${response?.error || 'no response'}`);
        return;
      }

      console.log(`Rule: ${response.preview?.length ?? 0}`);
    } catch (e) {
      this.checked = !nextEnabled;
      syncBrandIcon(!nextEnabled);
      alert(`${e}`);
    } finally {
      enableSwitch.disabled = false;
      busy = false;
    }
  });

  moreSettings.addEventListener('click', function (e) {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}
