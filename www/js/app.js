// UI controller. All exchange actions go through explicit user confirmation.

import { Nobitex, parsePrivateKey } from './nobitex.js';
import { MarketInfo } from './market.js';
import { askModel, runAnalysis } from './ai.js';
import { buildPlan, effectiveSettings, scanRules, protectionPrices, FIXED } from './risk.js';
import { candlesFromUdf } from './indicators.js';
import { settlePaper, resultOf, stats, tradesToday } from './journal.js';
import {
  executePlan,
  protectPosition,
  closeNow,
  activePositions,
  currentBest,
  positionSide,
  positionSymbol,
  positionPnl,
  positionAmounts,
} from './trade.js';
import { createStore, encryptSecrets, decryptSecrets, DEFAULT_SETTINGS } from './storage.js';
import { fmtToman, fmtNum, fmtPct, toFaDigits, normalizeDigits, bytesToB64 } from './util.js';

const nacl = window.nacl;
const store = createStore();
const $ = (id) => document.getElementById(id);

const BG_FINDING_TTL_MS = 3 * 60 * 60 * 1000; // show background findings up to 3 h old (re-planned at the live price)
const STALE_WARN_MS = 15 * 60 * 1000;

const savedSettings = store.get('settings', {});
if (!savedSettings.v || savedSettings.v < 3) {
  // v2: wider scan by default; v3: user-adjustable rules, no daily cap by default
  if (savedSettings.candidates === 5) savedSettings.candidates = 10;
  if (savedSettings.maxTradesPerDay !== undefined) savedSettings.maxTradesPerDay = 0;
  savedSettings.v = 3;
  store.set('settings', { ...DEFAULT_SETTINGS, ...savedSettings });
}

const state = {
  pin: null,
  secrets: {},
  settings: { ...DEFAULT_SETTINGS, ...savedSettings },
  journal: store.get('journal', []),
  api: null,
  market: null,
  current: null, // { idea, plan, reasons, createdAt, source, status, price, spreadPct }
  busy: false,
  hiddenAt: 0,
  lastBalance: null,
};

// ---------------------------------------------------------------- helpers
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let toastTimer = null;
function toast(msg, bad = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (bad ? ' bad' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), bad ? 7000 : 3500);
}

function modal(html, { okText = 'تایید', okClass = 'primary', countdown = 0, cancelText = 'انصراف', onOpen } = {}) {
  return new Promise((resolve) => {
    $('modal-body').innerHTML = html;
    const ok = $('modal-ok');
    const cancel = $('modal-cancel');
    ok.className = 'btn ' + okClass;
    cancel.textContent = cancelText || '';
    cancel.hidden = cancelText === null;
    let left = countdown;
    const label = () => (ok.textContent = left > 0 ? `${okText} (${toFaDigits(left)})` : okText);
    ok.disabled = left > 0;
    label();
    const timer =
      left > 0
        ? setInterval(() => {
            left--;
            label();
            if (left <= 0) {
              ok.disabled = false;
              clearInterval(timer);
            }
          }, 1000)
        : null;
    $('modal').hidden = false;
    const done = (v) => {
      clearInterval(timer);
      $('modal').hidden = true;
      ok.onclick = cancel.onclick = null;
      resolve(v);
    };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    if (onOpen) onOpen(ok);
  });
}

function saveJournal() {
  if (state.journal.length > 300) state.journal = state.journal.slice(-300);
  store.set('journal', state.journal);
}

function saveSettingsOnly() {
  store.set('settings', state.settings);
}

function setProgress(text, spinning = true) {
  $('progress').innerHTML = text ? (spinning ? '<span class="spin"></span>' : '') + esc(text) : '';
}

function isLive() {
  return state.settings.mode === 'live';
}

function sideFa(side) {
  return side === 'long' ? 'لانگ' : 'شورت';
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
}

function minutesAgo(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'همین الان';
  if (m < 60) return `${toFaDigits(m)} دقیقه پیش`;
  return `${toFaDigits(Math.floor(m / 60))} ساعت و ${toFaDigits(m % 60)} دقیقه پیش`;
}

function signedToman(rials) {
  if (!isFinite(rials)) return '—';
  return (rials >= 0 ? '+' : '−') + fmtToman(Math.abs(rials));
}

function makeApi() {
  const { nbKey, nbPriv } = state.secrets;
  try {
    state.api = new Nobitex({ apiKey: nbKey, privateKey: nbPriv || undefined, nacl });
  } catch (e) {
    state.api = new Nobitex({ nacl });
    toast('کلید خصوصی نوبیتکس نامعتبر است: ' + e.message, true);
  }
  state.market = new MarketInfo(state.api);
}

async function ensureMarket() {
  if (!state.market.markets || !state.market.options) await state.market.load();
}

function paperOpen() {
  return state.journal.filter((e) => e.mode === 'paper' && e.status === 'open');
}

function paperBalanceRials() {
  const start = Number(state.settings.paperBalanceToman || 0) * 10;
  const closed = state.journal.filter((e) => e.mode === 'paper' && ['won', 'lost', 'expired', 'closed'].includes(e.status));
  const realized = closed.reduce((s, e) => s + resultOf(e).pnl, 0);
  const locked = paperOpen().reduce((s, e) => s + (Number(e.collateral) || 0), 0);
  return { total: start + realized, free: start + realized - locked, locked };
}

/** Free balance usable for a new position, in rials. */
async function freeBalanceRials() {
  if (!isLive()) return paperBalanceRials().free;
  const b = await state.api.marginBalanceRials();
  return b.balance - (b.blocked || 0);
}

async function refreshBalance() {
  const badge = $('mode-badge');
  badge.textContent = isLive() ? 'پول واقعی' : 'آزمایشی';
  badge.className = 'badge ' + (isLive() ? 'live' : 'paper');
  try {
    if (isLive()) {
      const b = await state.api.marginBalanceRials();
      const free = b.balance - (b.blocked || 0);
      state.lastBalance = free;
      $('balance').textContent = fmtToman(free) + ' تومان';
      $('balance-sub').textContent = b.blocked > 0 ? `در سفارش‌ها/پوزیشن‌ها: ${fmtToman(b.blocked)} تومان` : '';
    } else {
      const b = paperBalanceRials();
      state.lastBalance = b.free;
      $('balance').textContent = fmtToman(b.free) + ' تومان';
      $('balance-sub').textContent = b.locked > 0 ? `وثیقه پوزیشن‌های آزمایشی: ${fmtToman(b.locked)} تومان` : '';
    }
  } catch (e) {
    $('balance').textContent = '—';
    $('balance-sub').textContent = '';
    if (isLive()) toast('موجودی دریافت نشد: ' + e.message, true);
  }
  renderRiskPreview();
}

/** Open positions for the current mode: { count, symbols }. */
async function openState() {
  if (isLive()) {
    const list = await activePositions(state.api);
    return { count: list.length, symbols: list.map(positionSymbol), list };
  }
  const open = paperOpen();
  return { count: open.length, symbols: open.map((e) => e.symbol), list: [] };
}

