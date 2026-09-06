'use strict';

/** Shared nginx-style text helpers for configModel + nginxParser. */

export const ERR_SERVER_NAME_IN_SERVER =
  'server block requires a non-empty server_name';

export const ERR_SERVER_NAME_WRAP_LOCATION =
  'server_name is required; wrap location in a server { server_name ...; } block';

export const ERR_SERVER_NAME_REQUIRED =
  'server_name is required for each server group';

/**
 * @param {string[]|undefined|null} names
 * @returns {string[]}
 */
export function normalizeServerNames(names) {
  return (names || [])
    .map((n) => String(n).trim())
    .filter(Boolean);
}

/**
 * @param {string[]|undefined|null} names
 * @param {string} [emptyMessage]
 * @returns {string[]}
 */
export function requireServerNames(
  names,
  emptyMessage = ERR_SERVER_NAME_REQUIRED,
) {
  const normalized = normalizeServerNames(names);
  if (normalized.length === 0) {
    throw new Error(emptyMessage);
  }
  return normalized;
}

/** Strip `#` comments (inactive directives are ordinary lines, not comments). */
export function stripComments(input) {
  return String(input)
    .split('\n')
    .map((line) => {
      const hash = line.indexOf('#');
      return hash >= 0 ? line.slice(0, hash) : line;
    })
    .join('\n');
}

/**
 * @param {string[]} lines
 * @param {number} startIndex
 * @param {{ requireClose?: boolean }} [opts]
 * @returns {{ children: Array<object>, index: number }}
 */
export function parseBlock(lines, startIndex, { requireClose = true } = {}) {
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

export function splitArgs(line) {
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

export function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * @param {string} line
 * @returns {{ name: string, args: string[] }}
 */
export function parseDirectiveLine(line) {
  const trimmed = line.trim().replace(/;$/, '');
  const parts = splitArgs(trimmed);
  if (parts.length === 0) {
    throw new Error(`Invalid directive: ${line}`);
  }
  return { name: parts[0], args: parts.slice(1) };
}
