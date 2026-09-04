import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNginxConfig,
  parseWebNginxConfig,
} from '../src/nginxParser.js';

test('server_name + proxy_pass becomes transparent proxy route, not DNR redirect', () => {
  const config = `
server {
    server_name fonts.googleapis.com;
    location / {
        proxy_pass https://fonts.loli.net;
    }
}
`;
  const { dnrRules, proxyRoutes } = parseWebNginxConfig(config);
  assert.equal(dnrRules.length, 0);
  assert.equal(proxyRoutes.length, 1);
  assert.deepEqual(proxyRoutes[0].serverNames, ['fonts.googleapis.com']);
  assert.equal(proxyRoutes[0].upstream, 'https://fonts.loli.net');
  assert.equal(proxyRoutes[0].matchType, 'prefix');
  assert.equal(proxyRoutes[0].pattern, '/');
});

test('proxy_pass with headers stays on proxy route', () => {
  const config = `
server {
    server_name api.example.com;
    location / {
        proxy_pass https://backend.example.com;
        proxy_set_header X-Test 1;
    }
}
`;
  const { dnrRules, proxyRoutes } = parseWebNginxConfig(config);
  assert.equal(dnrRules.length, 0);
  assert.equal(proxyRoutes.length, 1);
  assert.deepEqual(proxyRoutes[0].proxySetHeaders, [
    { header: 'X-Test', value: '1' },
  ]);
});

test('proxy_pass without server_name still uses DNR redirect', () => {
  const config = `
location ~ ^https://fonts\\.googleapis\\.com/(.*)$ {
    proxy_pass https://fonts.loli.net/\\1;
}
`;
  const rules = parseNginxConfig(config);
  const redirect = rules.find((r) => r.action.type === 'redirect');
  assert.equal(redirect.condition.regexFilter, '^https://fonts\\.googleapis\\.com/(.*)$');
  assert.equal(redirect.action.redirect.regexSubstitution, 'https://fonts.loli.net/\\1');
});

test('proxy_pass keeps request path metadata on route', () => {
  const config = `
server {
    server_name westlake-dev.sandbox.lifecycle.cn;
    location /svr/otb/ {
        proxy_pass http://localhost:8088/svr/otb;
    }
}
`;
  const { proxyRoutes } = parseWebNginxConfig(config);
  assert.equal(proxyRoutes.length, 1);
  assert.equal(proxyRoutes[0].pattern, '/svr/otb/');
  assert.equal(proxyRoutes[0].upstream, 'http://localhost:8088/svr/otb');
});

test('rewrite redirect still applies to main_frame', () => {
  const config = `
location / {
    rewrite ^https://old\\.com/(.*)$ https://new.com/\\1 break;
}
`;
  const rules = parseNginxConfig(config);
  assert.ok(rules[0].condition.resourceTypes.includes('main_frame'));
  assert.equal(rules[0].condition.excludedRequestMethods, undefined);
});

test('parses return 403 as block rule', () => {
  const config = `
server {
    server_name blocked.example.com;
    location / {
        return 403;
    }
}
`;
  const rules = parseNginxConfig(config);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].action.type, 'block');
});

test('parses rewrite directive', () => {
  const config = `
location / {
    rewrite ^https://old\\.com/(.*)$ https://new.com/\\1 break;
}
`;
  const rules = parseNginxConfig(config);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].condition.regexFilter, '^https://old\\.com/(.*)$');
  assert.equal(rules[0].action.redirect.regexSubstitution, 'https://new.com/\\1');
});

test('skips locations marked inactive on', () => {
  const config = `
server {
    server_name fonts.googleapis.com;
    location / {
        inactive on;
        proxy_pass https://fonts.loli.net;
    }
    location /cdn {
        proxy_pass https://cdn.loli.net;
    }
}
`;
  const { dnrRules, proxyRoutes } = parseWebNginxConfig(config);
  assert.equal(dnrRules.length, 0);
  assert.equal(proxyRoutes.length, 1);
  assert.equal(proxyRoutes[0].upstream, 'https://cdn.loli.net');
});

test('throws on unsupported directive', () => {
  assert.throws(
    () =>
      parseNginxConfig(`
location / {
    unknown_directive on;
}
`),
    /Unsupported directive 'unknown_directive'/,
  );
});