// ---------------------------------------------------------------- background scanner
const RUNNER_LABEL = 'ir.personal.nobitexmargin.scan';
// Native plugin id registered by @capacitor/background-runner on Android
// (@CapacitorPlugin(name = "CapacitorBackgroundRunner")). The config key in
// capacitor.config.json is still "BackgroundRunner" — the two names differ.
const RUNNER_PLUGIN = 'CapacitorBackgroundRunner';

function nativeAvailable() {
  const C = window.Capacitor;
  if (!C || typeof C.nativePromise !== 'function') return false;
  const platform = typeof C.getPlatform === 'function' ? C.getPlatform() : C.platform;
  return platform !== 'web';
}

function runnerCall(method, options) {
  if (!nativeAvailable()) return Promise.reject(new Error('بررسی خودکار فقط در اپ اندروید کار می‌کند'));
  return window.Capacitor.nativePromise(RUNNER_PLUGIN, method, options);
}

function bgDispatch(event, details = {}) {
  return runnerCall('dispatchEvent', { label: RUNNER_LABEL, event, details });
}

let lastExclude = [];
function bgConfig(enabled) {
  const s = state.settings;
  return enabled
    ? {
        enabled: true,
        aiBaseUrl: s.aiBaseUrl,
        aiModel: s.aiModel,
        aiKey: state.secrets.aiKey,
        candidates: Number(s.candidates) || 10,
        rules: effectiveSettings(s),
        exclude: lastExclude,
      }
    : { enabled: false };
}

/** Keep the scanner's copy of rules and open markets in sync. */
function syncBgConfig(openSymbols) {
  if (openSymbols) lastExclude = openSymbols.slice();
  if (state.settings.bgEnabled && nativeAvailable()) bgDispatch('configure', bgConfig(true)).catch(() => {});
}

async function refreshBgStatus() {
  const el = $('bg-status');
  $('bg-enabled').checked = !!state.settings.bgEnabled;
  if (!nativeAvailable()) {
    el.textContent = 'در این محیط در دسترس نیست.';
    return null;
  }
  try {
    const r = await bgDispatch('getLatest');
    const st = r && r.status;
    if (!state.settings.bgEnabled) el.textContent = 'خاموش';
    else if (!st) el.textContent = 'روشن — هنوز بررسی‌ای انجام نشده.';
    else if (!st.ok) el.innerHTML = `<span class="neg">آخرین بررسی (${esc(fmtTime(st.at))}) ناموفق: ${esc(st.error)}</span>`;
    else
      el.textContent = `آخرین بررسی: ${fmtTime(st.at)} — ${toFaDigits(st.scanned || 0)} بازار — ${
        st.decision === 'trade' ? 'یک فرصت پیدا شد' : 'فرصت مناسبی نبود'
      }`;
    return r;
  } catch (e) {
    el.textContent = 'وضعیت دریافت نشد: ' + e.message;
    return null;
  }
}

/**
 * Show a new background finding as the current suggestion (once), planned at the live
 * price. Returns true if a finding was adopted.
 */
async function checkBackgroundFinding() {
  if (!state.settings.bgEnabled || !nativeAvailable() || state.busy || !state.pin) return false;
  try {
    const r = await bgDispatch('getLatest');
    const f = r && r.latest;
    if (!f || !f.idea || f.idea.decision !== 'trade' || !f.price) return false;
    if (Date.now() - f.at > BG_FINDING_TTL_MS) return false;
    if (state.settings.bgSeenAt && f.at <= state.settings.bgSeenAt) return false;
    state.settings.bgSeenAt = f.at;
    saveSettingsOnly();
    state.busy = true;
    showTab('suggest');
    setProgress('دریافت پیشنهاد بررسی خودکار و قیمت لحظه‌ای…');
    let planPrice = null;
    let planSpread = null;
    try {
      const best = await currentBest(state.api, f.idea.symbol);
      planPrice = f.idea.side === 'long' ? best.ask : best.bid;
      planSpread = ((best.ask - best.bid) / ((best.ask + best.bid) / 2)) * 100;
    } catch {
      /* fall back to the scanner's price */
    }
    await adoptIdea(
      { idea: f.idea, price: f.price, planPrice, planSpread, spreadPct: f.spreadPct, scanned: f.scanned, warnings: [] },
      f.at,
      'background',
    );
    return true;
  } catch (e) {
    toast('پیشنهاد بررسی خودکار باز نشد: ' + (e.message || e), true);
    return false;
  } finally {
    if (state.busy) {
      state.busy = false;
      setProgress('');
      renderSuggestion();
    }
  }
}

async function toggleBackground(on) {
  const box = $('bg-enabled');
  if (!on) {
    state.settings.bgEnabled = false;
    saveSettingsOnly();
    try {
      await bgDispatch('configure', bgConfig(false));
    } catch {
      /* ignore */
    }
    refreshBgStatus();
    return;
  }
  box.checked = false;
  if (!nativeAvailable()) {
    toast('بررسی خودکار فقط در اپ اندروید کار می‌کند', true);
    return;
  }
  if (!state.settings.aiBaseUrl || !state.settings.aiModel || !state.secrets.aiKey) {
    toast('ابتدا سرویس هوش مصنوعی را تنظیم و ذخیره کنید', true);
    return;
  }
  const ok = await modal(
    `<h2 style="margin-top:0;color:var(--text)">روشن کردن بررسی خودکار</h2>
     <p>برنامه حدود هر ۱۵ دقیقه (زمان دقیق دست اندروید است) بازار را بررسی می‌کند و وقتی فرصتی از قوانین شما رد شود، اعلان می‌دهد.</p>
     <div class="note warn small">برای کار در پس‌زمینه، <b>کلید هوش مصنوعی</b> بدون رمز روی همین گوشی نگه داشته می‌شود (کلیدهای نوبیتکس رمزنگاری‌شده می‌مانند). با خاموش کردن، این کلید پاک می‌شود.</div>
     <div class="note small">هر بررسی یک درخواست به سرویس هوش مصنوعی است؛ یعنی حدود ۹۶ درخواست در روز.</div>`,
    { okText: 'روشن کن' },
  );
  if (!ok) return;
  try {
    const perm = await runnerCall('requestPermissions', { apis: ['notifications'] });
    if (perm && perm.notifications && perm.notifications !== 'granted') {
      toast('اجازه اعلان داده نشد؛ بدون آن پیدا شدن فرصت را نمی‌بینید', true);
    }
    state.settings.bgEnabled = true;
    await bgDispatch('configure', bgConfig(true));
    saveSettingsOnly();
    box.checked = true;
    toast('بررسی خودکار روشن شد ✓');
  } catch (e) {
    state.settings.bgEnabled = false;
    toast('روشن نشد: ' + e.message, true);
  }
  refreshBgStatus();
}

