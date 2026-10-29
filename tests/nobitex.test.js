import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify, createPublicKey } from 'node:crypto';
import { Nobitex, parsePrivateKey } from '../www/js/nobitex.js';
import { loadNacl, mockFetch } from './helpers.js';

const nacl = loadNacl();

function nodeKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const der = privateKey.export({ format: 'der', type: 'pkcs8' });
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  const seed = der.subarray(16);
  return { privateKey, publicKey, der, pem, seed };
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

test('parsePrivateKey accepts seed (b64, b64url, hex), seed+pub and PKCS8 PEM/DER', () => {
  const k = nodeKey();
  const seed = new Uint8Array(k.seed);
  const pub = nacl.sign.keyPair.fromSeed(seed).publicKey;
  const both = Buffer.concat([k.seed, Buffer.from(pub)]);
  for (const input of [
    k.seed.toString('base64'),
    b64url(k.seed).replace(/=+$/, ''),
    k.seed.toString('hex'),
    both.toString('base64'),
    k.pem,
    k.der.toString('base64'),
  ]) {
    assert.deepEqual(Buffer.from(parsePrivateKey(input)), k.seed, `failed for ${input.slice(0, 12)}`);
  }
  assert.throws(() => parsePrivateKey('abc'));
});

test('signed request: headers, signature over ts+METHOD+path?query+body, URL-safe base64', async () => {
  const k = nodeKey();
  const calls = [];
  const fetchFn = mockFetch(
    [[(u) => u.includes('/positions/list'), () => ({ body: { status: 'ok', positions: [] } })],
     [(u) => u.includes('/margin/orders/add'), () => ({ body: { status: 'ok', order: { id: 7 } } })]],
    calls,
  );
  const api = new Nobitex({ apiKey: 'PUBKEY', privateKey: k.pem, nacl, fetchFn, now: () => 1_750_000_000_000 });
  await api.positions('active');
  await api.addMarginOrder({ src: 'btc', dst: 'rls', side: 'buy', amount: '0.001', price: '100', leverage: 2, execution: 'market' });

  const spki = createPublicKey(k.privateKey);
  for (const { url, init } of calls) {
    const h = init.headers;
    assert.equal(h['Nobitex-Key'], 'PUBKEY');
    assert.equal(h['Nobitex-Timestamp'], '1750000000');
    assert.match(h['User-Agent'], /^TraderBot\//);
    assert.ok(!/[+/]/.test(h['Nobitex-Signature']), 'signature must be URL-safe');
    const path = url.replace('https://apiv2.nobitex.ir', '');
    const msg = `1750000000${init.method}${path}${init.body || ''}`;
    const sig = Buffer.from(h['Nobitex-Signature'].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    assert.ok(verify(null, Buffer.from(msg), spki, sig), `signature invalid for ${init.method} ${path}`);
  }
  assert.equal(calls[0].url, 'https://apiv2.nobitex.ir/positions/list?status=active');
  const body = JSON.parse(calls[1].init.body);
  assert.deepEqual(body, { srcCurrency: 'btc', dstCurrency: 'rls', type: 'buy', amount: '0.001', price: '100', leverage: '2', execution: 'market' });
});

test('failed status is raised as error with the exchange message', async () => {
  const fetchFn = mockFetch([[() => true, () => ({ status: 200, body: { status: 'failed', code: 'InsufficientBalance', message: 'Insufficient Balance' } })]]);
  const api = new Nobitex({ fetchFn, nacl });
  await assert.rejects(api.marketStats(), /Insufficient Balance/);
});

test('clock offset is learned from the Date header and used for timestamps', async () => {
  const fetchFn = mockFetch([[() => true, () => ({ body: { status: 'ok', stats: {} }, headers: { date: new Date(1_750_000_100_000).toUTCString() } })]]);
  const k = nodeKey();
  const api = new Nobitex({ apiKey: 'K', privateKey: k.pem, nacl, fetchFn, now: () => 1_750_000_000_000 });
  await api.marketStats();
  assert.equal(api.timestamp(), '1750000100');
});

test('margin balance: v2 wallets, then legacy list fallback', async () => {
  const k = nodeKey();
  let api = new Nobitex({
    apiKey: 'K', privateKey: k.pem, nacl,
    fetchFn: mockFetch([[(u) => u.includes('/v2/wallets'), () => ({ body: { status: 'ok', wallets: { RLS: { balance: '9960000', blocked: '0' } } } })]]),
  });
  assert.deepEqual(await api.marginBalanceRials(), { balance: 9960000, blocked: 0 });
  api = new Nobitex({
    apiKey: 'K', privateKey: k.pem, nacl,
    fetchFn: mockFetch([
      [(u) => u.includes('/v2/wallets'), () => ({ status: 404, body: {} })],
      [(u) => u.includes('/users/wallets/list'), () => ({ body: { status: 'ok', wallets: [{ currency: 'rls', activeBalance: '9000000', blockedBalance: '960000' }] } })],
    ]),
  });
  assert.deepEqual(await api.marginBalanceRials(), { balance: 9000000, blocked: 960000 });
});
