'use strict';

import {
  getDynamicRules,
  getGlobalSwitch,
  setDynamicRules,
  DEFAULT_NGINX_TEMPLATE,
  setDebugEnabled,
  debugLog,
} from './common.js';
import { parseConfigModel, serializeConfigModel } from './configModel.js';

/** @type {Array<{serverNames: string[], locations: Array<{active: boolean, args: string, body: string}>, collapsed?: boolean}>} */
let servers = [];

document.addEventListener('DOMContentLoaded', onload);

async function onload() {
  const manifest = chrome.runtime.getManifest();
  document.getElementById('version').textContent = manifest.version;
  document.getElementById('description').textContent = manifest.description;

  let raw = await getDynamicRules();
  if (!raw.trim()) {
    raw = DEFAULT_NGINX_TEMPLATE;
  }
  servers = parseConfigModel(raw).map((s) => ({ ...s, collapsed: true }));

  document.getElementById('btn-add-server').onclick = () => {
    servers.push({
      serverNames: ['example.com'],
      locations: [newLocation()],
      collapsed: false,
    });
    render();
  };

  document.getElementById('btn-save').onclick = save;
  document.getElementById('btn-export').onclick = exportRules;
  document.getElementById('btn-import').onclick = () => {
    document.getElementById('import-file').click();
  };
  document.getElementById('import-file').onchange = importRules;

  await refreshProxyStatus();
  document.getElementById('btn-proxy-retry')?.addEventListener('click', () => {
    refreshProxyStatus();
  });

  const debugBtn = document.getElementById('btn-debug-log');
  syncDebugButton(debugBtn, false);
  debugBtn.addEventListener('click', async function () {
    const enabled = this.getAttribute('aria-checked') !== 'true';
    console.clear();
    setDebugEnabled(enabled);
    syncDebugButton(this, enabled);
    try {
      await chrome.runtime.sendMessage({
        action: 'setDebugLog',
        value: enabled,
      });
    } catch (e) {
      console.warn('[WebNginx] failed to clear Service Worker console', e);
    }
    console.log(
      '[WebNginx]',
      'Debug Log',
      enabled ? 'ON' : 'OFF',
      '(consoles cleared; also check Service Worker)',
    );
  });

  document.querySelectorAll('.help-toc a').forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href')?.slice(1);
      const section = id && document.getElementById(id);
      if (!section || section.tagName !== 'DETAILS') {
        return;
      }
      e.preventDefault();
      section.open = true;
      section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  render();
  await refreshPreview();
}

function newLocation() {
  return {
    active: true,
    args: '/',
    body: 'proxy_pass https://example.com;',
  };
}

function syncDebugButton(btn, enabled) {
  btn.setAttribute('aria-checked', String(enabled));
  btn.classList.toggle('is-on', enabled);
}

function render() {
  const root = document.getElementById('servers');
  root.replaceChildren();

  if (servers.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent = 'No servers yet. Click “Add Server” to create one.';
    root.appendChild(empty);
    return;
  }

  servers.forEach((server, serverIndex) => {
    root.appendChild(renderServerGroup(server, serverIndex));
  });
}

function hasActiveLocation(server) {
  return (server.locations || []).some((l) => l.active !== false);
}

