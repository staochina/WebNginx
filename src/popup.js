'use strict';

import { getGlobalSwitch, getDynamicRules } from './common.js';

document.addEventListener('DOMContentLoaded', onload);

async function onload() {
  const enableSwitch = document.getElementById('enableSwitch');
  const moreSettings = document.getElementById('moreSettings');

  enableSwitch.checked = await getGlobalSwitch();

  let busy = false;
  enableSwitch.addEventListener('change', async function () {
    if (busy) {
      this.checked = !this.checked;
      return;
    }

    busy = true;
    enableSwitch.disabled = true;
    const enabled = this.checked;

    try {
      const rawRules = enabled ? await getDynamicRules() : '';
      const response = await chrome.runtime.sendMessage({
        action: 'updateGlobalSwitch',
        value: enabled,
        input: rawRules,
      });

      if (!response?.success) {
        this.checked = !enabled;
        alert(`Update failed, error: ${response?.error || 'no response'}`);
        return;
      }

      console.log(`Rule: ${response.preview.length}`);
    } catch (e) {
      this.checked = !enabled;
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
