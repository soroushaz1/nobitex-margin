import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildRunner } from '../scripts/build-runner.mjs';
import { makeCandles, toUdf } from './helpers.js';

const file = buildRunner();
const code = readFileSync(file, 'utf8');

/** Sandbox with only the APIs the Capacitor background runner provides. */
function makeRunner({ aiDecision = 'trade', confidence = 66, spread = 0.1, aiFails = false } = {}) {
  const kv = new Map();
  const notifications = [];
  const listeners = {};
  const calls = [];
  const candles = toUdf(makeCandles(Array.from({ length: 220 }, (_, i) => 10_000_000_000 + i * 4_000_000)));
  const respond = (body, status = 200) => ({
    ok: status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
  const fetch = async (url, opts = {}) => {
    calls.push(url);
    if (url.includes('/v2/options')) return respond({ status: 'ok', nobitex: { minOrders: { rls: '3000000' } } });
    if (url.includes('/margin/markets/list'))
      return respond({ status: 'ok', markets: {
        BTCIRT: { srcCurrency: 'btc', dstCurrency: 'rls', maxLeverage: '5', buyEnabled: true, sellEnabled: true },
        ETHIRT: { srcCurrency: 'eth', dstCurrency: 'rls', maxLeverage: '5', buyEnabled: true, sellEnabled: true },
        PEPEIRT: { srcCurrency: 'pepe', dstCurrency: 'rls', maxLeverage: '3', buyEnabled: true, sellEnabled: true } } });
    if (url.includes('/market/stats'))
      return respond({ status: 'ok', stats: {
        'btc-rls': { volumeDst: '900000000000' }, 'eth-rls': { volumeDst: '300000000000' }, 'pepe-rls': { volumeDst: '2000000000' } } });
    if (url.includes('/v3/orderbook/all')) {
      const mk = (p) => ({ asks: [[String(p * (1 + spread / 200)), '1']], bids: [[String(p * (1 - spread / 200)), '1']] });
      return respond({ status: 'ok', BTCIRT: mk(1e10), ETHIRT: mk(4e8) });
    }
    if (url.includes('/market/udf/history')) return respond(candles);
    if (url.includes('ai.test')) {
      if (aiFails) return respond({ error: { message: 'quota exceeded' } }, 429);
      const body = JSON.parse(opts.body);
      assert.ok(!body.messages[1].content.includes('PEPEIRT'), 'thin market must be filtered out');
      return respond({ choices: [{ message: { content: JSON.stringify({
        decision: aiDecision, symbol: 'BTCIRT', side: 'long', stop_loss_pct: 1.4, take_profit_pct: 3, confidence, reasoning_fa: 'x' }) } }] });
    }
    return respond({ status: 'failed', message: 'unknown ' + url }, 404);
  };
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    fetch,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    addEventListener: (name, fn) => (listeners[name] = fn),
    CapacitorKV: {
      get: (k) => ({ value: kv.has(k) ? kv.get(k) : null }),
      set: (k, v) => kv.set(k, v),
      remove: (k) => kv.delete(k),
    },
    CapacitorNotifications: { schedule: (list) => notifications.push(...list) },
  };
  vm.runInNewContext(code, sandbox, { filename: 'background.js' });
  const dispatch = (event, details) =>
    new Promise((resolve, reject) => listeners[event](resolve, reject, details));
  return { dispatch, kv, notifications, calls, listeners };
}

const CFG = { enabled: true, aiBaseUrl: 'https://ai.test/v1', aiModel: 'm', aiKey: 'k', candidates: 10 };

test('bundle registers the four events and stays disabled until configured', async () => {
  const r = makeRunner();
  assert.deepEqual(Object.keys(r.listeners).sort(), ['checkMarket', 'configure', 'getLatest', 'runNow']);
  await r.dispatch('checkMarket');
  assert.equal(r.calls.length, 0);
  assert.equal(JSON.parse(r.kv.get('bg_status')).skipped, 'disabled');
});

test('valid setup → one notification, stored finding; same idea is not re-notified', async () => {
  const r = makeRunner();
  await r.dispatch('configure', CFG);
  await r.dispatch('checkMarket');
  assert.equal(r.notifications.length, 1);
  assert.match(r.notifications[0].title, /BTCIRT/);
  const latest = await r.dispatch('getLatest');
  assert.equal(latest.enabled, true);
  assert.equal(latest.latest.idea.decision, 'trade');
  assert.equal(latest.latest.notified, true);
  assert.ok(latest.latest.price > 0);
  await r.dispatch('checkMarket');
  assert.equal(r.notifications.length, 1, 'repeat idea within 2h must be silent');
  assert.ok(!r.calls.some((u) => u.includes('/positions') || u.includes('/orders')), 'background must never touch account endpoints');
});

test('no notification for no_trade, low confidence or wide spread', async () => {
  for (const opts of [{ aiDecision: 'no_trade' }, { confidence: 40 }, { spread: 0.9 }]) {
    const r = makeRunner(opts);
    await r.dispatch('configure', CFG);
    await r.dispatch('checkMarket');
    assert.equal(r.notifications.length, 0, JSON.stringify(opts));
  }
});

test('errors are recorded, never thrown out of the scheduled event', async () => {
  const r = makeRunner({ aiFails: true });
  await r.dispatch('configure', CFG);
  await r.dispatch('checkMarket');
  const st = JSON.parse(r.kv.get('bg_status'));
  assert.equal(st.ok, false);
  assert.match(st.error, /429/);
});

test('disabling wipes the stored AI key', async () => {
  const r = makeRunner();
  await r.dispatch('configure', CFG);
  await r.dispatch('configure', { enabled: false, aiKey: 'k' });
  assert.equal(r.kv.get('bg_config'), JSON.stringify({ enabled: false }));
});
