'use strict';

import {
  getDynamicRules,
  getGlobalSwitch,
  setDynamicRules,
  DEFAULT_NGINX_TEMPLATE,
  setDebugEnabled,
  debugLog,
  getProxyPort,
  setProxyPort,
  parseProxyPort,
  DEFAULT_PROXY_PORT,
} from './common.js';
import { parseConfigModel, serializeConfigModel } from './configModel.js';
import {
  requireServerNames,
  ERR_SERVER_NAME_REQUIRED,
} from './nginxText.js';

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

  const proxyPortInput = document.getElementById('proxy-port');
  if (proxyPortInput) {
    proxyPortInput.value = String(await getProxyPort());
  }

  const debugBtn = document.getElementById('btn-debug');
  syncDebugButton(debugBtn, false);
  debugBtn.addEventListener('click', async function () {
    const enabled = this.getAttribute('aria-checked') !== 'true';
    console.clear();
    setDebugEnabled(enabled);
    syncDebugButton(this, enabled);
    try {
      await chrome.runtime.sendMessage({
        action: 'setDebug',
        value: enabled,
      });
    } catch (e) {
      console.warn('[WebNginx] failed to clear Service Worker console', e);
    }
    console.log(
      '[WebNginx]',
      'Debug',
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
  nameInput.required = true;
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
  try {
    assertServersHaveServerName(servers);
  } catch (e) {
    alert(`${e.message || e}`);
    return;
  }
  const nginx = serializeConfigModel(servers);
  debugLog('Save and Sync', { serverCount: servers.length, bytes: nginx.length });

  try {
    const portInput = document.getElementById('proxy-port');
    const port = parseProxyPort(portInput?.value ?? DEFAULT_PROXY_PORT);
    await setProxyPort(port);
    if (portInput) {
      portInput.value = String(port);
    }

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
    debugLog('Save and Sync ok', { ruleCount: preview.length, proxyPort: port });
    await refreshProxyStatus();
    alert(`Succeed, ${preview.length} rules saved!`);
  } catch (e) {
    alert(`${e}`);
  }
}

function exportRules() {
  syncDomToModel();
  try {
    assertServersHaveServerName(servers);
  } catch (e) {
    alert(`${e.message || e}`);
    return;
  }
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
    assertServersHaveServerName(imported);
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
    alert(`Import failed: ${e.message || e}`);
  }
}

/** @param {Array<{serverNames?: string[]}>} list */
function assertServersHaveServerName(list) {
  for (let i = 0; i < list.length; i += 1) {
    try {
      requireServerNames(list[i].serverNames, ERR_SERVER_NAME_REQUIRED);
    } catch {
      throw new Error(
        `${ERR_SERVER_NAME_REQUIRED} (server group ${i + 1} is empty)`,
      );
    }
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
  const installGuide =
    `从零安装（macOS），按顺序：\n` +
    `1. chrome://extensions → 加载已解压的扩展程序 → 选 src/\n` +
    `2. 复制扩展 ID\n` +
    `3. cd webnginx-native && make install-host EXT_ID=${extId}\n` +
    `   （只注册 Native Messaging，不会生成 CA）\n` +
    `4. 在 chrome://extensions 重新加载本扩展\n` +
    `5. 本页：勾选 Active 的 proxy_pass + 弹窗总开关开启 + Save and Sync\n` +
    `   （首次 Save 会生成 ~/.webnginx/ca.crt）\n` +
    `6. cd webnginx-native && make trust-ca\n` +
    `7. Cmd+Q 完全退出 Chrome 后再打开\n` +
    `Host 名：com.webnginx.proxy`;

  setProxyStatusBadge(badgeEl, 'unknown');
  statusEl.textContent = '正在检查 Native Host…';
  try {
    const { success, status, error } = await chrome.runtime.sendMessage({
      action: 'getProxyStatus',
    });
    if (!success || !status) {
      setProxyStatusBadge(badgeEl, 'off');
      hintEl.textContent = installGuide;
      statusEl.textContent = `无法获取代理状态${error ? `：${localizeNativeError(error)}` : ''}`;
      return;
    }

    const listening = !!(status.listening || status.running);
    setProxyStatusBadge(badgeEl, listening ? 'on' : 'off');

    // Listening: never show the "Native Host 不可用" install-host error.
    if (listening) {
      hintEl.textContent =
        `连接正常，代理已在监听。\n` +
        `如需重装 Host 或信任 CA，可展开下方安装说明。\n\n` +
        installGuide;
      statusEl.textContent =
        `正在监听 127.0.0.1:${status.listenPort}` +
        (status.lastStatus?.caPath ? ` · CA ${status.lastStatus.caPath}` : '') +
        (status.lastStatus?.routeCount != null
          ? ` · 路由 ${status.lastStatus.routeCount}`
          : '');
      return;
    }

    hintEl.textContent = installGuide;

    if (status.hostInstalled || status.connected) {
      statusEl.textContent =
        'Native Host 已安装，但代理尚未监听。请打开弹窗总开关，并 Save and Sync 一条 proxy_pass 规则。';
      return;
    }

    const detail = localizeNativeError(
      status.error || status.lastError || '未找到',
    );
    statusEl.textContent =
      `Native Host 不可用：${detail}。` +
      `请在webnginx-native安装目录执行：make install-host EXT_ID=${extId}，` +
      `然后在 chrome://extensions 重新加载扩展；若仍失败，Cmd+Q 完全退出 Chrome 后再打开。`;
  } catch (e) {
    setProxyStatusBadge(badgeEl, 'off');
    hintEl.textContent = installGuide;
    statusEl.textContent = `代理状态出错：${localizeNativeError(e.message || e)}`;
  }
}

/** Map common Chrome native-messaging errors to Chinese. */
function localizeNativeError(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return '未知错误';
  }
  const lower = text.toLowerCase();
  if (lower.includes('forbidden')) {
    return '当前扩展无权访问该 Native Host（扩展 ID 与 install-host 绑定不一致）';
  }
  if (lower.includes('not found') || lower.includes('specified native messaging host')) {
    return '未找到 Native Host（尚未安装或 Host 名不匹配）';
  }
  if (lower.includes('native host has exited') || lower.includes('host has exited')) {
    return 'Native Host 已退出';
  }
  return text;
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
