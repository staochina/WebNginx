#!/usr/bin/env node
'use strict';

import { MitmProxy } from './proxyServer.js';

const proxy = new MitmProxy();
let buffer = Buffer.alloc(0);
let expected = null;
let handling = Promise.resolve();

function writeMessage(msg) {
  const json = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(header);
  process.stdout.write(json);
}

async function handle(msg) {
  const id = msg?.id;
  try {
    switch (msg?.type) {
      case 'ping':
        return { id, ok: true, pong: true, ...proxy.getStatus(), type: 'pong' };
      case 'getStatus':
        return { id, ok: true, ...proxy.getStatus() };
      case 'setRoutes': {
        const status = await proxy.setRoutes(msg.routes || [], msg.listenPort);
        return { id, ok: true, ...status };
      }
      default:
        return { id, ok: false, error: `Unknown message type: ${msg?.type}` };
    }
  } catch (error) {
    return { id, ok: false, error: error.message || String(error) };
  }
}

function consume() {
  for (;;) {
    if (expected === null) {
      if (buffer.length < 4) {
        return;
      }
      expected = buffer.readUInt32LE(0);
      buffer = buffer.subarray(4);
      if (expected === 0 || expected > 10 * 1024 * 1024) {
        writeMessage({ ok: false, error: `Invalid native message length: ${expected}` });
        expected = null;
        return;
      }
    }
    if (buffer.length < expected) {
      return;
    }
    const body = buffer.subarray(0, expected);
    buffer = buffer.subarray(expected);
    expected = null;
    let msg;
    try {
      msg = JSON.parse(body.toString('utf8'));
    } catch (error) {
      writeMessage({ ok: false, error: error.message });
      continue;
    }
    handling = handling
      .then(() => handle(msg))
      .then((reply) => writeMessage(reply))
      .catch((error) => {
        writeMessage({
          id: msg?.id,
          ok: false,
          error: error.message || String(error),
        });
      });
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  consume();
});

process.stdin.on('end', () => {
  handling.finally(() => {
    proxy.stop().finally(() => process.exit(0));
  });
});

process.stdin.on('error', () => {
  handling.finally(() => {
    proxy.stop().finally(() => process.exit(1));
  });
});

// Avoid accidental stdout pollution from libraries.
console.log = (...args) => console.error(...args);