async function runBackgroundNow() {
  if (!state.settings.bgEnabled) {
    toast('ابتدا بررسی خودکار را روشن کنید', true);
    return;
  }
  const btn = $('bg-run');
  btn.disabled = true;
  $('bg-status').innerHTML = '<span class="spin"></span>در حال بررسی… (ممکن است تا یک دقیقه طول بکشد)';
  try {
    const r = await bgDispatch('runNow');
    if (r && r.error) toast('خطا: ' + r.error, true);
    else if (r && r.notified) toast('فرصت پیدا شد و اعلان ارسال شد');
    else toast('بررسی انجام شد؛ فرصتی که از قوانین شما رد شود نبود');
  } catch (e) {
    toast(e.message, true);
  }
  btn.disabled = false;
  await refreshBgStatus();
  checkBackgroundFinding();
}

// ---------------------------------------------------------------- lock screen
function setupLock() {
  const first = !store.get('secrets');
  $('pin2').hidden = !first;
  $('lock-hint').textContent = first ? 'یک رمز ۴ تا ۸ رقمی برای برنامه انتخاب کنید' : 'رمز را وارد کنید';
  $('pin-btn').textContent = first ? 'ساخت رمز' : 'ورود';
  $('lock').hidden = false;
  $('app').hidden = true;
  $('modal').hidden = true;
  $('pin').value = '';
  $('pin2').value = '';
  $('lock-err').textContent = '';
  setTimeout(() => $('pin').focus(), 50);
}

async function submitPin() {
  const pin = normalizeDigits($('pin').value);
  const first = !store.get('secrets');
  $('lock-err').textContent = '';
  if (!/^\d{4,8}$/.test(pin)) {
    $('lock-err').textContent = 'رمز باید ۴ تا ۸ رقم باشد';
    return;
  }
  $('pin-btn').disabled = true;
  try {
    if (first) {
      if (pin !== normalizeDigits($('pin2').value)) throw new Error('دو رمز یکسان نیستند');
      store.set('secrets', await encryptSecrets(pin, {}));
      state.secrets = {};
    } else {
      state.secrets = await decryptSecrets(pin, store.get('secrets'));
    }
    state.pin = pin;
    await onUnlocked();
  } catch (e) {
    $('lock-err').textContent = e.message;
  } finally {
    $('pin-btn').disabled = false;
  }
}

async function onUnlocked() {
  $('lock').hidden = true;
  $('app').hidden = false;
  makeApi();
  fillSettingsForm();
  renderSuggestion();
  await refreshBalance();
  settlePaperTrades().catch(() => {});
  if (isLive() && state.api.hasAuth) {
    activePositions(state.api)
      .then((list) => syncBgConfig(list.map(positionSymbol)))
      .catch(() => {});
  } else syncBgConfig(paperOpen().map((e) => e.symbol));
  checkBackgroundFinding();
}

function lockNow() {
  state.pin = null;
  state.secrets = {};
  state.api = null;
  setupLock();
}

// ---------------------------------------------------------------- tabs
function showTab(name) {
  for (const t of ['suggest', 'positions', 'journal', 'settings']) $('tab-' + t).hidden = t !== name;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'positions') renderPositions();
  if (name === 'journal') settlePaperTrades().finally(renderJournal);
  if (name === 'settings') refreshBgStatus();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- analysis
async function analyze() {
  if (state.busy) return;
  const s = state.settings;
  if (!s.aiBaseUrl || !s.aiModel || !state.secrets.aiKey) {
    toast('ابتدا سرویس هوش مصنوعی را در تنظیمات وارد کنید', true);
    showTab('settings');
    return;
  }
  if (isLive() && !state.api.hasAuth) {
    toast('برای حالت پول واقعی، کلید API نوبیتکس لازم است', true);
    showTab('settings');
    return;
  }
  state.busy = true;
  $('analyze-btn').disabled = true;
  state.current = null;
  renderSuggestion();
  try {
    setProgress('بررسی پوزیشن‌های باز…');
    let open = { symbols: [] };
    try {
      open = await openState();
    } catch {
      /* not fatal for the analysis */
    }
    const res = await runAnalysis(
      state.api,
      state.market,
      { baseUrl: s.aiBaseUrl, apiKey: state.secrets.aiKey, model: s.aiModel },
      Number(s.candidates) || 10,
      (stage, i, total) => {
        if (stage === 'markets') setProgress('دریافت بازارهای تعهدی…');
        if (stage === 'candles') setProgress(`محاسبه اندیکاتورها: بازار ${toFaDigits(i)} از ${toFaDigits(total)}…`);
        if (stage === 'ai') setProgress('تحلیل با هوش مصنوعی…');
      },
      scanRules(s, open.symbols),
    );
    setProgress('بررسی قوانین ریسک…');
    await adoptIdea(res, Date.now(), 'manual');
    setProgress('');
  } catch (e) {
    setProgress('');
    toast(e.message || String(e), true);
  } finally {
    state.busy = false;
    $('analyze-btn').disabled = false;
    renderSuggestion();
  }
}

/** Make an analysis result (manual or background) the current suggestion. */
async function adoptIdea(res, createdAt, source) {
  const idea = res.idea;
  const current = {
    idea,
    createdAt,
    source,
    status: 'new',
    warnings: [...(res.warnings || [])],
    scanned: res.scanned,
    price: res.price,
    spreadPct: res.spreadPct,
  };
  if (idea.decision === 'trade' && res.price) {
    await ensureMarket();
    const r = await planFor(idea, res.planPrice || res.price, res.planSpread ?? res.spreadPct);
    current.plan = r.plan;
    current.reasons = r.reasons;
  }
  state.current = current;
}

/** Run the risk engine for an idea at a given price. */
async function planFor(idea, price, spreadPct) {
  await ensureMarket();
  const market = state.market.markets[idea.symbol];
  const precision = state.market.precision(idea.symbol);
  const open = await openState();
  const balance = await freeBalanceRials();
  const r = buildPlan(idea, {
    symbol: idea.symbol,
    price,
    balanceRials: balance,
    market,
    ...precision,
    settings: state.settings,
    tradesToday: tradesToday(state.journal, state.settings.mode),
    openPositions: open.count,
    openSymbols: open.symbols,
    spreadPct,
  });
  return { ok: r.ok, plan: r.plan || null, reasons: r.reasons || [] };
}

function planGrid(p) {
  return `
    <div class="grid">
      <div><span>جهت</span><span class="${p.side === 'long' ? 'pos' : 'neg'}">${p.side === 'long' ? 'لانگ (خرید)' : 'شورت (فروش)'}</span></div>
      <div><span>اهرم</span><span>${toFaDigits(p.leverage)}x</span></div>
      <div><span>قیمت ورود (تقریبی)</span><span>${fmtToman(p.price)}</span></div>
      <div><span>حجم</span><span dir="ltr">${fmtNum(p.amount, 8)} ${esc((p.src || '').toUpperCase())}</span></div>
      <div><span>حد ضرر</span><span class="neg">${fmtToman(p.stopPrice)} <small>(${fmtPct(p.stopPct, 1)})</small></span></div>
      <div><span>حد سود</span><span class="pos">${fmtToman(p.tpPrice)} <small>(${fmtPct(p.tpPct, 1)})</small></span></div>
      <div><span>ارزش پوزیشن</span><span>${fmtToman(p.notional)} ت</span></div>
      <div><span>وثیقه</span><span>${fmtToman(p.collateral)} ت</span></div>
      <div><span>ضرر در صورت حد ضرر</span><span class="neg">−${fmtToman(p.lossAtStop)} ت</span></div>
      <div><span>سود در صورت حد سود</span><span class="pos">+${fmtToman(p.gainAtTp)} ت</span></div>
    </div>`;
}

