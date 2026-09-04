'use strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import forge from 'node-forge';

const DIR = path.join(os.homedir(), '.webnginx');
const CA_CERT_PATH = path.join(DIR, 'ca.crt');
const CA_KEY_PATH = path.join(DIR, 'ca.key');

export function getCaPaths() {
  return { dir: DIR, certPath: CA_CERT_PATH, keyPath: CA_KEY_PATH };
}

export function ensureCa() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  if (fs.existsSync(CA_CERT_PATH) && fs.existsSync(CA_KEY_PATH)) {
    const certPem = fs.readFileSync(CA_CERT_PATH, 'utf8');
    const keyPem = fs.readFileSync(CA_KEY_PATH, 'utf8');
    return {
      certPem,
      keyPem,
      cert: forge.pki.certificateFromPem(certPem),
      key: forge.pki.privateKeyFromPem(keyPem),
    };
  }

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  const now = new Date();
  cert.validity.notBefore = now;
  cert.validity.notAfter = new Date(now.getTime() + 10 * 365 * 24 * 3600 * 1000);
  const attrs = [
    { name: 'commonName', value: 'WebNginx Local CA' },
    { name: 'organizationName', value: 'WebNginx' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, cRLSign: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  fs.writeFileSync(CA_CERT_PATH, certPem, { mode: 0o600 });
  fs.writeFileSync(CA_KEY_PATH, keyPem, { mode: 0o600 });

  return { certPem, keyPem, cert, key: keys.privateKey };
}

/** @type {Map<string, {key: object, cert: object, keyPem: string, certPem: string}>} */
const leafCache = new Map();

export function getLeafCert(ca, hostname) {
  const host = String(hostname || '').split(':')[0] || 'localhost';
  if (leafCache.has(host)) {
    return leafCache.get(host);
  }

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = String(Date.now());
  const now = new Date();
  cert.validity.notBefore = now;
  cert.validity.notAfter = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
  cert.setSubject([{ name: 'commonName', value: host }]);
  cert.setIssuer(ca.cert.subject.attributes);
  const altNames = net.isIP(host)
    ? [{ type: 7, ip: host }]
    : [{ type: 2, value: host }];
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
    },
    {
      name: 'subjectAltName',
      altNames,
    },
  ]);
  cert.sign(ca.key, forge.md.sha256.create());

  const leaf = {
    key: keys.privateKey,
    cert,
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certPem: forge.pki.certificateToPem(cert),
  };
  leafCache.set(host, leaf);
  return leaf;
}
