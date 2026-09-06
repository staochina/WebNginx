'use strict';

import {
  stripComments,
  parseBlock,
  unquote,
  parseDirectiveLine,
  normalizeServerNames,
  requireServerNames,
  ERR_SERVER_NAME_IN_SERVER,
  ERR_SERVER_NAME_WRAP_LOCATION,
  ERR_SERVER_NAME_REQUIRED,
} from './nginxText.js';

/**
 * Parse nginx-style text into a UI-friendly server/location model.
 * @param {string} input
 * @returns {Array<{serverNames: string[], locations: Array<{active: boolean, args: string, body: string}>}>}
 */
export function parseConfigModel(input) {
  if (!input || !input.trim()) {
    return [];
  }

  const lines = stripComments(input).split('\n');
  const root = parseBlock(lines, 0, { requireClose: false });
  const servers = [];

  for (const node of root.children) {
    if (node.type === 'server') {
      servers.push(serverFromNode(node));
    } else if (node.type === 'location') {
      throw new Error(ERR_SERVER_NAME_WRAP_LOCATION);
    }
  }

  return servers;
}

/**
 * Serialize UI model back to nginx-style text.
 * Inactive locations include `inactive on;` so they round-trip but are skipped by the rule engine.
 * @param {Array<{serverNames: string[], locations: Array<{active: boolean, args: string, body: string}>}>} servers
 * @returns {string}
 */
export function serializeConfigModel(servers) {
  const chunks = [];

  for (const server of servers) {
    const names = requireServerNames(
      server.serverNames,
      ERR_SERVER_NAME_REQUIRED,
    );
    const locations = server.locations || [];

    const lines = ['server {'];
    lines.push(`    server_name ${names.join(' ')};`);
    for (const loc of locations) {
      lines.push(indentBlock(formatLocation(loc), 4));
    }
    lines.push('}');
    chunks.push(lines.join('\n'));
  }

  return chunks.join('\n\n') + (chunks.length ? '\n' : '');
}

function serverFromNode(node) {
  const serverNames = [];
  const locations = [];

  for (const child of node.children) {
    if (child.type === 'directive') {
      const parsed = parseDirectiveLine(child.line);
      if (parsed.name === 'server_name') {
        serverNames.push(...normalizeServerNames(parsed.args.map(unquote)));
      }
    } else if (child.type === 'location') {
      locations.push(locationFromNode(child));
    }
  }

  return {
    serverNames: requireServerNames(serverNames, ERR_SERVER_NAME_IN_SERVER),
    locations,
  };
}

function locationFromNode(node) {
  const directiveLines = node.children
    .filter((child) => child.type === 'directive')
    .map((child) => child.line.trim().replace(/;$/, '') + ';');

  let active = true;
  const bodyLines = [];
  for (const line of directiveLines) {
    const parsed = parseDirectiveLine(line);
    if (
      parsed.name === 'inactive' &&
      (parsed.args[0] === 'on' || parsed.args.length === 0)
    ) {
      active = false;
      continue;
    }
    bodyLines.push(line);
  }

  return {
    active,
    args: (node.args || '').trim() || '/',
    body: bodyLines.join('\n'),
  };
}

function formatLocation(loc) {
  const args = (loc.args || '/').trim() || '/';
  const lines = [`location ${args} {`];
  if (!loc.active) {
    lines.push('    inactive on;');
  }
  const body = (loc.body || '').trim();
  if (body) {
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line) {
        continue;
      }
      lines.push(`    ${line.endsWith(';') ? line : `${line};`}`);
    }
  }
  lines.push('}');
  return lines.join('\n');
}

function indentBlock(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}
