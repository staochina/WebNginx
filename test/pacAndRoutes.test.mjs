import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPacScript, hostsFromProxyRoutes } from '../src/pac.js';
import { deriveProxyBadge } from '../src/proxyController.js';
import { matchRoute, buildUpstreamUrl } from '../webnginx-native/routes.js';

test('buildPacScript returns DIRECT when no hosts', () => {
  const pac = buildPacScript([], 17890);
  assert.match(pac, /return "DIRECT"/);
  assert.doesNotMatch(pac, /PROXY/);
});

test('buildPacScript matches exact hosts and host:port urls', () => {
  const pac = buildPacScript(['api.example.com', '127.0.0.1:8080'], 17890);
  assert.match(pac, /PROXY 127\.0\.0\.1:17890/);
  assert.match(pac, /host === "api\.example\.com"/);
  assert.match(pac, /127\.0\.0\.1:8080/);
});

test('hostsFromProxyRoutes dedupes server names', () => {
  const hosts = hostsFromProxyRoutes([
    { serverNames: ['a.com', 'b.com'] },
    { serverNames: ['a.com'] },
  ]);
  assert.deepEqual(hosts, ['a.com', 'b.com']);
});

test('matchRoute matches host and prefix', () => {
  const routes = [
    {
      serverNames: ['api.example.com'],
      matchType: 'prefix',
      pattern: '/v1/',
      upstream: 'http://127.0.0.1:9000/v1/',
    },
  ];
  assert.ok(matchRoute(routes, 'api.example.com', '/v1/x'));
  assert.equal(matchRoute(routes, 'api.example.com', '/other'), null);
  assert.equal(matchRoute(routes, 'other.com', '/v1/x'), null);
});

test('buildUpstreamUrl host-only keeps request path', () => {
  const route = {
    matchType: 'prefix',
    pattern: '/svr/otb/',
    upstream: 'http://localhost:8088/svr/otb',
  };
  const url = buildUpstreamUrl(route, '/svr/otb/cube/1?x=1');
  assert.equal(url.href, 'http://localhost:8088/svr/otb/cube/1?x=1');
});

test('buildUpstreamUrl rewrites location prefix', () => {
  const route = {
    matchType: 'prefix',
    pattern: '/api/',
    upstream: 'http://backend.local/internal/',
  };
  const url = buildUpstreamUrl(route, '/api/users');
  assert.equal(url.href, 'http://backend.local/internal/users');
});

test('deriveProxyBadge is ON only when proxy is listening', () => {
  assert.equal(deriveProxyBadge({ listening: true }), 'on');
  assert.equal(deriveProxyBadge({ running: true }), 'on');
  assert.equal(deriveProxyBadge({ connected: true, listening: false }), 'off');
  assert.equal(deriveProxyBadge({ hostInstalled: true }), 'off');
  assert.equal(deriveProxyBadge(null), 'off');
});
