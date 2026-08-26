'use strict';

/**
 * Parse nginx-style text into a UI-friendly server/location model.
 * @param {string} input
 * @returns {Array<{serverNames: string[], locations: Array<{active: boolean, args: string, body: string}>}>}
 */
export function parseConfigModel(input) {
  if (!input || !input.trim()) {
    return [];
  }

  const lines = stripCommentsKeepInactive(input).split('\n');
  const root = parseBlock(lines, 0, { requireClose: false });
  const servers = [];
  const globalLocations = [];

  for (const node of root.children) {
    if (node.type === 'server') {
      servers.push(serverFromNode(node));
    } else if (node.type === 'location') {
      globalLocations.push(locationFromNode(node));
    }
  }

  if (globalLocations.length > 0) {
    servers.unshift({ serverNames: [], locations: globalLocations });
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
    const names = (server.serverNames || []).map((n) => n.trim()).filter(Boolean);
    const locations = server.locations || [];
    if (names.length === 0) {
      for (const loc of locations) {
        chunks.push(formatLocation(loc));
      }
      continue;
    }

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
        serverNames.push(...parsed.args.map(unquote));
      }
    } else if (child.type === 'location') {
      locations.push(locationFromNode(child));
    }
  }

  return { serverNames, locations };
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

function stripCommentsKeepInactive(input) {
  return input
    .split('\n')
    .map((line) => {
      const hash = line.indexOf('#');
      return hash >= 0 ? line.slice(0, hash) : line;
    })
    .join('\n');
}

function parseBlock(lines, startIndex, { requireClose = true } = {}) {
  const children = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i].trim();
    i += 1;

    if (!line) {
      continue;
    }

    if (line === '}') {
      return { children, index: i };
    }

    const blockMatch = line.match(/^(\w+)\s*(.*)\{$/);
    if (blockMatch) {
      const [, type, args] = blockMatch;
      const inner = parseBlock(lines, i);
      i = inner.index;
      children.push({ type, args: args.trim(), children: inner.children });
      continue;
    }

    children.push({ type: 'directive', line });
  }

  if (!requireClose) {
    return { children, index: i };
  }

  throw new Error('Unclosed block, missing "}"');
}

function parseDirectiveLine(line) {
  const trimmed = line.trim().replace(/;$/, '');
  const parts = splitArgs(trimmed);
  if (parts.length === 0) {
    throw new Error(`Invalid directive: ${line}`);
  }
  return { name: parts[0], args: parts.slice(1) };
}

function splitArgs(line) {
  const tokens = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