function renderServerGroup(server, serverIndex) {
  const group = document.createElement('section');
  group.className = 'server-group';
  if (server.collapsed) {
    group.classList.add('is-collapsed');
  }
  if (hasActiveLocation(server)) {
    group.classList.add('has-active');
  }
  group.dataset.serverIndex = String(serverIndex);

  const header = document.createElement('div');
  header.className = 'server-header';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn btn-ghost btn-sm collapse-btn';
  toggle.setAttribute('aria-expanded', String(!server.collapsed));
  toggle.textContent = server.collapsed ? '▶' : '▼';
  toggle.title = server.collapsed ? 'Expand' : 'Collapse';
  toggle.onclick = () => {
    server.collapsed = !server.collapsed;
    render();
  };

  const label = document.createElement('label');
  label.className = 'server-name-label';
  label.textContent = 'server_name';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'server-name-input';
  nameInput.value = (server.serverNames || []).join(' ');
  nameInput.placeholder = 'example.com';
  nameInput.onchange = () => {
    server.serverNames = nameInput.value
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  };

  const addLoc = document.createElement('button');
  addLoc.type = 'button';
  addLoc.className = 'btn btn-add btn-sm';
  addLoc.textContent = 'Add Location';
  addLoc.onclick = () => {
    server.locations.push(newLocation());
    server.collapsed = false;
    render();
  };

  const removeServer = document.createElement('button');
  removeServer.type = 'button';
  removeServer.className = 'btn btn-danger btn-sm';
  removeServer.textContent = 'Delete Server';
  removeServer.onclick = () => {
    if (!confirm(`Delete server “${nameInput.value || '(empty)'}”?`)) {
      return;
    }
    servers.splice(serverIndex, 1);
    render();
  };

  header.append(toggle, label, nameInput, addLoc, removeServer);
  group.appendChild(header);

  const body = document.createElement('div');
  body.className = 'server-body';
  if (server.collapsed) {
    body.hidden = true;
  }

  const table = document.createElement('table');
  table.className = 'location-table';

  const thead = document.createElement('thead');
  thead.innerHTML =
    '<tr><th class="col-drag" title="Drag to reorder">⋮⋮</th><th class="col-active">Active</th><th class="col-args">Location</th><th class="col-body">Directives</th><th class="col-actions">Actions</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  if (server.locations.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'empty-hint';
    td.textContent = 'No locations. Click “Add Location”.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    server.locations.forEach((loc, locIndex) => {
      tbody.appendChild(renderLocationRow(server, loc, locIndex));
    });
    bindLocationRowDrag(tbody, server);
  }
  table.appendChild(tbody);
  body.appendChild(table);
  group.appendChild(body);

  return group;
}

function renderLocationRow(server, loc, locIndex) {
  const tr = document.createElement('tr');
  tr.dataset.locIndex = String(locIndex);
  if (!loc.active) {
    tr.classList.add('inactive-row');
  }

  const tdDrag = document.createElement('td');
  tdDrag.className = 'col-drag';
  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.draggable = true;
  handle.title = 'Drag to reorder (lower rows have higher priority)';
  handle.textContent = '⋮⋮';
  handle.setAttribute('aria-label', 'Drag to reorder');
  tdDrag.appendChild(handle);

  const tdActive = document.createElement('td');
  tdActive.className = 'col-active';
  const active = document.createElement('input');
  active.type = 'checkbox';
  active.checked = loc.active !== false;
  active.title = 'Apply this location';
  active.onchange = () => {
    loc.active = active.checked;
    tr.classList.toggle('inactive-row', !loc.active);
    const groupEl = tr.closest('.server-group');
    if (groupEl) {
      groupEl.classList.toggle('has-active', hasActiveLocation(server));
    }
  };
  tdActive.appendChild(active);

  const tdArgs = document.createElement('td');
  tdArgs.className = 'col-args';
  const argsInput = document.createElement('input');
  argsInput.type = 'text';
  argsInput.value = loc.args || '/';
  argsInput.placeholder = '/ or ~ ^...$';
  argsInput.onchange = () => {
    loc.args = argsInput.value.trim() || '/';
  };
  tdArgs.appendChild(argsInput);

  const tdBody = document.createElement('td');
  tdBody.className = 'col-body';
  const bodyArea = document.createElement('textarea');
  bodyArea.rows = Math.max(2, (loc.body || '').split('\n').length);
  bodyArea.value = loc.body || '';
  bodyArea.placeholder = 'proxy_pass https://...;';
  bodyArea.onchange = () => {
    loc.body = bodyArea.value;
  };
  tdBody.appendChild(bodyArea);

  const tdActions = document.createElement('td');
  tdActions.className = 'col-actions';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn-danger btn-sm';
  del.textContent = 'Delete';
  del.onclick = () => {
    syncDomToModel();
    server.locations.splice(locIndex, 1);
    render();
  };
  tdActions.appendChild(del);

  tr.append(tdDrag, tdActive, tdArgs, tdBody, tdActions);
  return tr;
}

