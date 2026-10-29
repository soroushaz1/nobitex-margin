import test from 'node:test';
import assert from 'node:assert/strict';
import { ema, rsi, atr, summarize, candlesFromUdf } from '../www/js/indicators.js';
import { buildPlan, effectiveSettings, LIMITS } from '../www/js/risk.js';
import { settlePaper, resultOf, stats, tradesToday } from '../www/js/journal.js';
import { extractJson, normalizeIdea, buildSnapshot, askModel } from '../www/js/ai.js';
import { MarketInfo } from '../www/js/market.js';
import { executePlan } from '../www/js/trade.js';
import { encryptSecrets, decryptSecrets } from '../www/js/storage.js';
import { floorToStep, roundToStep, normalizeDigits, fmtToman } from '../www/js/util.js';
import { makeCandles, toUdf, mockFetch } from './helpers.js';

test('util rounding and digits', () => {
  assert.equal(floorToStep(0.0012349, 0.000001), '0.001234');
  assert.equal(floorToStep(123.9, 1), '123');
  assert.equal(roundToStep(12345678, 10), '12345680');
  assert.equal(normalizeDigits('۹۹۶٬۰۰۰'), '996000');
  assert.equal(fmtToman(9960000), '۹۹۶,۰۰۰');
});

test('indicators: EMA of constant, RSI extremes, ATR positive', () => {
  assert.equal(ema(Array(30).fill(5), 10).at(-1), 5);
  const up = Array.from({ length: 40 }, (_, i) => 100 + i);
  assert.equal(rsi(up).at(-1), 100);
  const down = Array.from({ length: 40 }, (_, i) => 100 - i);
  assert.ok(rsi(down).at(-1) < 1);
  assert.ok(atr(makeCandles(up)).at(-1) > 0);
  const s = summarize(candlesFromUdf(toUdf(makeCandles(Array.from({ length: 220 }, (_, i) => 1000 + Math.sin(i / 5) * 20 + i)))));
  assert.ok(s.rsi14 > 0 && s.rsi14 < 100);
  assert.equal(s.ema20_above_ema50, true);
  assert.equal(summarize(makeCandles([1, 2, 3])), null);
});

const ctx = (over = {}) => ({
  symbol: 'BTCIRT',
  price: 100_000_000_000 / 10, // 10B rials ≈ 1B toman
  balanceRials: 9_960_000,
  market: { src: 'btc', dst: 'rls', maxLeverage: 5, buyEnabled: true, sellEnabled: true },
  amountStep: 0.000001,
  priceStep: 10,
  minOrderRials: 3_000_000,
  settings: { leverage: 2, riskPct: 2 },
  tradesToday: 0,
  openPositions: 0,
  ...over,
});
const idea = (over = {}) => ({ symbol: 'BTCIRT', side: 'long', stop_loss_pct: 1.5, take_profit_pct: 3, confidence: 65, ...over });

test('settings are clamped to hard limits', () => {
  assert.deepEqual(effectiveSettings({ leverage: 10, riskPct: 20, maxTradesPerDay: 50 }), { leverage: 3, riskPct: 3, maxTradesPerDay: 3 });
  assert.deepEqual(effectiveSettings({ leverage: 2.3 }), { leverage: 2.5, riskPct: 2, maxTradesPerDay: 3 });
});

test('plan sizing: loss at stop ≈ 2% of balance, stop/tp prices on the right side', () => {
  const r = buildPlan(idea(), ctx());
  assert.ok(r.ok, r.reasons && r.reasons.join());
  const p = r.plan;
  assert.equal(p.leverage, 2);
  assert.ok(Math.abs(p.lossAtStop - 9_960_000 * 0.02) < 9_960_000 * 0.001, `loss ${p.lossAtStop}`);
  assert.ok(p.stopPrice < p.price && p.tpPrice > p.price);
  assert.ok(p.stopLimitPrice < p.stopPrice);
  assert.ok(p.collateral <= 9_960_000 * LIMITS.MAX_COLLATERAL_SHARE);
  const s = buildPlan(idea({ side: 'short' }), ctx()).plan;
  assert.ok(s.stopPrice > s.price && s.tpPrice < s.price && s.stopLimitPrice > s.stopPrice);
  assert.equal(s.orderSide, 'sell');
});

