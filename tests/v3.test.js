import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { buildPlan, ideaLooksValid, scanRules, protectionPrices } from '../www/js/risk.js';
import { Nobitex, translateError } from '../www/js/nobitex.js';
import { MarketInfo } from '../www/js/market.js';
import { executePlan, closeNow, protectPosition, positionAmounts, positionPnl, positionSymbol } from '../www/js/trade.js';
import { loadNacl, mockFetch } from './helpers.js';

const nacl = loadNacl();
const pem = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
const PREC = { amountStep: 0.000001, priceStep: 10 };

const ctx = (over = {}) => ({
  symbol: 'BTCIRT',
  price: 11_000_000_000,
  balanceRials: 9_960_000,
  market: { src: 'btc', dst: 'rls', maxLeverage: 5, buyEnabled: true, sellEnabled: true },
  ...PREC,
  minOrderRials: 3_000_000,
  settings: {},
  tradesToday: 0,
  openPositions: 0,
  openSymbols: [],
  ...over,
});
const idea = (over = {}) => ({ symbol: 'BTCIRT', side: 'long', stop_loss_pct: 1.5, take_profit_pct: 3, confidence: 60, ...over });

test('several positions allowed in different markets; same market blocked', () => {
  assert.ok(buildPlan(idea(), ctx({ openPositions: 2, openSymbols: ['ETHIRT', 'HYPEIRT'] })).ok);
  const r = buildPlan(idea(), ctx({ openPositions: 1, openSymbols: ['btcirt'] }));
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(), /همین بازار/);
});

test('no daily cap by default; user cap respected when set', () => {
  assert.ok(buildPlan(idea(), ctx({ tradesToday: 40 })).ok);
  assert.equal(buildPlan(idea(), ctx({ tradesToday: 5, settings: { maxTradesPerDay: 5 } })).ok, false);
});

test('higher leverage and risk are allowed but capped by the market and liquidation sanity', () => {
  const p = buildPlan(idea({ stop_loss_pct: 2, take_profit_pct: 4 }), ctx({ settings: { leverage: 10, riskPct: 10 } })).plan;
  assert.equal(p.leverage, 5, 'market max is 5');
  assert.ok(Math.abs(p.lossAtStop - 996_000) < 20_000, `loss ${p.lossAtStop}`);
  const m10 = { src: 'btc', dst: 'rls', maxLeverage: 10, buyEnabled: true, sellEnabled: true };
  const liq = buildPlan(idea({ stop_loss_pct: 8, take_profit_pct: 16 }), ctx({ market: m10, settings: { leverage: 10, riskPct: 10 } }));
  assert.equal(liq.ok, false);
  assert.match(liq.reasons.join(), /لیکوئید/);
});

test('loose user rules let low-confidence / low R:R ideas through', () => {
  const r = buildPlan(idea({ confidence: 35, take_profit_pct: 1.6 }), ctx({ settings: { minConfidence: 30, minRewardRisk: 1 } }));
  assert.ok(r.ok, r.reasons && r.reasons.join());
});

test('scanner validity follows the user rules and skips open markets', () => {
  const rules = scanRules({ minConfidence: 40, minRewardRisk: 1.1, maxSpreadPct: 1 }, ['ETHIRT']);
  assert.ok(ideaLooksValid({ decision: 'trade', side: 'long', symbol: 'BTCIRT', stop_loss_pct: 1, take_profit_pct: 1.2, confidence: 45 }, 0.5, rules));
  assert.equal(ideaLooksValid({ decision: 'trade', side: 'long', symbol: 'ETHIRT', stop_loss_pct: 1, take_profit_pct: 2, confidence: 80 }, 0.1, rules), false);
  assert.equal(rules.minVolumeRials, 5e9);
});

test('market filter: min volume 0 includes thin markets', async () => {
  const fetchFn = mockFetch([
    [(u) => u.includes('/v2/options'), () => ({ body: { status: 'ok', nobitex: {} } })],
    [(u) => u.includes('/margin/markets/list'), () => ({ body: { status: 'ok', markets: {
      BTCIRT: { srcCurrency: 'btc', dstCurrency: 'rls' }, PEPEIRT: { srcCurrency: 'pepe', dstCurrency: 'rls' } } } })],
    [(u) => u.includes('/market/stats'), () => ({ body: { status: 'ok', stats: { 'btc-rls': { volumeDst: '9e11' }, 'pepe-rls': { volumeDst: '1e9' } } } })],
  ]);
  const mi = await new MarketInfo(new Nobitex({ fetchFn, nacl })).load();
  assert.deepEqual(mi.candidates(10).map((x) => x.symbol), ['BTCIRT']);
  assert.deepEqual(mi.candidates(10, 0).map((x) => x.symbol), ['BTCIRT', 'PEPEIRT']);
});

test('position amounts: long uses totalAsset (coin), short uses liability; wrong-unit values dropped', () => {
  const long = { side: 'buy', totalAsset: '0.000950', liability: '5400000', collateral: '5400000', leverage: '2', entryPrice: '11000000000' };
  assert.deepEqual(positionAmounts(long, '0.000956', 0.000001), ['0.000950', '0.000956', '0.000951']);
  const short = { side: 'sell', liability: '0.000957', totalAsset: '10600000', collateral: '5300000', leverage: '2', entryPrice: '11000000000' };
  assert.equal(positionAmounts(short, '0.000956', 0.000001)[0], '0.000957');
  // a rial value in a coin field is rejected by the size sanity check
  assert.deepEqual(positionAmounts({ ...long, totalAsset: '10500000' }, '0.000956', 0.000001), ['0.000956', '0.000951']);
  assert.equal(positionSymbol({ srcCurrency: 'hype', dstCurrency: 'rls' }), 'HYPEIRT');
});

