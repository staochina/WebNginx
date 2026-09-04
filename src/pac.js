'use strict';

/**
 * Build a PAC script that sends listed hosts through a local HTTP proxy.
 * @param {string[]} serverNames
 * @param {number} port
 * @returns {string}
 */
export function buildPacScript(serverNames, port) {
  const hosts = [...new Set((serverNames || []).map((h) => h.trim()).filter(Boolean))];
  const proxy = `PROXY 127.0.0.1:${Number(port)}`;

  if (hosts.length === 0) {
    return `function FindProxyForURL(url, host) {\n  return "DIRECT";\n}\n`;
  }

  const checks = hosts
    .map((name) => {
      const escaped = JSON.stringify(name);
      if (name.includes(':')) {
        return (
          `  if (url.indexOf("://" + ${escaped} + "/") !== -1 || ` +
          `url.indexOf("://" + ${escaped} + "?") !== -1 || ` +
          `shExpMatch(url, "*://" + ${escaped})) return proxy;`
        );
      }
      return `  if (host === ${escaped}) return proxy;`;
    })
    .join('\n');

  return (
    `function FindProxyForURL(url, host) {\n` +
    `  var proxy = ${JSON.stringify(proxy)};\n` +
    `${checks}\n` +
    `  return "DIRECT";\n` +
    `}\n`
  );
}

/**
 * Collect unique server_name values from proxy routes.
 * @param {Array<{serverNames?: string[]}>} proxyRoutes
 * @returns {string[]}
 */
export function hostsFromProxyRoutes(proxyRoutes) {
  const hosts = [];
  for (const route of proxyRoutes || []) {
    for (const name of route.serverNames || []) {
      if (name) {
        hosts.push(name);
      }
    }
  }
  return [...new Set(hosts)];
}