test('plan rejections: bad R:R, wide stop, low confidence, disabled side, open position, daily cap, small balance', () => {
  const bad = (i, c) => {
    const r = buildPlan(idea(i), ctx(c));
    assert.equal(r.ok, false);
    return r.reasons.join(' | ');
  };
  assert.match(bad({ take_profit_pct: 2 }), /نسبت سود/);
  assert.match(bad({ stop_loss_pct: 8, take_profit_pct: 20 }), /حد ضرر/);
  assert.match(bad({ confidence: 40 }), /اطمینان/);
  assert.match(bad({ side: 'short' }, { market: { src: 'btc', dst: 'rls', sellEnabled: false } }), /شورت/);
  assert.match(bad({}, { openPositions: 1 }), /پوزیشن باز/);
  assert.match(bad({}, { tradesToday: 3 }), /سقف/);
  assert.match(bad({ stop_loss_pct: 5, take_profit_pct: 10 }, { balanceRials: 2_000_000 }), /حداقل سفارش/);
});

test('notional is capped by balance × leverage × 90% for tight stops', () => {
  const p = buildPlan(idea({ stop_loss_pct: 0.6, take_profit_pct: 1.2 }), ctx()).plan;
  assert.ok(p.notional <= 9_960_000 * 2 * 0.9 + 1);
  assert.equal(p.cappedByBalance, true);
});

test('paper settlement: stop first when both touched, win, expiry; results and stats', () => {
  const openedAt = 1_700_000_000_000;
  const e = { side: 'long', price: 100, stopPrice: 98, tpPrice: 104, openedAt, notional: 1000, lossAtStop: 23.5, mode: 'paper' };
  const t0 = 1_700_000_000;
  const both = [{ t: t0, o: 100, h: 105, l: 97, c: 100, v: 1 }];
  assert.equal(settlePaper(e, both, t0 + 1000).status, 'lost');
  const win = [{ t: t0, o: 100, h: 101, l: 99, c: 100, v: 1 }, { t: t0 + 900, o: 100, h: 104.5, l: 99.5, c: 104, v: 1 }];
  const w = settlePaper(e, win, t0 + 2000);
  assert.equal(w.status, 'won');
  assert.equal(settlePaper(e, win.slice(0, 1), t0 + 3600), null);
  assert.equal(settlePaper(e, win.slice(0, 1), t0 + 73 * 3600).status, 'expired');
  const short = { ...e, side: 'short', stopPrice: 102, tpPrice: 96 };
  assert.equal(settlePaper(short, [{ t: t0, o: 100, h: 101, l: 95, c: 96, v: 1 }], t0 + 900).status, 'won');
  const closedWin = { ...e, ...w };
  assert.ok(resultOf(closedWin).r > 1.5);
  const st = stats([closedWin, { ...e, status: 'lost', exitPrice: 98 }, { status: 'open' }]);
  assert.equal(st.count, 2);
  assert.equal(st.wins, 1);
  assert.equal(st.open, 1);
  assert.equal(tradesToday([{ mode: 'paper', openedAt: Date.now() }, { mode: 'live', openedAt: Date.now() }], 'paper'), 1);
});

test('AI reply parsing and validation', () => {
  const raw = extractJson('```json\n{"decision":"trade","symbol":"btcirt","side":"long","stop_loss_pct":1.2,"take_profit_pct":2.4,"confidence":60}\n```');
  const ok = normalizeIdea(raw, [{ symbol: 'BTCIRT' }]);
  assert.equal(ok.decision, 'trade');
  assert.equal(ok.symbol, 'BTCIRT');
  const unknown = normalizeIdea({ ...raw, symbol: 'PEPEIRT' }, [{ symbol: 'BTCIRT' }]);
  assert.equal(unknown.decision, 'no_trade');
  assert.throws(() => extractJson('no json here'));
});

