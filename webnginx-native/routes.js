'use strict';

/**
 * Match an incoming request against proxy routes.
 * @param {Array<object>} routes
 * @param {string} hostHeader host or host:port
 * @param {string} pathname
 * @returns {object|null}
 */
export function matchRoute(routes, hostHeader, pathname) {
  const host = String(hostHeader || '').toLowerCase();
  const hostNoPort = host.split(':')[0];
  const path = pathname || '/';

  for (const route of routes || []) {
    const names = (route.serverNames || []).map((n) => String(n).toLowerCase());
    if (!names.includes(host) && !names.includes(hostNoPort)) {
      continue;
    }

    if (route.matchType === 'regex') {
      const flags = route.caseSensitive === false ? 'i' : '';
      let re;
      try {
        re = new RegExp(route.pattern, flags);
      } catch {
        continue;
      }
      if (
        re.test(path) ||
        re.test(`https://${host}${path}`) ||
        re.test(`http://${host}${path}`)
      ) {
        return route;
      }
      continue;
    }

    const prefix = normalizePrefix(route.pattern);
    if (prefix === '/') {
      return route;
    }
    if (path === prefix || path.startsWith(prefix)) {
      return route;
    }
  }

  return null;
}

/**
 * Build upstream URL for a matched route.
 * @param {object} route
 * @param {string} reqPath pathname + search
 * @returns {URL}
 */
export function buildUpstreamUrl(route, reqPath) {
  const raw = String(route.upstream || '').trim();
  if (!raw) {
    throw new Error('missing upstream');
  }

  const [pathname, search = ''] = String(reqPath || '/').split('?');
  const qs = search ? `?${search}` : '';

  if (route.matchType === 'regex' && /\\[0-9]/.test(raw)) {
    const flags = route.caseSensitive === false ? 'i' : '';
    const re = new RegExp(route.pattern, flags);
    const m =
      re.exec(pathname) ||
      re.exec(reqPath) ||
      re.exec(`https://host${pathname}`) ||
      null;
    let out = raw;
    if (m) {
      out = raw.replace(/\\([0-9])/g, (_, n) => m[Number(n)] ?? '');
    } else {
      out = raw.replace(/\\[0-9]/g, '');
    }
    return new URL(out.includes('://') ? out : `https://${out}`);
  }

  const absolute = raw.includes('://') ? raw : `https://${raw}`;
  const target = new URL(absolute);
  const locationPrefix = normalizePrefix(route.pattern);
  const targetPath = target.pathname || '/';

  const locNorm = locationPrefix.replace(/\/$/, '') || '';
  const tgtNorm = targetPath.replace(/\/$/, '') || '';
  const hostOnly = targetPath === '/' || (locNorm && locNorm === tgtNorm);

  if (hostOnly) {
    target.pathname = pathname;
    target.search = search;
    return target;
  }

  if (locationPrefix !== '/' && pathname.startsWith(locationPrefix)) {
    const rest = pathname.slice(locationPrefix.length);
    const destBase = targetPath.endsWith('/')
      ? targetPath.slice(0, -1)
      : targetPath;
    let nextPath = `${destBase}/${rest}`.replace(/\/{2,}/g, '/');
    if (!nextPath.startsWith('/')) {
      nextPath = `/${nextPath}`;
    }
    target.pathname = nextPath;
    target.search = search;
    return target;
  }

  target.pathname = pathname;
  target.search = search;
  return target;
}

function normalizePrefix(prefix) {
  if (!prefix || prefix === '/') {
    return '/';
  }
  return prefix.startsWith('/') ? prefix : `/${prefix}`;
}