function renderSuggestion() {
  const box = $('suggestion');
  const c = state.current;
  if (!c) {
    box.innerHTML = state.busy
      ? ''
      : `<div class="card muted small">با زدن «تحلیل بازار»، برنامه بازارهای تعهدی ریالی را بررسی می‌کند و بهترین فرصت را پیشنهاد می‌دهد. هیچ سفارشی بدون تایید شما ثبت نمی‌شود.</div>`;
    return;
  }
  const i = c.idea;
  const warn = c.warnings.map((w) => `<div class="note warn small">${esc(w)}</div>`).join('');
  const view = i.market_view_fa ? `<div class="note small">${esc(i.market_view_fa)}</div>` : '';
  if (i.decision !== 'trade') {
    box.innerHTML = `
      <div class="card">
        <div class="sym">فعلاً فرصت مناسبی نیست</div>
        <div class="small muted">${toFaDigits(c.scanned || 0)} بازار بررسی شد · ${esc(minutesAgo(c.createdAt))}</div>
        <p>${esc(i.reasoning_fa || i.invalid || 'شرایط مناسبی پیدا نشد.')}</p>
        ${view}${warn}
      </div>`;
    return;
  }
  const p = c.plan;
  const age = Date.now() - c.createdAt;
  let actions = '';
  if (c.status === 'open') {
    actions = `<div class="note small">✓ ثبت شد. پیگیری از بخش «پوزیشن‌ها».</div>`;
  } else if (c.status === 'skipped') {
    actions = `<div class="note small">این پیشنهاد را رد کردید.</div>`;
  } else if (p) {
    actions = `<div class="btn-row">
        <button class="btn ghost" id="reject-btn">رد</button>
        <button class="btn ${p.side}" id="accept-btn">${isLive() ? 'تایید و ثبت در نوبیتکس' : 'تایید (آزمایشی)'}</button>
      </div>`;
  } else {
    actions = `<div class="btn-row"><button class="btn ghost" id="recheck-btn">بررسی دوباره با قیمت فعلی</button></div>`;
  }
  const blocked =
    !p && c.reasons && c.reasons.length
      ? `<div class="note bad small"><b>فعلاً قابل ثبت نیست:</b><ul class="reasons">${c.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>`
      : '';
  const capped = p && p.cappedByBalance ? `<div class="note warn small">حجم به‌خاطر موجودی آزاد محدود شد.</div>` : '';
  const stale = age > STALE_WARN_MS && c.status === 'new' ? `<div class="age">این تحلیل ${esc(minutesAgo(c.createdAt))} انجام شده؛ هنگام تایید با قیمت لحظه‌ای دوباره محاسبه می‌شود.</div>` : '';
  box.innerHTML = `
    <div class="card">
      <div class="sugg-head">
        <span class="sym" dir="ltr">${esc(i.symbol)}</span>
        <span class="side ${i.side}">${sideFa(i.side)}</span>
      </div>
      ${c.source === 'background' ? `<div class="src">پیدا شده در بررسی خودکار، ساعت ${esc(fmtTime(c.createdAt))}</div>` : ''}
      <div class="small muted" style="margin-top:6px">اطمینان تحلیل: ${toFaDigits(Math.round(i.confidence))}٪ · نگه‌داری حدود ${toFaDigits(Math.round(i.holding_hours))} ساعت</div>
      <div class="conf"><i style="width:${Math.max(0, Math.min(100, i.confidence))}%"></i></div>
      ${stale}
      ${p ? planGrid(p) : ''}
      <p style="margin:8px 0 0">${esc(i.reasoning_fa)}</p>
      ${i.risks_fa ? `<div class="note warn small"><b>ریسک‌ها:</b> ${esc(i.risks_fa)}</div>` : ''}
      ${view}${blocked}${capped}${warn}
      ${actions}
    </div>`;
  const acc = $('accept-btn');
  if (acc) acc.onclick = acceptSuggestion;
  const rej = $('reject-btn');
  if (rej)
    rej.onclick = () => {
      c.status = 'skipped';
      renderSuggestion();
    };
  const rc = $('recheck-btn');
  if (rc) rc.onclick = () => recheckSuggestion();
}

/** Re-run the risk engine for the current idea at the live price. */
async function recheckSuggestion(silent = false) {
  const c = state.current;
  if (!c || state.busy || (silent === true && (c.status !== 'new' || c.idea.decision !== 'trade'))) return;
  state.busy = true;
  try {
    setProgress('دریافت قیمت لحظه‌ای و بررسی دوباره…');
    const best = await currentBest(state.api, c.idea.symbol);
    const price = c.idea.side === 'long' ? best.ask : best.bid;
    const spread = ((best.ask - best.bid) / ((best.ask + best.bid) / 2)) * 100;
    const r = await planFor(c.idea, price, spread);
    c.plan = r.plan;
    c.reasons = r.reasons;
    if (silent !== true) toast(r.ok ? 'حالا قابل ثبت است' : 'هنوز قابل ثبت نیست', !r.ok);
  } catch (e) {
    if (silent !== true) toast(e.message || String(e), true);
  } finally {
    setProgress('');
    state.busy = false;
    renderSuggestion();
  }
}

function newJournalEntry(c, p, extra = {}) {
  const entry = {
    id: 'e' + Date.now(),
    mode: state.settings.mode,
    createdAt: c.createdAt,
    source: c.source || 'manual',
    symbol: c.idea.symbol,
    side: c.idea.side,
    confidence: c.idea.confidence,
    reasoning: c.idea.reasoning_fa,
    ...p,
    ...extra,
  };
  state.journal.push(entry);
  saveJournal();
  return entry;
}

