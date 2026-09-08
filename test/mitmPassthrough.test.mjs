import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { MitmProxy } from '../webnginx-native/proxyServer.js';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    server.once('error', reject);
  });
}

function close(server) {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function proxyRequest(proxyPort, hostHeader, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        path: `http://${hostHeader}${path}`,
        method: 'GET',
        headers: { Host: hostHeader },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('unmatched path passthrough; matched path uses proxy_pass upstream', async () => {
  const originHits = [];
  const origin = http.createServer((req, res) => {
    originHits.push(req.url);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`origin:${req.url}`);
  });
  const originPort = await listen(origin);
  const hostHeader = `127.0.0.1:${originPort}`;

  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`upstream:${req.url}`);
  });
  const upstreamPort = await listen(upstream);

  const proxy = new MitmProxy();
  const proxyPort = 17991;
  await proxy.setRoutes(
    [
      {
        serverNames: [hostHeader, '127.0.0.1'],
        matchType: 'prefix',
        pattern: '/svr/otb/',
        upstream: `http://127.0.0.1:${upstreamPort}/svr/otb/`,
      },
    ],
    proxyPort,
  );

  try {
    const portal = await proxyRequest(proxyPort, hostHeader, '/svr/portal/home');
    assert.equal(portal.status, 200);
    assert.equal(portal.body, 'origin:/svr/portal/home');
    assert.ok(originHits.includes('/svr/portal/home'));

    const otb = await proxyRequest(proxyPort, hostHeader, '/svr/otb/cube');
    assert.equal(otb.status, 200);
    assert.equal(otb.body, 'upstream:/svr/otb/cube');
  } finally {
    await proxy.stop();
    await close(origin);
    await close(upstream);
  }
});