test('position PnL: exchange value preferred, else computed from the book', () => {
  assert.equal(positionPnl({ side: 'buy', unrealizedPNL: '12000', collateral: '100000' }, null).pct, 12);
  const pnl = positionPnl({ side: 'sell', entryPrice: '100', liability: '10', collateral: '500', leverage: '2' }, { ask: 95, bid: 94 }, null, 0.01);
  assert.equal(pnl.pnl, 50);
});

function exchange(state) {
  return mockFetch([
    [(u) => u.includes('/v3/orderbook/'), () => ({ body: { status: 'ok', asks: [['11010000000', '1']], bids: [['11000000000', '1']] } })],
    [(u) => u.includes('/market/orders/cancel-old'), (u, i) => { state.cancelled = JSON.parse(i.body); state.order.push('cancel'); return { body: { status: 'ok' } }; }],
    [(u) => u.includes('/positions/list'), () => ({ body: { status: 'ok', positions: state.positions } })],
    [(u) => /\/positions\/\d+\/status/.test(u), (u) => ({ body: { status: 'ok', position: state.positions.find((p) => u.includes(`/positions/${p.id}/`)) } })],
    [(u) => /\/positions\/\d+\/close/.test(u), (u, i) => {
      const b = JSON.parse(i.body);
      state.order.push('close');
      state.closes.push(b);
      if (state.rejectFirstClose && state.closes.length === 1) return { status: 400, body: { status: 'failed', code: 'ExceedLiability', message: 'amount exceeds' } };
      return { body: { status: 'ok' } };
    }],
    [(u) => u.includes('/margin/orders/add'), (u, i) => {
      state.added = JSON.parse(i.body);
      state.positions.push({ id: 200, srcCurrency: 'btc', dstCurrency: 'rls', side: 'buy', totalAsset: '0.000955', collateral: '5300000', leverage: '2' });
      return { body: { status: 'ok', order: { id: 1 } } };
    }],
  ]);
}

test('close now on a LONG: cancels TP/SL first, then market-closes the coin amount', async () => {
  const state = { order: [], closes: [], positions: [{ id: 77, srcCurrency: 'btc', dstCurrency: 'rls', side: 'buy', totalAsset: '0.000950', liability: '5400000', collateral: '5400000', leverage: '2' }] };
  const api = new Nobitex({ apiKey: 'K', privateKey: pem, nacl, fetchFn: exchange(state) });
  await closeNow(api, state.positions[0], PREC, '0.000956');
  assert.deepEqual(state.order, ['cancel', 'close']);
  assert.deepEqual(state.cancelled, { srcCurrency: 'btc', dstCurrency: 'rls', tradeType: 'margin' });
  assert.equal(state.closes[0].amount, '0.000950');
  assert.equal(state.closes[0].execution, 'market');
  assert.ok(Number(state.closes[0].price) < 11_000_000_000, 'sell bound below bid');
});

test('changing TP/SL: cancels old orders, retries with the next amount if rejected', async () => {
  const state = { order: [], closes: [], rejectFirstClose: true, positions: [{ id: 5, srcCurrency: 'btc', dstCurrency: 'rls', side: 'sell', liability: '0.000960', collateral: '5300000', leverage: '2' }] };
  const api = new Nobitex({ apiKey: 'K', privateKey: pem, nacl, fetchFn: exchange(state) });
  const prices = protectionPrices('short', 11_000_000_000, 2, 4, 10);
  assert.ok(prices.stopPrice > 11_000_000_000 && prices.tpPrice < 11_000_000_000 && prices.stopLimitPrice > prices.stopPrice);
  const warnings = [];
  const ok = await protectPosition(api, state.positions[0], prices, '0.000958', PREC, () => {}, warnings, true);
  assert.equal(ok, true, warnings.join());
  assert.equal(state.order[0], 'cancel');
  assert.equal(state.closes.length, 2);
  assert.equal(state.closes[1].mode, 'oco');
  assert.equal(state.closes[1].amount, '0.000958');
});

test('opening a trade while another market has a position works; same market refused', async () => {
  const state = { order: [], closes: [], positions: [{ id: 3, srcCurrency: 'hype', dstCurrency: 'rls', side: 'buy', totalAsset: '1', collateral: '1', leverage: '1' }] };
  const api = new Nobitex({ apiKey: 'K', privateKey: pem, nacl, fetchFn: exchange(state) });
  const plan = buildPlan(idea(), ctx({ openPositions: 1, openSymbols: ['HYPEIRT'] })).plan;
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0); // skip polling delays
  try {
    const res = await executePlan(api, plan, PREC);
    assert.equal(res.positionId, 200);
    assert.equal(res.protectedOk, true);
    assert.equal(state.closes[0].amount, '0.000955', 'OCO uses the coin actually held');
    await assert.rejects(executePlan(api, plan, PREC), /همین بازار/);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test('Nobitex errors are explained in Persian; hanging requests time out', async () => {
  assert.match(translateError('Insufficient Balance', 'InsufficientBalance', 400), /موجودی کافی نیست/);
  assert.equal(translateError('Something new', null, 400), 'Something new');
  const api = new Nobitex({ nacl, timeoutMs: 50, fetchFn: () => new Promise(() => {}) });
  await assert.rejects(api.marketStats(), /طول کشید/);
});