async function acceptSuggestion() {
  const c = state.current;
  if (!c || state.busy || c.status !== 'new') return;
  state.busy = true;
  try {
    setProgress('دریافت قیمت لحظه‌ای…');
    const best = await currentBest(state.api, c.idea.symbol);
    const price = c.idea.side === 'long' ? best.ask : best.bid;
    const spreadNow = ((best.ask - best.bid) / ((best.ask + best.bid) / 2)) * 100;
    const ref = c.price || (c.plan && c.plan.price) || price;
    const movedPct = ((price - ref) / ref) * 100;
    const res = await planFor(c.idea, price, spreadNow);
    setProgress('');
    if (!res.ok) {
      c.plan = null;
      c.reasons = res.reasons;
      throw new Error(res.reasons.join(' — '));
    }
    const p = res.plan;
    c.plan = p;

    if (!isLive()) {
      newJournalEntry(c, p, { status: 'open', openedAt: Date.now() });
      c.status = 'open';
      toast('معامله آزمایشی ثبت شد');
      refreshBalance();
      syncBgConfig(paperOpen().map((e) => e.symbol));
      return;
    }

    const movedNote =
      Math.abs(movedPct) >= 0.3
        ? `<div class="note warn small">قیمت از زمان تحلیل ${fmtPct(Math.abs(movedPct), 1)} ${
            movedPct > 0 ? 'بالا' : 'پایین'
          } رفته؛ حد سود و ضرر بر اساس قیمت فعلی محاسبه شده‌اند.</div>`
        : '';
    const ok = await modal(
      `<h2 style="margin-top:0;color:var(--text)">ثبت معامله واقعی در نوبیتکس</h2>
       <div class="sugg-head"><span class="sym" dir="ltr">${esc(p.symbol)}</span><span class="side ${p.side}">${sideFa(p.side)}</span></div>
       ${planGrid(p)}
       ${movedNote}
       <div class="note warn small">سفارش ورود به‌صورت بازار (با سقف لغزش ۰٫۳٪) ثبت می‌شود و بلافاصله حد سود و حد ضرر گذاشته می‌شود. در حرکت‌های شدید، ضرر می‌تواند از مقدار بالا بیشتر شود.</div>`,
      { okText: 'ثبت سفارش', okClass: p.side, countdown: 2 },
    );
    if (!ok) return;

    state.busy = true;
    const precision = state.market.precision(p.symbol);
    const result = await executePlan(state.api, p, precision, (t) => setProgress(t));
    newJournalEntry(c, p, {
      status: 'open',
      openedAt: Date.now(),
      orderId: result.orderId,
      positionId: result.positionId,
      protectedOk: result.protectedOk,
      warnings: result.warnings,
    });
    c.status = 'open';
    setProgress('');
    if (result.warnings.length) {
      await modal(`<h2 style="margin-top:0;color:var(--short)">توجه</h2>${result.warnings.map((w) => `<div class="note bad small">${esc(w)}</div>`).join('')}`, {
        okText: 'متوجه شدم',
        cancelText: null,
      });
    } else toast('سفارش ثبت شد و حد سود/ضرر فعال است ✓');
    refreshBalance();
    activePositions(state.api)
      .then((list) => syncBgConfig(list.map(positionSymbol)))
      .catch(() => {});
  } catch (e) {
    setProgress('');
    toast(e.message || String(e), true);
  } finally {
    state.busy = false;
    renderSuggestion();
  }
}

// ---------------------------------------------------------------- paper settlement
async function settlePaperTrades() {
  const open = paperOpen();
  if (!open.length || !state.api) return;
  const nowSec = Math.floor(Date.now() / 1000);
  let changed = false;
  for (const e of open) {
    try {
      const d = await state.api.ohlcRange(e.symbol, '15', Math.floor(e.openedAt / 1000) - 900, nowSec);
      const res = settlePaper(e, candlesFromUdf(d), nowSec);
      if (res) {
        Object.assign(e, res);
        changed = true;
      }
    } catch {
      /* try next time */
    }
  }
  if (changed) {
    saveJournal();
    refreshBalance();
  }
}

// ---------------------------------------------------------------- positions
function pnlBlock(pnl) {
  if (!pnl) return '';
  return `<div class="pnl-big ${pnl.pnl >= 0 ? 'pos' : 'neg'}">${signedToman(pnl.pnl)} تومان ${
    pnl.pct !== null && isFinite(pnl.pct) ? `<small>(${pnl.pct >= 0 ? '+' : '−'}${fmtPct(Math.abs(pnl.pct), 1)})</small>` : ''
  }</div>`;
}

async function bestPrices(symbols) {
  const out = {};
  await Promise.all(
    [...new Set(symbols)].map(async (s) => {
      try {
        out[s] = await currentBest(state.api, s);
      } catch {
        /* skip */
      }
    }),
  );
  return out;
}

async function renderPositions() {
  const box = $('positions');
  if (!isLive()) return renderPaperPositions(box);
  if (!state.api.hasAuth) {
    box.innerHTML = '<div class="card muted small">کلید API نوبیتکس تنظیم نشده است.</div>';
    return;
  }
  box.innerHTML = '<p class="muted small center"><span class="spin"></span>دریافت پوزیشن‌ها…</p>';
  try {
    const [list] = await Promise.all([activePositions(state.api), ensureMarket().catch(() => {})]);
    syncClosedLive(list).catch(() => {});
    syncBgConfig(list.map(positionSymbol));
    if (!list.length) {
      box.innerHTML = '<div class="card muted small">پوزیشن بازی ندارید.</div>';
      return;
    }
    const books = await bestPrices(list.map(positionSymbol));
    box.innerHTML = list
      .map((p) => {
        const side = positionSide(p);
        const symbol = positionSymbol(p);
        const entry = state.journal.find((e) => e.mode === 'live' && e.positionId === p.id);
        const prec = state.market.precision(symbol);
        const best = books[symbol];
        const pnl = positionPnl(p, best, entry && entry.amount, prec.amountStep);
        const amount = positionAmounts(p, entry && entry.amount, prec.amountStep, best && (best.ask + best.bid) / 2)[0];
        const cur = best ? (side === 'long' ? best.bid : best.ask) : null;
        const rows = [
          ['قیمت ورود', p.entryPrice ? fmtToman(p.entryPrice) : '—'],
          ['قیمت فعلی', cur ? fmtToman(cur) : '—'],
          ['قیمت لیکوئید', p.liquidationPrice ? `<span class="neg">${fmtToman(p.liquidationPrice)}</span>` : '—'],
          ['وثیقه', p.collateral ? fmtToman(p.collateral) + ' ت' : '—'],
          ['حجم', amount ? `<span dir="ltr">${fmtNum(amount, 8)} ${esc(String(p.srcCurrency || '').toUpperCase())}</span>` : '—'],
          ['اهرم', p.leverage ? toFaDigits(p.leverage) + 'x' : entry ? toFaDigits(entry.leverage) + 'x' : '—'],
        ];
        if (entry && entry.stopPrice) {
          rows.push(['حد ضرر', `<span class="neg">${fmtToman(entry.stopPrice)}</span>`]);
          rows.push(['حد سود', `<span class="pos">${fmtToman(entry.tpPrice)}</span>`]);
        }
        const unprotected = !entry || entry.protectedOk === false;
        return `<div class="card">
          <div class="sugg-head"><span class="sym" dir="ltr">${esc(symbol)}</span>
          ${side ? `<span class="side ${side}">${sideFa(side)}</span>` : ''}</div>
          ${pnlBlock(pnl)}
          <div class="grid">${rows.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('')}</div>
          ${entry && entry.protectedOk === false ? '<div class="note bad small">حد ضرر برای این پوزیشن ثبت نشده است!</div>' : ''}
          ${!entry ? '<div class="note warn small">این پوزیشن خارج از برنامه باز شده یا برنامه حد سود/ضرر آن را نمی‌شناسد.</div>' : ''}
          <div class="btn-row">
            <button class="btn ghost" data-protect="${esc(p.id)}">${unprotected ? 'ثبت حد سود/ضرر' : 'تغییر حد سود/ضرر'}</button>
            <button class="btn danger" data-close="${esc(p.id)}">بستن فوری</button>
          </div>
        </div>`;
      })
      .join('');
    box.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => closeLive(list.find((p) => String(p.id) === b.dataset.close))));
    box.querySelectorAll('[data-protect]').forEach(
      (b) => (b.onclick = () => editProtection(list.find((p) => String(p.id) === b.dataset.protect), books)),
    );
  } catch (e) {
    box.innerHTML = `<div class="card note bad small">${esc(e.message)}</div>`;
  }
}

