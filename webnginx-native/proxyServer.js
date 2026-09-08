'use strict';

import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { URL } from 'node:url';
import { ensureCa, getLeafCert, getCaPaths } from './ca.js';
import { matchRoute, buildUpstreamUrl } from './routes.js';

const DEFAULT_PORT = 17890;

export class MitmProxy {
  constructor() {
    this.ca = ensureCa();
    this.routes = [];
    this.port = DEFAULT_PORT;
    this.server = null;
  }

  getStatus() {
    const paths = getCaPaths();
    return {
      type: 'status',
      running: !!this.server?.listening,
      port: this.port,
      routeCount: this.routes.length,
      caPath: paths.certPath,
    };
  }

  async setRoutes(routes, listenPort) {
    this.routes = Array.isArray(routes) ? routes : [];
    const wantPort = Number(listenPort) || DEFAULT_PORT;

    if (this.routes.length === 0) {
      await this.stop();
      this.port = wantPort;
      return this.getStatus();
    }

    if (!this.server) {
      this.port = wantPort;
      await this.start();
      return this.getStatus();
    }
    if (wantPort !== this.port) {
      await this.stop();
      this.port = wantPort;
      await this.start();
    }
    return this.getStatus();
  }

  start() {
    if (this.server) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleHttp(req, res).catch((err) => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
          }
          res.end(`WebNginx proxy error: ${err.message}`);
        });
      });

      this.server.on('connect', (req, clientSocket, head) => {
        this.handleConnect(req, clientSocket, head).catch(() => {
          try {
            clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          } catch {
            /* ignore */
          }
          clientSocket.destroy();
        });
      });

      this.server.once('error', reject);
      this.server.once('listening', resolve);
      this.server.listen(this.port, '127.0.0.1');
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      const server = this.server;
      this.server = null;
      server.close(() => resolve());
    });
  }

  async handleHttp(req, res) {
    const host = req.headers.host || '';
    let pathname = req.url || '/';
    if (pathname.startsWith('http://') || pathname.startsWith('https://')) {
      const u = new URL(pathname);
      pathname = `${u.pathname}${u.search}`;
    }

    const route = matchRoute(this.routes, host, pathname.split('?')[0]);
    if (!route) {
      // Chrome PAC only sees host for HTTPS, so unmatched paths still hit us —
      // passthrough to the original origin instead of 404.
      await this.forward(this.originPassthroughRoute('http:', host), req, res, pathname);
      return;
    }

    await this.forward(route, req, res, pathname);
  }

  async handleConnect(req, clientSocket, head) {
    const hostPort = req.url || '';
    const [hostname, portStr] = hostPort.split(':');
    const port = Number(portStr) || 443;
    const leaf = getLeafCert(this.ca, hostname);

    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

    const tlsSocket = new tls.TLSSocket(clientSocket, {
      isServer: true,
      key: leaf.keyPem,
      cert: leaf.certPem,
    });

    if (head && head.length) {
      tlsSocket.unshift(head);
    }

    const fakeServer = http.createServer((req2, res2) => {
      const path = req2.url || '/';
      const hostHeader = req2.headers.host || `${hostname}:${port}`;
      const route =
        matchRoute(this.routes, hostHeader, path.split('?')[0]) ||
        matchRoute(this.routes, hostname, path.split('?')[0]);
      const target =
        route ||
        this.originPassthroughRoute(
          'https:',
          port === 443 ? hostname : `${hostname}:${port}`,
        );
      this.forward(target, req2, res2, path).catch((err) => {
        if (!res2.headersSent) {
          res2.writeHead(502, { 'Content-Type': 'text/plain' });
        }
        res2.end(`WebNginx proxy error: ${err.message}`);
      });
    });

    fakeServer.on('clientError', () => {
      tlsSocket.destroy();
    });

    fakeServer.emit('connection', tlsSocket);
  }

  /**
   * Synthetic route: keep request path, fetch from the browser's original host.
   * @param {'http:'|'https:'} protocol
   * @param {string} hostHeader host or host:port
   */
  originPassthroughRoute(protocol, hostHeader) {
    const host = String(hostHeader || '').trim() || 'localhost';
    return {
      matchType: 'prefix',
      pattern: '/',
      upstream: `${protocol}//${host}/`,
      proxySetHeaders: [],
      addHeaders: [],
    };
  }

  async forward(route, req, res, reqPath) {
    const upstreamUrl = buildUpstreamUrl(route, reqPath);
    const lib = upstreamUrl.protocol === 'http:' ? http : https;
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    headers.host = upstreamUrl.host;

    for (const h of route.proxySetHeaders || []) {
      headers[h.header.toLowerCase()] = h.value;
    }

    const opts = {
      protocol: upstreamUrl.protocol,
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || (upstreamUrl.protocol === 'http:' ? 80 : 443),
      path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
      method: req.method,
      headers,
    };

    await new Promise((resolve, reject) => {
      const upReq = lib.request(opts, (upRes) => {
        const outHeaders = { ...upRes.headers };
        for (const h of route.addHeaders || []) {
          const key = h.header.toLowerCase();
          if (outHeaders[key]) {
            const prev = outHeaders[key];
            outHeaders[key] = Array.isArray(prev)
              ? [...prev, h.value]
              : [prev, h.value];
          } else {
            outHeaders[key] = h.value;
          }
        }
        res.writeHead(upRes.statusCode || 502, outHeaders);
        upRes.pipe(res);
        upRes.on('end', resolve);
        upRes.on('error', reject);
      });
      upReq.on('error', reject);
      req.pipe(upReq);
    });
  }
}
