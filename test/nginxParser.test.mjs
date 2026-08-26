import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNginxConfig } from '../src/nginxParser.js';

test('parses server proxy_pass into redirect transform rule', () => {
  const config = `
server {
    server_name fonts.googleapis.com;
    location / {
        proxy_pass https://fonts.loli.net;
    }
}
`;
  const rules = parseNginxConfig(config);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].action.type, 'redirect');
  assert.equal(rules[0].condition.urlFilter, '||fonts.googleapis.com/');
  assert.equal(rules[0].action.redirect.transform.host, 'fonts.loli.net');
  assert.equal(rules[0].action.redirect.transform.scheme, 'https');
  assert.ok(!rules[0].condition.resourceTypes.includes('main_frame'));
  assert.ok(rules[0].condition.resourceTypes.includes('xmlhttprequest'));
  assert.deepEqual(rules[0].condition.excludedRequestMethods, ['options']);
  assert.equal(rules[1].action.type, 'modifyHeaders');
  assert.equal(rules[1].condition.urlFilter, '||fonts.loli.net/');
  assert.ok(
    rules[1].action.responseHeaders.some(
      (h) => h.header === 'Access-Control-Allow-Origin' && h.value === '*',
    ),
  );
});

test('proxy_pass keeps request path when target path matches location', () => {
  const config = `
server {
    server_name westlake-dev.sandbox.lifecycle.cn;
    location /svr/otb/ {
        proxy_pass http://localhost:8088/svr/otb;
    }
}
`;
  const rules = parseNginxConfig(config);
  const redirect = rules.find((r) => r.action.type === 'redirect');
  assert.ok(redirect);
  assert.equal(redirect.action.redirect.transform.host, 'localhost');
  assert.equal(redirect.action.redirect.transform.port, '8088');
  assert.equal(redirect.action.redirect.transform.scheme, 'http');
  assert.equal(redirect.action.redirect.transform.path, undefined);
  assert.deepEqual(redirect.condition.excludedRequestMethods, ['options']);
  const cors = rules.find((r) => r.action.type === 'modifyHeaders');
  assert.equal(cors.condition.urlFilter, '||localhost:8088/svr/otb');
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

test('parses regex location with proxy_pass substitution', () => {
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

test('splits redirect and header modifications into separate rules', () => {
  const config = `
server {
    server_name api.example.com;
    location / {
        proxy_pass https://backend.example.com;
        proxy_set_header X-Test 1;
    }
}
`;
  const rules = parseNginxConfig(config);
  assert.equal(rules.length, 3);
  assert.equal(rules[0].action.type, 'redirect');
  assert.equal(rules[1].action.type, 'modifyHeaders');
  assert.ok(rules[1].action.responseHeaders);
  assert.equal(rules[2].action.type, 'modifyHeaders');
  assert.deepEqual(rules[2].action.requestHeaders, [
    { header: 'X-Test', operation: 'set', value: '1' },
  ]);
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
  const rules = parseNginxConfig(config);
  const redirect = rules.find((r) => r.action.type === 'redirect');
  assert.equal(redirect.action.redirect.transform.host, 'cdn.loli.net');
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