async function renderPaperPositions(box) {
  const open = paperOpen();
  if (!open.length) {
    box.innerHTML = '<div class="card muted small">معامله آزمایشی بازی ندارید.</div>';
    return;
  }
  box.innerHTML = '<p class="muted small center"><span class="spin"></span>دریافت قیمت‌ها…</p>';
  await settlePaperTrades().catch(() => {});
  const still = paperOpen();
  const books = await bestPrices(still.map((e) => e.symbol));
  box.innerHTML = still.length
    ? still
        .map((e) => {
          const best = books[e.symbol];
          let pnl = null;
          if (best) {
            const exit = e.side === 'long' ? best.bid : best.ask;
            const r = resultOf({ ...e, exitPrice: exit });
            pnl = { pnl: r.pnl, pct: e.collateral ? (r.pnl / e.collateral) * 100 : null };
          }
          return `<div class="card">
            <div class="sugg-head"><span class="sym" dir="ltr">${esc(e.symbol)}</span><span class="side ${e.side}">${sideFa(e.side)}</span></div>
            ${pnlBlock(pnl)}
            ${planGrid(e)}
            <div class="btn-row"><button class="btn ghost" data-close-paper="${esc(e.id)}">بستن با قیمت فعلی</button></div>
          </div>`;
        })
        .join('')
    : '<div class="card muted small">معامله آزمایشی بازی ندارید.</div>';
  box.querySelectorAll('[data-close-paper]').forEach((b) => (b.onclick = () => closePaper(b.dataset.closePaper)));
}

/** Mark journal entries whose live position is gone as closed (with PnL if the exchange reports it). */
async function syncClosedLive(activeList) {
  const activeIds = new Set(activeList.map((p) => p.id));
  const gone = state.journal.filter((e) => e.mode === 'live' && e.status === 'open' && e.positionId && !activeIds.has(e.positionId));
  if (!gone.length) return;
  let past = [];
  try {
    past = (await state.api.positions('past')).positions || [];
  } catch {
    /* ignore */
  }
  for (const e of gone) {
    const p = past.find((x) => x.id === e.positionId);
    e.status = 'closed';
    e.closedAt = Date.now();
    if (p) {
      const pnl = Number(p.PNL ?? p.pnl ?? p.realizedPNL ?? p.realizedPnl ?? p.profit);
      if (isFinite(pnl)) e.realizedPnl = pnl;
      const exit = Number(p.exitPrice ?? p.closePrice);
      if (exit > 0) e.exitPrice = exit;
    }
  }
  saveJournal();
}

async function closePaper(id) {
  const e = state.journal.find((x) => x.id === id);
  if (!e) return;
  try {
    const best = await currentBest(state.api, e.symbol);
    Object.assign(e, { status: 'closed', exitPrice: e.side === 'long' ? best.bid : best.ask, closedAt: Date.now() });
    saveJournal();
    toast('بسته شد');
    renderPositions();
    refreshBalance();
    syncBgConfig(paperOpen().map((x) => x.symbol));
  } catch (err) {
    toast(err.message, true);
  }
}

async function closeLive(p) {
  if (!p) return;
  const symbol = positionSymbol(p);
  const ok = await modal(
    `<h2 style="margin-top:0;color:var(--text)">بستن فوری ${esc(symbol)}</h2><p>ابتدا سفارش‌های حد سود/ضرر این بازار لغو می‌شوند، بعد پوزیشن با قیمت بازار (حداکثر لغزش ۰٫۵٪) بسته می‌شود.</p>`,
    { okText: 'بستن', okClass: 'short', countdown: 1 },
  );
  if (!ok) return;
  const entry = state.journal.find((e) => e.mode === 'live' && e.positionId === p.id);
  try {
    toast('در حال بستن…');
    await ensureMarket();
    await closeNow(state.api, p, state.market.precision(symbol), entry && entry.amount);
    toast('دستور بستن ثبت شد ✓');
    setTimeout(() => {
      renderPositions();
      refreshBalance();
    }, 2500);
  } catch (e) {
    toast('بستن ناموفق: ' + e.message, true);
  }
}

