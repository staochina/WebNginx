'use strict';

import {
  stripComments,
  parseBlock,
  unquote,
  parseDirectiveLine,
  normalizeServerNames,
  ERR_SERVER_NAME_IN_SERVER,
  ERR_SERVER_NAME_WRAP_LOCATION,
} from './nginxText.js';

const RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'media',
  'websocket',
];

/** proxy_pass redirects omit main_frame so a dead target cannot rewrite the tab URL. */
const PROXY_PASS_RESOURCE_TYPES = RESOURCE_TYPES.filter((t) => t !== 'main_frame');

/** Injected on proxy_pass destinations so XHR after redirect can pass CORS. */
const PROXY_PASS_CORS_HEADERS = [
  { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
  {
    header: 'Access-Control-Allow-Methods',
    operation: 'set',
    value: 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS',
  },
  { header: 'Access-Control-Allow-Headers', operation: 'set', value: '*' },
  { header: 'Access-Control-Expose-Headers', operation: 'set', value: '*' },
];

/** Host name used by chrome.proxy PAC / native messaging. */
export const NATIVE_HOST_NAME = 'com.webnginx.proxy';

/**
 * Parse nginx-style config into declarativeNetRequest rule objects.
 * @param {string} input
 * @returns {Array<object>}
 */
export function parseNginxConfig(input) {
  return parseWebNginxConfig(input).dnrRules;
}

/**
 * Parse nginx-style config into DNR rules and transparent proxy routes.
 * Locations with server_name + proxy_pass (no rewrite/return) become proxyRoutes.
 * @param {string} input
 * @returns {{ dnrRules: Array<object>, proxyRoutes: Array<object> }}
 */
export function parseWebNginxConfig(input) {
  if (!input || !input.trim()) {
    return { dnrRules: [], proxyRoutes: [] };
  }

  const lines = stripComments(input).split('\n');
  // Root has no wrapping braces; nested blocks still require matching "}".
  const root = parseBlock(lines, 0, { requireClose: false });
  const locations = flattenLocations(root.children);

  const dnrRules = [];
  const proxyRoutes = [];
  let id = 0;

  for (const loc of locations) {
    if (loc.inactive) {
      continue;
    }

    const route = tryExtractProxyRoute(loc);
    if (route) {
      proxyRoutes.push(route);
      continue;
    }

    const emitted = locationToRules(loc, () => {
      id += 1;
      return id;
    });
    dnrRules.push(...emitted);
  }

  return { dnrRules, proxyRoutes };
}

/**
 * @param {object} location
 * @returns {object|null}
 */
function tryExtractProxyRoute(location) {
  if (!location.serverNames || location.serverNames.length === 0) {
    return null;
  }

  const names = location.directives.map((d) => d.name);
  if (!names.includes('proxy_pass')) {
    return null;
  }
  // rewrite / return stay on the DNR path.
  if (names.includes('rewrite') || names.includes('return')) {
    return null;
  }

  const proxyPass = location.directives.find((d) => d.name === 'proxy_pass');
  const upstream = unquote(proxyPass.args.join(' ').trim());
  if (!upstream) {
    throw new Error('proxy_pass requires a target URL');
  }

  const proxySetHeaders = [];
  const addHeaders = [];
  for (const directive of location.directives) {
    if (directive.name === 'proxy_set_header') {
      const h = parseHeaderDirective(directive.args, 'set');
      proxySetHeaders.push({ header: h.header, value: h.value });
    } else if (directive.name === 'add_header') {
      const h = parseHeaderDirective(directive.args, 'append');
      addHeaders.push({ header: h.header, value: h.value });
    } else if (
      directive.name !== 'proxy_pass' &&
      directive.name !== 'inactive'
    ) {
      throw new Error(
        `Unsupported directive '${directive.name}' in location ${location.pattern}`,
      );
    }
  }

  return {
    serverNames: [...location.serverNames],
    matchType: location.matchType,
    pattern: location.pattern,
    caseSensitive: location.caseSensitive !== false,
    upstream,
    proxySetHeaders,
    addHeaders,
  };
}

function flattenLocations(nodes, context = {}) {
  const locations = [];

  for (const node of nodes) {
    if (node.type === 'server') {
      const serverContext = { ...context, serverNames: [] };
      for (const child of node.children) {
        if (child.type === 'directive') {
          const parsed = parseDirective(child.line);
          if (parsed.name === 'server_name') {
            serverContext.serverNames = normalizeServerNames(
              parsed.args.map(unquote),
            );
          }
        }
      }
      if (serverContext.serverNames.length === 0) {
        throw new Error(ERR_SERVER_NAME_IN_SERVER);
      }
      locations.push(...flattenLocations(node.children, serverContext));
      continue;
    }

    if (node.type === 'location') {
      const names = context.serverNames || [];
      if (names.length === 0) {
        throw new Error(ERR_SERVER_NAME_WRAP_LOCATION);
      }
      locations.push(buildLocation(node, context));
    }
  }

  return locations;
}

function buildLocation(node, context) {
  const match = parseLocationMatch(node.args);
  const directives = node.children
    .filter((child) => child.type === 'directive')
    .map((child) => parseDirective(child.line));

  const inactive = directives.some(
    (d) => d.name === 'inactive' && (d.args[0] === 'on' || d.args.length === 0),
  );

  return {
    ...match,
    serverNames: context.serverNames || [],
    directives: directives.filter((d) => d.name !== 'inactive'),
    inactive,
  };
}

function parseLocationMatch(args) {
  const trimmed = args.trim();
  if (!trimmed) {
    throw new Error('location block requires a match pattern');
  }

  if (trimmed.startsWith('~*')) {
    return {
      matchType: 'regex',
      pattern: unquote(trimmed.slice(2).trim()),
      caseSensitive: false,
    };
  }

  if (trimmed.startsWith('~')) {
    return {
      matchType: 'regex',
      pattern: unquote(trimmed.slice(1).trim()),
      caseSensitive: true,
    };
  }

  return { matchType: 'prefix', pattern: unquote(trimmed) };
}

function parseDirective(line) {
  return { ...parseDirectiveLine(line), raw: line.trim() };
}

function buildCondition(location, regexOverride) {
  const condition = { resourceTypes: RESOURCE_TYPES };

  if (regexOverride || location.matchType === 'regex') {
    condition.regexFilter = regexOverride || location.pattern;
    if (location.caseSensitive === false) {
      condition.isUrlFilterCaseSensitive = false;
    }
    return condition;
  }

  const prefix = location.pattern;
  const domains = location.serverNames;

  if (domains.length === 1) {
    condition.urlFilter = buildUrlFilter(domains[0], prefix);
  } else if (domains.length > 1) {
    condition.requestDomains = domains;
    if (prefix && prefix !== '/') {
      condition.urlFilter = `*${normalizePrefix(prefix)}*`;
    }
  } else if (prefix.startsWith('http://') || prefix.startsWith('https://')) {
    condition.urlFilter = `${prefix}*`;
  } else if (prefix.includes('.')) {
    condition.urlFilter = buildUrlFilter(prefix, '/');
  } else {
    condition.urlFilter = `*${normalizePrefix(prefix)}*`;
  }

  return condition;
}

function buildUrlFilter(domain, prefix) {
  const normalizedPrefix = normalizePrefix(prefix);
  if (normalizedPrefix === '/') {
    return `||${domain}/`;
  }
  return `||${domain}${normalizedPrefix}`;
}

function normalizePrefix(prefix) {
  if (!prefix || prefix === '/') {
    return '/';
  }
  return prefix.startsWith('/') ? prefix : `/${prefix}`;
}

function locationToRules(location, nextId) {
  const condition = buildCondition(location);
  const rules = [];

  let redirect = null;
  let redirectFromProxyPass = false;
  let regexOverride = null;
  const requestHeaders = [];
  const responseHeaders = [];
  let block = false;

  for (const directive of location.directives) {
    switch (directive.name) {
      case 'proxy_pass':
        redirect = parseProxyPass(directive.args.join(' '), location);
        redirectFromProxyPass = true;
        if (redirect.regexOverride) {
          regexOverride = redirect.regexOverride;
        }
        break;
      case 'rewrite': {
        const rewrite = parseRewrite(directive.args);
        redirect = rewrite;
        redirectFromProxyPass = false;
        regexOverride = rewrite.regexFilter;
        break;
      }
      case 'proxy_set_header':
        requestHeaders.push(parseHeaderDirective(directive.args, 'set'));
        break;
      case 'add_header':
        responseHeaders.push(parseHeaderDirective(directive.args, 'append'));
        break;
      case 'return': {
        const code = directive.args[0];
        if (code === '403' || code === '444') {
          block = true;
        } else {
          throw new Error(
            `Unsupported return code '${code}', only 403 and 444 are supported`,
          );
        }
        break;
      }
      case 'inactive':
        break;
      default:
        throw new Error(
          `Unsupported directive '${directive.name}' in location ${location.pattern}`,
        );
    }
  }

  const finalCondition = regexOverride
    ? buildCondition(location, regexOverride)
    : condition;

  if (block) {
    rules.push(makeRule(nextId(), { type: 'block' }, finalCondition));
    return rules;
  }

  if (redirect) {
    const redirectCondition = redirectFromProxyPass
      ? {
          ...finalCondition,
          resourceTypes: PROXY_PASS_RESOURCE_TYPES,
          // Preflight must not follow redirects (browser CORS rule).
          excludedRequestMethods: ['options'],
        }
      : finalCondition;
    rules.push(
      makeRule(
        nextId(),
        { type: 'redirect', redirect: redirect.payload },
        redirectCondition,
      ),
    );

    if (redirectFromProxyPass && redirect.destination) {
      const corsHeaders = mergeCorsHeaders(responseHeaders);
      rules.push(
        makeRule(
          nextId(),
          { type: 'modifyHeaders', responseHeaders: corsHeaders },
          buildDestinationCondition(redirect.destination),
        ),
      );
      // User add_header already applied on destination via merge; skip duplicate below.
      responseHeaders.length = 0;
    }
  }

  if (requestHeaders.length > 0 || responseHeaders.length > 0) {
    const action = { type: 'modifyHeaders' };
    attachHeaders(action, requestHeaders, responseHeaders);
    rules.push(makeRule(nextId(), action, finalCondition));
  }

  if (rules.length > 0) {
    return rules;
  }

  throw new Error(
    `location '${location.pattern}' has no supported directives (proxy_pass, rewrite, headers, return)`,
  );
}

function makeRule(id, action, condition) {
  return { id, priority: id, action, condition: { ...condition } };
}

function attachHeaders(action, requestHeaders, responseHeaders) {
  if (requestHeaders.length > 0) {
    action.requestHeaders = requestHeaders;
  }
  if (responseHeaders.length > 0) {
    action.responseHeaders = responseHeaders;
  }
}

function buildDestinationCondition(targetUrl) {
  const host = targetUrl.host;
  const path = targetUrl.pathname || '/';
  return {
    resourceTypes: PROXY_PASS_RESOURCE_TYPES,
    urlFilter: path === '/' ? `||${host}/` : `||${host}${path}`,
  };
}

function mergeCorsHeaders(userResponseHeaders) {
  const merged = [...PROXY_PASS_CORS_HEADERS];
  for (const header of userResponseHeaders) {
    const idx = merged.findIndex(
      (h) => h.header.toLowerCase() === header.header.toLowerCase(),
    );
    if (idx >= 0) {
      merged[idx] = header;
    } else {
      merged.push(header);
    }
  }
  return merged;
}

function parseProxyPass(target, location) {
  const value = unquote(target.trim());
  if (!value) {
    throw new Error('proxy_pass requires a target URL');
  }

  if (location.matchType === 'regex') {
    let destination = null;
    try {
      // Best-effort host for CORS rule when substitution is an absolute URL template.
      const abs = value.includes('://') ? value.replace(/\\[0-9]/g, '') : '';
      if (abs) {
        destination = new URL(abs);
      }
    } catch {
      destination = null;
    }
    return {
      payload: {
        regexSubstitution: value,
      },
      destination,
    };
  }

  const absolute = value.includes('://') ? value : `https://${value}`;
  const targetUrl = new URL(absolute);
  const transform = {
    scheme: targetUrl.protocol.replace(':', ''),
    host: targetUrl.hostname,
  };

  if (targetUrl.port) {
    transform.port = targetUrl.port;
  }

  const locationPrefix = normalizePrefix(location.pattern);
  const targetPath = targetUrl.pathname || '/';
  const locNorm = locationPrefix.replace(/\/$/, '') || '';
  const tgtNorm = targetPath.replace(/\/$/, '') || '';

  // No path in proxy_pass, or same path as location → keep full request path (host only).
  // Fixes wiping `/svr/otb/cube/...` down to `/svr/otb` when path was set as a fixed transform.
  const hostOnly =
    targetPath === '/' ||
    (location.serverNames.length === 1 && locNorm === tgtNorm);

  if (hostOnly) {
    return { payload: { transform }, destination: targetUrl };
  }

  // Prefix rewrite: replace location prefix with proxy_pass path, keep the remainder.
  if (location.serverNames.length === 1 && locationPrefix !== '/') {
    const domain = location.serverNames[0];
    const escaped = locationPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const destBase = targetPath.endsWith('/')
      ? targetPath.slice(0, -1)
      : targetPath;
    return {
      payload: {
        transform: {
          ...transform,
          path: `${destBase}/\\1`,
        },
      },
      regexOverride: `^https?://${domain.replace(/\./g, '\\.')}${escaped}(.*)$`,
      destination: targetUrl,
    };
  }

  return { payload: { transform }, destination: targetUrl };
}

function parseRewrite(args) {
  if (args.length < 2) {
    throw new Error(`Invalid rewrite directive: ${args.join(' ')}`);
  }

  const pattern = unquote(args[0]);
  const replacement = unquote(args[1]);
  const flags = args[2] || '';

  if (flags && flags !== 'break' && flags !== 'last' && flags !== 'redirect') {
    throw new Error(`Unsupported rewrite flag '${flags}'`);
  }

  return {
    payload: {
      regexSubstitution: replacement,
    },
    regexFilter: pattern,
  };
}

function parseHeaderDirective(args, operation) {
  if (args.length < 2) {
    throw new Error(`Header directive requires name and value: ${args.join(' ')}`);
  }

  const header = args[0];
  const value = args.slice(1).join(' ');

  return {
    header,
    operation,
    value: unquote(value),
  };
}