function bindLocationRowDrag(tbody, server) {
  let fromIndex = null;

  tbody.addEventListener('dragstart', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || !tbody.contains(handle)) {
      return;
    }
    const tr = handle.closest('tr');
    fromIndex = Number(tr.dataset.locIndex);
    tr.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(fromIndex));
  });

  tbody.addEventListener('dragend', () => {
    fromIndex = null;
    tbody.querySelectorAll('tr').forEach((row) => {
      row.classList.remove('dragging', 'drag-over');
    });
  });

  tbody.addEventListener('dragover', (e) => {
    const tr = e.target.closest('tr[data-loc-index]');
    if (!tr || !tbody.contains(tr) || fromIndex === null) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    tbody.querySelectorAll('tr.drag-over').forEach((row) => {
      if (row !== tr) {
        row.classList.remove('drag-over');
      }
    });
    tr.classList.add('drag-over');
  });

  tbody.addEventListener('dragleave', (e) => {
    const tr = e.target.closest('tr[data-loc-index]');
    if (!tr || tr.contains(e.relatedTarget)) {
      return;
    }
    tr.classList.remove('drag-over');
  });

  tbody.addEventListener('drop', (e) => {
    const tr = e.target.closest('tr[data-loc-index]');
    if (!tr || !tbody.contains(tr) || fromIndex === null) {
      return;
    }
    e.preventDefault();
    const toIndex = Number(tr.dataset.locIndex);
    if (fromIndex === toIndex) {
      return;
    }

    syncDomToModel();
    const [moved] = server.locations.splice(fromIndex, 1);
    server.locations.splice(toIndex, 0, moved);
    render();
  });
}

async function save() {
  syncDomToModel();
  const nginx = serializeConfigModel(servers);
  debugLog('Save and Sync', { serverCount: servers.length, bytes: nginx.length });

  try {
    const { success, preview, error } = await chrome.runtime.sendMessage({
      action: 'updateDynamicRules',
      input: nginx,
    });
    if (!success) {
      alert(`Update failed, error:${error}`);
      return;
    }

    await setDynamicRules(nginx);
    const previewPre = document.getElementById('preview');
    const ruleNumSpan = document.getElementById('rule-num');
    previewPre.textContent = JSON.stringify(preview, null, 2);
    ruleNumSpan.textContent = preview.length;
    debugLog('Save and Sync ok', { ruleCount: preview.length });
    alert(`Succeed, ${preview.length} rules saved!`);
  } catch (e) {
    alert(`${e}`);
  }
}

function exportRules() {
  syncDomToModel();
  const nginx = serializeConfigModel(servers);
  const blob = new Blob([nginx], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `webnginx-rules-${stamp}.conf`;
  a.click();
  URL.revokeObjectURL(url);
  debugLog('exported', { bytes: nginx.length, filename: a.download });
}

async function importRules(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const imported = parseConfigModel(text);
    debugLog('import parse', {
      file: file.name,
      serverCount: imported.length,
    });

    // Validate by asking background to preview (catches bad directives).
    const nginx = serializeConfigModel(imported);
    const { success, error } = await chrome.runtime.sendMessage({
      action: 'preview',
      input: nginx,
    });
    if (!success) {
      alert(`Import failed, error:${error}`);
      return;
    }

    if (
      servers.length > 0 &&
      !confirm('Import will replace the current editor content. Continue?')
    ) {
      return;
    }

    servers = imported.map((s) => ({ ...s, collapsed: true }));
    render();
    await refreshPreview();
    debugLog('import applied to editor', { serverCount: servers.length });
    alert(
      `Imported ${servers.length} server group(s). Click Save and Sync to apply.`,
    );
  } catch (e) {
    alert(`Import failed: ${e}`);
  }
}