/** Set or change TP/SL of any open position. */
async function editProtection(p, books) {
  if (!p) return;
  const symbol = positionSymbol(p);
  const side = positionSide(p) || 'long';
  const entry = state.journal.find((e) => e.mode === 'live' && e.positionId === p.id);
  await ensureMarket().catch(() => {});
  const prec = state.market.precision(symbol);
  let best = books && books[symbol];
  try {
    best = await currentBest(state.api, symbol);
  } catch {
    /* use cached */
  }
  const ref = best ? (best.ask + best.bid) / 2 : Number(p.entryPrice);
  if (!(ref > 0)) {
    toast('قیمت فعلی این بازار در دسترس نیست', true);
    return;
  }
  const defSl = entry && entry.stopPrice ? Math.abs((entry.stopPrice - ref) / ref) * 100 : 2;
  const defTp = entry && entry.tpPrice ? Math.abs((entry.tpPrice - ref) / ref) * 100 : 4;
  let prices = null;
  const ok = await modal(
    `<h2 style="margin-top:0;color:var(--text)">حد سود و ضرر ${esc(symbol)} <span class="side ${side}" style="font-size:13px">${sideFa(side)}</span></h2>
     <p class="small muted">فاصله‌ها نسبت به قیمت فعلی (${fmtToman(ref)} تومان) است.</p>
     <div class="inline-inputs">
       <label>حد ضرر ٪<input id="pe-sl" type="number" step="0.1" min="${FIXED.MIN_STOP_PCT}" max="${FIXED.MAX_STOP_PCT}" inputmode="decimal" value="${defSl.toFixed(1)}" /></label>
       <label>حد سود ٪<input id="pe-tp" type="number" step="0.1" min="0.3" max="50" inputmode="decimal" value="${defTp.toFixed(1)}" /></label>
     </div>
     <div id="pe-preview" class="note small"></div>`,
    {
      okText: 'ثبت',
      onOpen: (okBtn) => {
        const upd = () => {
          const sl = Number(normalizeDigits($('pe-sl').value));
          const tp = Number(normalizeDigits($('pe-tp').value));
          const valid = sl >= FIXED.MIN_STOP_PCT && sl <= FIXED.MAX_STOP_PCT && tp > 0;
          prices = valid ? protectionPrices(side, ref, sl, tp, prec.priceStep) : null;
          okBtn.disabled = !valid;
          $('pe-preview').innerHTML = valid
            ? `حد ضرر: <b class="neg">${fmtToman(prices.stopPrice)}</b> · حد سود: <b class="pos">${fmtToman(prices.tpPrice)}</b>${
                p.liquidationPrice
                  ? `<br>قیمت لیکوئید: ${fmtToman(p.liquidationPrice)}${
                      (side === 'long' && prices.stopPrice <= Number(p.liquidationPrice)) ||
                      (side === 'short' && prices.stopPrice >= Number(p.liquidationPrice))
                        ? ' — <b class="neg">حد ضرر بعد از لیکوئید است!</b>'
                        : ''
                    }`
                  : ''
              }`
            : `<span class="neg">حد ضرر باید بین ${FIXED.MIN_STOP_PCT} و ${FIXED.MAX_STOP_PCT} درصد باشد.</span>`;
        };
        $('pe-sl').oninput = upd;
        $('pe-tp').oninput = upd;
        upd();
      },
    },
  );
  if (!ok || !prices) return;
  const warnings = [];
  toast('در حال ثبت…');
  const done = await protectPosition(state.api, p, prices, entry && entry.amount, prec, () => {}, warnings, true);
  if (entry) {
    Object.assign(entry, prices, { protectedOk: done });
    saveJournal();
  } else if (done) {
    // remember protection for positions opened outside the app
    state.journal.push({
      id: 'x' + Date.now(),
      mode: 'live',
      source: 'external',
      createdAt: Date.now(),
      openedAt: Number(p.openedAt ? Date.parse(p.openedAt) : Date.now()) || Date.now(),
      symbol,
      side,
      positionId: p.id,
      price: Number(p.entryPrice) || ref,
      leverage: Number(p.leverage) || null,
      collateral: Number(p.collateral) || null,
      status: 'open',
      protectedOk: true,
      ...prices,
    });
    saveJournal();
  }
  toast(done ? 'حد سود و ضرر ثبت شد ✓' : warnings.join(' '), !done);
  renderPositions();
}

// ---------------------------------------------------------------- journal
const STATUS_FA = {
  skipped: 'رد شد',
  open: 'باز',
  won: 'حد سود ✓',
  lost: 'حد ضرر',
  expired: 'منقضی',
  closed: 'بسته شد',
};