test('askModel falls back when json mode unsupported', async () => {
  const calls = [];
  const fetchFn = mockFetch(
    [[(u, i) => JSON.parse(i.body).response_format, () => ({ status: 400, body: { error: { message: 'response_format unsupported' } } })],
     [() => true, () => ({ body: { choices: [{ message: { content: 'Sure: {"decision":"no_trade","reasoning_fa":"x"}' } }] } })]],
    calls,
  );
  const out = await askModel({ baseUrl: 'https://ai.example/v1/', apiKey: 'k', model: 'm', fetchFn }, 's', 'u');
  assert.equal(out.decision, 'no_trade');
  assert.equal(calls[0].url, 'https://ai.example/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
});

// ---- integration with a fake exchange ----
function fakeExchange(state = {}) {
  const candles = toUdf(makeCandles(Array.from({ length: 220 }, (_, i) => 10_000_000_000 + i * 5_000_000)));
  return mockFetch([
    [(u) => u.includes('/v2/options'), () => ({ body: { status: 'ok', nobitex: { minOrders: { rls: '3000000' }, amountPrecisions: { BTCIRT: '0.000001' }, pricePrecisions: { BTCIRT: '10' } } } })],
    [(u) => u.includes('/margin/markets/list'), () => ({ body: { status: 'ok', markets: {
      BTCIRT: { srcCurrency: 'btc', dstCurrency: 'rls', maxLeverage: '5', buyEnabled: true, sellEnabled: true },
      ETHIRT: { srcCurrency: 'eth', dstCurrency: 'rls', maxLeverage: '5', buyEnabled: true, sellEnabled: false },
      BTCUSDT: { srcCurrency: 'btc', dstCurrency: 'usdt', maxLeverage: '5', buyEnabled: true, sellEnabled: true } } } })],
    [(u) => u.includes('/market/stats'), () => ({ body: { status: 'ok', stats: { 'btc-rls': { volumeDst: '900000000000', isClosed: false }, 'eth-rls': { volumeDst: '500000000000', isClosed: false } } } })],
    [(u) => u.includes('/market/udf/history'), () => ({ body: candles })],
    [(u) => u.includes('/v3/orderbook/'), () => ({ body: { status: 'ok', asks: [['11100000000', '1']], bids: [['11090000000', '1']], lastTradePrice: '11095000000' } })],
    [(u) => u.includes('/margin/orders/add'), (u, i) => { state.order = JSON.parse(i.body); state.opened = true; return { body: { status: 'ok', order: { id: 55 } } }; }],
    [(u) => u.includes('/positions/list'), () => ({ body: { status: 'ok', positions: state.opened ? [{ id: 9, srcCurrency: 'btc', side: 'buy', liability: '0' }] : [] } })],
    [(u) => u.includes('/positions/9/close'), (u, i) => { state.close = JSON.parse(i.body); return { body: { status: 'ok', orders: [] } }; }],
  ]);
}

test('market discovery keeps only rial margin markets, ranked by volume', async () => {
  const { Nobitex } = await import('../www/js/nobitex.js');
  const api = new Nobitex({ fetchFn: fakeExchange() });
  const mi = await new MarketInfo(api).load();
  const c = mi.candidates(5);
  assert.deepEqual(c.map((x) => x.symbol), ['BTCIRT', 'ETHIRT']);
  assert.equal(mi.precision('BTCIRT').minOrderRials, 3_000_000);
  const snap = await buildSnapshot(api, c);
  assert.equal(snap.length, 2);
  assert.ok(snap[0].timeframes['1h'].rsi14 > 50);
});

test('live execution: bounded market entry, then OCO close with TP/SL', async (t) => {
  t.mock.timers?.enable?.({ apis: ['setTimeout'] });
  const { Nobitex } = await import('../www/js/nobitex.js');
  const { loadNacl } = await import('./helpers.js');
  const { generateKeyPairSync } = await import('node:crypto');
  const pem = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
  const state = {};
  const api = new Nobitex({ apiKey: 'K', privateKey: pem, nacl: loadNacl(), fetchFn: fakeExchange(state) });
  const plan = buildPlan(idea(), ctx({ price: 11_095_000_000 })).plan;
  const p = executePlan(api, plan, { amountStep: 0.000001, priceStep: 10 });
  if (t.mock.timers?.tick) for (let i = 0; i < 5; i++) { await new Promise((r) => setImmediate(r)); t.mock.timers.tick(2000); }
  const res = await p;
  assert.equal(res.positionId, 9);
  assert.equal(res.protectedOk, true);
  assert.equal(state.order.execution, 'market');
  assert.equal(state.order.type, 'buy');
  assert.equal(Number(state.order.price), 11_133_300_000); // ask + 0.3%
  assert.equal(state.close.mode, 'oco');
  assert.equal(Number(state.close.price), plan.tpPrice);
  assert.equal(Number(state.close.stopPrice), plan.stopPrice);
});

test('secrets: encrypt with PIN, wrong PIN fails', async () => {
  const blob = await encryptSecrets('1234', { apiKey: 'a', privateKey: 'b' });
  assert.deepEqual(await decryptSecrets('1234', blob), { apiKey: 'a', privateKey: 'b' });
  await assert.rejects(decryptSecrets('9999', blob), /رمز اشتباه/);
  assert.ok(!JSON.stringify(blob).includes('"a"'));
});