function syncDomToModel() {
  document.querySelectorAll('.server-group').forEach((group) => {
    const serverIndex = Number(group.dataset.serverIndex);
    const server = servers[serverIndex];
    if (!server) {
      return;
    }

    const nameInput = group.querySelector('.server-name-input');
    if (nameInput) {
      server.serverNames = nameInput.value
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    }

    const rows = group.querySelectorAll('tbody tr');
    rows.forEach((row, locIndex) => {
      const loc = server.locations[locIndex];
      if (!loc) {
        return;
      }
      const checkbox = row.querySelector('input[type="checkbox"]');
      const argsInput = row.querySelector('.col-args input');
      const bodyArea = row.querySelector('.col-body textarea');
      if (checkbox) {
        loc.active = checkbox.checked;
      }
      if (argsInput) {
        loc.args = argsInput.value.trim() || '/';
      }
      if (bodyArea) {
        loc.body = bodyArea.value;
      }
    });
  });
}

async function refreshPreview() {
  const previewPre = document.getElementById('preview');
  const ruleNumSpan = document.getElementById('rule-num');
  const globalSwitch = await getGlobalSwitch();

  if (!globalSwitch) {
    previewPre.textContent = 'Rules are globally disabled';
    ruleNumSpan.textContent = 0;
    return;
  }

  const nginx = serializeConfigModel(servers);
  const { success, preview, error } = await chrome.runtime.sendMessage({
    action: 'preview',
    input: nginx,
  });
  if (!success) {
    previewPre.textContent = `Invalid rules: error:${error}`;
    ruleNumSpan.textContent = 0;
  } else {
    previewPre.textContent = JSON.stringify(preview, null, 2);
    ruleNumSpan.textContent =
      typeof preview?.length === 'number'
        ? preview.length
        : Array.isArray(preview)
          ? preview.length
          : 0;
  }
  await refreshProxyStatus();
}

async function refreshProxyStatus() {
  const statusEl = document.getElementById('proxy-status');
  const hintEl = document.getElementById('proxy-install-hint');
  const badgeEl = document.getElementById('proxy-status-badge');
  if (!statusEl || !hintEl) {
    return;
  }

  const extId = chrome.runtime.id;
  hintEl.textContent =
    `Install native host (macOS):\n` +
    `  make install-host EXT_ID=${extId}\n` +
    `Trust local CA (after first connect):\n` +
    `  make trust-ca\n` +
    `Then fully quit Chrome (Cmd+Q) and reopen.\n` +
    `Host name: com.webnginx.proxy`;

  setProxyStatusBadge(badgeEl, 'unknown');
  statusEl.textContent = 'Checking native host…';
  try {
    const { success, status, error } = await chrome.runtime.sendMessage({
      action: 'getProxyStatus',
    });
    if (!success || !status) {
      setProxyStatusBadge(badgeEl, 'off');
      statusEl.textContent = `Proxy status unavailable${error ? `: ${error}` : ''}`;
      return;
    }

    const on = !!(status.listening || status.running);
    setProxyStatusBadge(badgeEl, on ? 'on' : 'off');

    if (on) {
      statusEl.textContent =
        `Listening on 127.0.0.1:${status.listenPort}` +
        (status.lastStatus?.caPath ? ` · CA ${status.lastStatus.caPath}` : '') +
        (status.lastStatus?.routeCount != null
          ? ` · routes ${status.lastStatus.routeCount}`
          : '');
      return;
    }

    if (status.hostInstalled) {
      statusEl.textContent =
        'Native host is installed, but proxy is not listening. ' +
        'Turn the extension ON and Save and Sync a proxy_pass rule.';
      return;
    }

    statusEl.textContent =
      `Native host unavailable: ${status.error || status.lastError || 'not found'}. ` +
      `Run: make install-host EXT_ID=${extId}, then Cmd+Q quit Chrome and reopen.`;
  } catch (e) {
    setProxyStatusBadge(badgeEl, 'off');
    statusEl.textContent = `Proxy status error: ${e.message || e}`;
  }
}

function setProxyStatusBadge(badgeEl, state) {
  if (!badgeEl) {
    return;
  }
  badgeEl.classList.remove('is-on', 'is-off', 'is-unknown');
  if (state === 'on') {
    badgeEl.classList.add('is-on');
    badgeEl.textContent = 'ON';
  } else if (state === 'off') {
    badgeEl.classList.add('is-off');
    badgeEl.textContent = 'OFF';
  } else {
    badgeEl.classList.add('is-unknown');
    badgeEl.textContent = '…';
  }
}