function renderJournal() {
  const mode = state.settings.mode;
  const list = state.journal.filter((e) => e.mode === mode && STATUS_FA[e.status]);
  const st = stats(list);
  $('stats').innerHTML = `
    <div class="stat"><b>${toFaDigits(st.count)}</b><span>معامله بسته</span></div>
    <div class="stat"><b>${st.count ? fmtPct(st.winRate, 0) : '—'}</b><span>درصد موفق</span></div>
    <div class="stat"><b class="${st.pnl >= 0 ? 'pos' : 'neg'}">${signedToman(st.pnl)}</b><span>سود/زیان (ت)</span></div>`;
  if (!list.length) {
    $('journal').innerHTML = `<div class="card muted small">هنوز معامله‌ای در حالت ${mode === 'live' ? 'واقعی' : 'آزمایشی'} ثبت نشده.</div>`;
    return;
  }
  $('journal').innerHTML =
    '<div class="card">' +
    list
      .slice()
      .reverse()
      .map((e) => {
        const r = resultOf(e);
        const done = ['won', 'lost', 'expired', 'closed'].includes(e.status);
        const date = new Date(e.openedAt || e.createdAt).toLocaleString('fa-IR', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        const showPnl = done && (e.exitPrice || typeof e.realizedPnl === 'number');
        return `<div class="jrow">
          <div><b dir="ltr">${esc(e.symbol)}</b> <span class="side ${e.side}" style="font-size:12px">${sideFa(e.side)}</span>${
            e.source === 'background' ? '<span class="chip">خودکار</span>' : ''
          }<div class="small muted">${esc(date)}</div></div>
          <div style="text-align:left">
            <span class="tag ${e.status}">${STATUS_FA[e.status]}</span>
            ${showPnl ? `<div class="small ${r.pnl >= 0 ? 'pos' : 'neg'}">${signedToman(r.pnl)} ت</div>` : ''}
          </div>
        </div>`;
      })
      .join('') +
    '</div>';
}

// ---------------------------------------------------------------- settings
const RISK_FIELDS = [
  ['s-lev', 'leverage'],
  ['s-risk', 'riskPct'],
  ['s-maxpos', 'maxOpenPositions'],
  ['s-day', 'maxTradesPerDay'],
  ['s-conf', 'minConfidence'],
  ['s-rr', 'minRewardRisk'],
  ['s-spread', 'maxSpreadPct'],
  ['s-vol', 'minVolumeBillionToman'],
];

function readRiskForm() {
  const raw = {};
  for (const [id, key] of RISK_FIELDS) raw[key] = normalizeDigits($(id).value);
  return effectiveSettings(raw);
}

function renderRiskPreview() {
  const el = $('risk-preview');
  if (!el || !$('s-lev')) return;
  const e = readRiskForm();
  const bal = state.lastBalance;
  const per = bal ? (bal * e.riskPct) / 100 : null;
  const liq = 100 / e.leverage;
  el.innerHTML = `با این تنظیمات: هر معامله در صورت خوردن حد ضرر حدود <b>${fmtPct(e.riskPct, 1)}</b> موجودی${
    per ? ` (≈ ${fmtToman(per)} تومان)` : ''
  } ضرر می‌دهد؛ تا <b>${toFaDigits(e.maxOpenPositions)}</b> پوزیشن هم‌زمان${
    per && e.maxOpenPositions > 1 ? ` (بدترین حالت هم‌زمان ≈ ${fmtToman(per * e.maxOpenPositions)} تومان)` : ''
  }؛ ${e.maxTradesPerDay ? `حداکثر ${toFaDigits(e.maxTradesPerDay)} معامله در روز` : 'بدون سقف روزانه'}. با اهرم ${toFaDigits(
    e.leverage,
  )}، حرکت حدود ${fmtPct(liq, 1)} خلاف جهت پوزیشن را لیکوئید می‌کند.`;
}

function fillSettingsForm() {
  const s = state.settings;
  const eff = effectiveSettings(s);
  $('s-paper').value = s.paperBalanceToman;
  for (const [id, key] of RISK_FIELDS) $(id).value = eff[key];
  $('s-ai-url').value = s.aiBaseUrl || '';
  $('s-ai-model').value = s.aiModel || '';
  $('s-ai-key').value = state.secrets.aiKey || '';
  $('s-cands').value = Number(s.candidates) || 10;
  $('s-lock').value = String(s.lockMinutes ?? 30);
  $('bg-enabled').checked = !!s.bgEnabled;
  $('s-nb-key').value = state.secrets.nbKey || '';
  $('s-nb-priv').value = state.secrets.nbPriv || '';
  renderModeSeg();
  renderRiskPreview();
}

function renderModeSeg() {
  document.querySelectorAll('#mode-seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.settings.mode));
}

async function setMode(mode) {
  if (mode === state.settings.mode) return;
  if (mode === 'live') {
    if (!state.secrets.nbKey || !state.secrets.nbPriv) {
      toast('ابتدا کلید API نوبیتکس را وارد و ذخیره کنید', true);
      return;
    }
    const ok = await modal(
      `<h2 style="margin-top:0;color:var(--short)">رفتن به حالت پول واقعی</h2>
       <p>از این به بعد با تایید شما سفارش واقعی در نوبیتکس ثبت می‌شود.</p>`,
      { okText: 'فعال کن', okClass: 'short' },
    );
    if (!ok) return;
  }
  state.settings.mode = mode;
  saveSettingsOnly();
  state.current = null;
  renderModeSeg();
  renderSuggestion();
  refreshBalance();
}

async function saveSettings() {
  const num = (id) => Number(normalizeDigits($(id).value));
  const nbPriv = $('s-nb-priv').value.trim();
  if (nbPriv) {
    try {
      parsePrivateKey(nbPriv);
    } catch (e) {
      $('settings-msg').innerHTML = `<span class="err">${esc(e.message)}</span>`;
      return;
    }
  }
  Object.assign(state.settings, readRiskForm(), {
    paperBalanceToman: num('s-paper') || DEFAULT_SETTINGS.paperBalanceToman,
    aiBaseUrl: $('s-ai-url').value.trim(),
    aiModel: $('s-ai-model').value.trim(),
    candidates: Math.min(20, Math.max(3, Math.round(num('s-cands')) || 10)),
    lockMinutes: Number($('s-lock').value),
  });
  state.secrets = {
    ...state.secrets,
    aiKey: $('s-ai-key').value.trim(),
    nbKey: $('s-nb-key').value.trim(),
    nbPriv,
  };
  if ((!nbPriv || !state.secrets.nbKey) && state.settings.mode === 'live') state.settings.mode = 'paper';
  saveSettingsOnly();
  store.set('secrets', await encryptSecrets(state.pin, state.secrets));
  makeApi();
  fillSettingsForm();
  syncBgConfig();
  $('settings-msg').textContent = 'ذخیره شد ✓';
  setTimeout(() => ($('settings-msg').textContent = ''), 2500);
  refreshBalance();
}

async function testAi() {
  await saveSettings();
  const s = state.settings;
  try {
    const r = await askModel(
      { baseUrl: s.aiBaseUrl, apiKey: state.secrets.aiKey, model: s.aiModel },
      'Reply only with the JSON object {"ok":true}.',
      'ping',
    );
    toast(r && r.ok ? 'اتصال به هوش مصنوعی برقرار است ✓' : 'پاسخ دریافت شد ولی قالب آن غیرمنتظره بود', !(r && r.ok));
  } catch (e) {
    toast(e.message, true);
  }
}

async function testNobitex() {
  await saveSettings();
  try {
    await state.api.marketStats();
    if (!state.api.hasAuth) {
      toast('اتصال عمومی به نوبیتکس برقرار است. کلید API وارد نشده.');
      return;
    }
    const b = await state.api.marginBalanceRials();
    toast(`کلید معتبر است ✓ موجودی تعهدی: ${fmtToman(b.balance)} تومان`);
  } catch (e) {
    toast('خطا: ' + e.message, true);
  }
}

function generateKeys() {
  const kp = nacl.sign.keyPair();
  $('s-nb-priv').value = bytesToB64(kp.secretKey.slice(0, 32));
  $('gen-out').textContent = 'کلید عمومی (برای ثبت در نوبیتکس):\n' + bytesToB64(kp.publicKey);
  toast('کلید خصوصی در خانه مربوطه گذاشته شد؛ بعد از ثبت کلید عمومی در نوبیتکس، ذخیره را بزنید.');
}

async function wipe() {
  const ok = await modal('<h2 style="margin-top:0;color:var(--short)">پاک کردن همه اطلاعات</h2><p>کلیدها، تنظیمات و کارنامه از این گوشی پاک می‌شوند. پوزیشن‌های باز در نوبیتکس دست نمی‌خورند.</p>', {
    okText: 'پاک کن',
    okClass: 'short',
    countdown: 3,
  });
  if (!ok) return;
  try {
    await bgDispatch('configure', { enabled: false });
  } catch {
    /* ignore */
  }
  localStorage.clear();
  location.reload();
}

// ---------------------------------------------------------------- resume
let resumeTimer = null;
/** App came back to the foreground (incl. tapping a notification): lock or refresh. */
function onResume() {
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(async () => {
    const lockMs = Number(state.settings.lockMinutes ?? 30) * 60000;
    if (state.pin && lockMs > 0 && state.hiddenAt && Date.now() - state.hiddenAt > lockMs && !state.busy) {
      lockNow(); // after unlocking, onUnlocked() shows any new finding
      return;
    }
    state.hiddenAt = 0;
    if (!state.pin) return;
    const adopted = await checkBackgroundFinding();
    if (!adopted) await recheckSuggestion(true);
    refreshBalance();
    if (!$('tab-positions').hidden) renderPositions();
  }, 300);
}

// ---------------------------------------------------------------- wiring
function init() {
  if (!nacl) {
    document.body.innerHTML = '<p style="padding:24px">خطا در بارگذاری کتابخانه رمزنگاری</p>';
    return;
  }
  $('pin-btn').onclick = submitPin;
  $('pin').addEventListener('keydown', (e) => e.key === 'Enter' && ($('pin2').hidden ? submitPin() : $('pin2').focus()));
  $('pin2').addEventListener('keydown', (e) => e.key === 'Enter' && submitPin());
  document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  document.querySelectorAll('#mode-seg button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  $('analyze-btn').onclick = analyze;
  $('refresh-pos').onclick = renderPositions;
  $('save-settings').onclick = saveSettings;
  $('test-ai').onclick = testAi;
  $('test-nb').onclick = testNobitex;
  $('gen-key').onclick = generateKeys;
  $('lock-now').onclick = lockNow;
  $('wipe').onclick = wipe;
  $('bg-enabled').onchange = (e) => toggleBackground(e.target.checked);
  $('bg-run').onclick = runBackgroundNow;
  for (const [id] of RISK_FIELDS) $(id).addEventListener('input', renderRiskPreview);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) state.hiddenAt = Date.now();
    else onResume();
  });
  // Capacitor fires these when the Android activity is paused/resumed (e.g. opened from a notification)
  document.addEventListener('pause', () => (state.hiddenAt = Date.now()));
  document.addEventListener('resume', onResume);
  setupLock();
}

init();
