import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseConfigModel,
  serializeConfigModel,
} from '../src/configModel.js';
import { parseNginxConfig } from '../src/nginxParser.js';

test('parses servers into table model', () => {
  const config = `
server {
    server_name fonts.googleapis.com;
    location / {
        proxy_pass https://fonts.loli.net;
    }
}

server {
    server_name fonts.gstatic.com;
    location / {
        proxy_pass https://gstatic.loli.net;
    }
}
`;
  const servers = parseConfigModel(config);
  assert.equal(servers.length, 2);
  assert.deepEqual(servers[0].serverNames, ['fonts.googleapis.com']);
  assert.equal(servers[0].locations.length, 1);
  assert.equal(servers[0].locations[0].active, true);
  assert.equal(servers[0].locations[0].args, '/');
  assert.match(servers[0].locations[0].body, /proxy_pass https:\/\/fonts\.loli\.net;/);
});

test('round-trips inactive locations without applying them', () => {
  const servers = [
    {
      serverNames: ['example.com'],
      locations: [
        {
          active: false,
          args: '/',
          body: 'proxy_pass https://off.example.com;',
        },
        {
          active: true,
          args: '/api',
          body: 'proxy_pass https://api.example.com;',
        },
      ],
    },
  ];

  const nginx = serializeConfigModel(servers);
  assert.match(nginx, /inactive on;/);

  const parsed = parseConfigModel(nginx);
  assert.equal(parsed[0].locations[0].active, false);
  assert.equal(parsed[0].locations[1].active, true);
  assert.doesNotMatch(parsed[0].locations[0].body, /inactive/);

  const rules = parseNginxConfig(nginx);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].action.redirect.transform.host, 'api.example.com');
});

test('new location defaults are active when serialized without inactive', () => {
  const nginx = serializeConfigModel([
    {
      serverNames: ['a.com'],
      locations: [{ active: true, args: '/', body: 'return 403;' }],
    },
  ]);
  assert.doesNotMatch(nginx, /inactive/);
  assert.equal(parseNginxConfig(nginx).length, 1);
});
