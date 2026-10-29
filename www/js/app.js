// UI controller. All exchange actions go through explicit user confirmation.

import { Nobitex, parsePrivateKey } from './nobitex.js';
import { MarketInfo } from './market.js';
import { askModel, runAnalysis } from './ai.js';
import { buildPlan, effectiveSettings } from './risk.js';
import { candlesFromUdf } from './indicators.js';
import { settlePaper, resultOf, stats, tradesToday } from './journal.js';
import { executePlan, protectPosition, closeNow, activePositions, currentBest, positionSide } from './trade.js';
import { createStore, encryptSecrets, decryptSecrets, DEFAULT_SETTINGS } from './storage.js';
import { fmtToman, fmtNum, fmtPct, toFaDigits, normalizeDigits, bytesToB64 } from './util.js';

const nacl = window.nacl;
const store = createStore();
const $ = (id) => document.getElementById(id);

const SUGGESTION_TTL_MS = 20 * 60 * 1000;
const AUTO_LOCK_MS = 5 * 60 * 1000;

const savedSettings = store.get('settings', {});
// v2: wider scan by default (older installs saved 5 markets)
if (!savedSettings.v) {
  if (savedSettings.candidates === 5) savedSettings.candidates = 10;
  savedSettings.v = 2;
}

const state = {
  pin: null,
  secrets: {},
  settings: { ...DEFAULT_SETTINGS, ...savedSettings },
  journal: store.get('journal', []),
  api: null,
  market: null,
  current: null, // { idea, plan, entryId, createdAt, reasons }
  busy: false,
  hiddenAt: 0,
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
  toastTimer = setTimeout(() => (t.hidden = true), bad ? 6000 : 3500);
}

function modal(html, { okText = 'تایید', okClass = 'primary', countdown = 0, cancelText = 'انصراف' } = {}) {
  return new Promise((resolve) => {
    $('modal-body').innerHTML = html;
    const ok = $('modal-ok');
    const cancel = $('modal-cancel');
    ok.className = 'btn ' + okClass;
    cancel.textContent = cancelText;
    cancel.hidden = cancelText === null;
    let left = countdown;
    const label = () => (ok.textContent = left > 0 ? `${okText} (${toFaDigits(left)})` : okText);
    ok.disabled = left > 0;
    label();
    const timer = left > 0
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
  });
}

function saveJournal() {
  // keep the journal bounded
  if (state.journal.length > 300) state.journal = state.journal.slice(-300);
  store.set('journal', state.journal);
}

function setProgress(text, spinning = true) {
  $('progress').innerHTML = text ? (spinning ? '<span class="spin"></span>' : '') + esc(text) : '';
}

function isLive() {
  return state.settings.mode === 'live';
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

function paperBalanceRials() {
  const start = Number(state.settings.paperBalanceToman || 0) * 10;
  const closed = state.journal.filter((e) => e.mode === 'paper' && ['won', 'lost', 'expired', 'closed'].includes(e.status));
  return start + closed.reduce((s, e) => s + resultOf(e).pnl, 0);
}

async function balanceRials() {
  if (!isLive()) return paperBalanceRials();
  const b = await state.api.marginBalanceRials();
  return b.balance - (b.blocked || 0);
}

async function refreshBalance() {
  const badge = $('mode-badge');
  badge.textContent = isLive() ? 'پول واقعی' : 'آزمایشی';
  badge.className = 'badge ' + (isLive() ? 'live' : 'paper');
  try {
    const b = await balanceRials();
    $('balance').textContent = fmtToman(b) + ' تومان';
  } catch (e) {
    $('balance').textContent = '—';
    if (isLive()) toast('موجودی دریافت نشد: ' + e.message, true);
  }
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

function bgConfig(enabled) {
  const s = state.settings;
  return enabled
    ? { enabled: true, aiBaseUrl: s.aiBaseUrl, aiModel: s.aiModel, aiKey: state.secrets.aiKey, candidates: Number(s.candidates) || 10 }
    : { enabled: false };
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
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

/** Show a recent background finding as the current suggestion (once). */
async function checkBackgroundFinding() {
  if (!state.settings.bgEnabled || !nativeAvailable() || state.busy) return;
  try {
    const r = await bgDispatch('getLatest');
    const f = r && r.latest;
    if (!f || !f.idea || f.idea.decision !== 'trade' || !f.price) return;
    if (Date.now() - f.at > SUGGESTION_TTL_MS) return;
    if (state.settings.bgSeenAt && f.at <= state.settings.bgSeenAt) return;
    state.settings.bgSeenAt = f.at;
    store.set('settings', state.settings);
    state.busy = true;
    await adoptIdea({ idea: f.idea, price: f.price, spreadPct: f.spreadPct, scanned: f.scanned, warnings: [] }, f.at, 'background');
    state.busy = false;
    showTab('suggest');
    renderSuggestion();
  } catch (e) {
    state.busy = false;
  }
}

async function toggleBackground(on) {
  const box = $('bg-enabled');
  if (!on) {
    state.settings.bgEnabled = false;
    store.set('settings', state.settings);
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
     <p>برنامه حدود هر ۱۵ دقیقه (زمان دقیق دست اندروید است) بازار را بررسی می‌کند و فقط وقتی فرصتی از قوانین ریسک رد شود، اعلان می‌دهد.</p>
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
    await bgDispatch('configure', bgConfig(true));
    state.settings.bgEnabled = true;
    store.set('settings', state.settings);
    box.checked = true;
    toast('بررسی خودکار روشن شد ✓');
  } catch (e) {
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
    else toast('بررسی انجام شد؛ فرصت مناسبی نبود');
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
    );
    setProgress('بررسی قوانین ریسک…');
    await adoptIdea(res, Date.now(), null);
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

/**
 * Turn an analysis result (from the app or the background scanner) into the current
 * suggestion: run the risk engine and record it in the journal.
 */
async function adoptIdea(res, createdAt, source) {
  const idea = res.idea;
  const current = { idea, createdAt, source, warnings: [...(res.warnings || [])], scanned: res.scanned };
  if (idea.decision === 'trade' && res.price) {
    if (!state.market.markets) await state.market.load();
    const r = await planFor(idea, res.price, res.spreadPct);
    current.plan = r.plan;
    current.reasons = r.reasons;
    const entry = {
      id: 'e' + Date.now(),
      mode: state.settings.mode,
      createdAt,
      source: source || 'manual',
      symbol: idea.symbol,
      side: idea.side,
      confidence: idea.confidence,
      reasoning: idea.reasoning_fa,
      status: r.ok ? 'suggested' : 'blocked',
      blockReasons: r.reasons,
      ...(r.plan || {}),
    };
    state.journal.push(entry);
    saveJournal();
    current.entryId = entry.id;
  }
  state.current = current;
}

/** Run the risk engine for an idea at a given price. */
async function planFor(idea, price, spreadPct) {
  const market = state.market.markets[idea.symbol];
  const precision = state.market.precision(idea.symbol);
  let openPositions = 0;
  if (isLive()) openPositions = (await activePositions(state.api)).length;
  else openPositions = state.journal.filter((e) => e.mode === 'paper' && e.status === 'open').length;
  const balance = await balanceRials();
  const r = buildPlan(idea, {
    symbol: idea.symbol,
    price,
    balanceRials: balance,
    market,
    ...precision,
    settings: state.settings,
    tradesToday: tradesToday(state.journal, state.settings.mode),
    openPositions,
    spreadPct,
  });
  return { ok: r.ok, plan: r.plan || null, reasons: r.reasons || [] };
}

function planGrid(p) {
  const dirLabel = p.side === 'long' ? 'لانگ (خرید)' : 'شورت (فروش)';
  return `
    <div class="grid">
      <div><span>جهت</span><span class="${p.side === 'long' ? 'pos' : 'neg'}">${dirLabel}</span></div>
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
      : `<div class="card muted small">با زدن «تحلیل بازار»، برنامه پرحجم‌ترین بازارهای تعهدی ریالی را بررسی می‌کند و یک پیشنهاد یا «فعلاً معامله نکن» می‌دهد. هیچ سفارشی بدون تایید شما ثبت نمی‌شود.</div>`;
    return;
  }
  const i = c.idea;
  const warn = c.warnings.map((w) => `<div class="note warn small">${esc(w)}</div>`).join('');
  const view = i.market_view_fa ? `<div class="note small">${esc(i.market_view_fa)}</div>` : '';
  if (i.decision !== 'trade') {
    box.innerHTML = `
      <div class="card">
        <div class="sym">فعلاً معامله نکن</div>
        <p>${esc(i.reasoning_fa || i.invalid || 'شرایط مناسبی پیدا نشد.')}</p>
        ${view}${warn}
      </div>`;
    return;
  }
  const expired = Date.now() - c.createdAt > SUGGESTION_TTL_MS;
  const entry = state.journal.find((e) => e.id === c.entryId);
  const status = entry ? entry.status : 'suggested';
  const p = c.plan;
  let actions = '';
  if (p && status === 'suggested' && !expired) {
    actions = `<div class="btn-row">
        <button class="btn ghost" id="reject-btn">رد</button>
        <button class="btn ${p.side}" id="accept-btn">${isLive() ? 'تایید و ثبت در نوبیتکس' : 'تایید (آزمایشی)'}</button>
      </div>`;
  } else if (status === 'open') {
    actions = `<div class="note small">✓ ثبت شد. پیگیری از بخش «پوزیشن‌ها».</div>`;
  } else if (status === 'skipped') {
    actions = `<div class="note small">این پیشنهاد را رد کردید.</div>`;
  } else if (expired && p) {
    actions = `<div class="note warn small">این پیشنهاد بیش از ۲۰ دقیقه پیش ساخته شده؛ دوباره تحلیل کنید.</div>`;
  }
  const blocked = !p
    ? `<div class="note bad small"><b>قوانین ریسک اجازه این معامله را نمی‌دهند:</b><ul class="reasons">${(c.reasons || [])
        .map((r) => `<li>${esc(r)}</li>`)
        .join('')}</ul></div>`
    : '';
  const capped = p && p.cappedByBalance ? `<div class="note warn small">حجم به‌خاطر سقف موجودی محدود شد.</div>` : '';
  box.innerHTML = `
    <div class="card">
      <div class="sugg-head">
        <span class="sym" dir="ltr">${esc(i.symbol)}</span>
        <span class="side ${i.side}">${i.side === 'long' ? 'لانگ' : 'شورت'}</span>
      </div>
      ${c.source === 'background' ? `<div class="src">پیدا شده در بررسی خودکار، ساعت ${esc(fmtTime(c.createdAt))}</div>` : ''}
      <div class="small muted" style="margin-top:6px">اطمینان تحلیل: ${toFaDigits(Math.round(i.confidence))}٪ · نگه‌داری حدود ${toFaDigits(Math.round(i.holding_hours))} ساعت</div>
      <div class="conf"><i style="width:${Math.max(0, Math.min(100, i.confidence))}%"></i></div>
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
      if (entry) {
        entry.status = 'skipped';
        saveJournal();
      }
      renderSuggestion();
    };
}

async function acceptSuggestion() {
  const c = state.current;
  const entry = state.journal.find((e) => e.id === c.entryId);
  if (!c || !entry || state.busy) return;
  state.busy = true;
  try {
    setProgress('دریافت قیمت لحظه‌ای…');
    const best = await currentBest(state.api, c.idea.symbol);
    const price = c.idea.side === 'long' ? best.ask : best.bid;
    const moved = Math.abs((price - c.plan.price) / c.plan.price) * 100;
    if (moved > c.idea.stop_loss_pct / 2) {
      throw new Error(`قیمت از زمان تحلیل ${fmtPct(moved, 1)} تغییر کرده؛ دوباره تحلیل کنید`);
    }
    const spreadNow = ((best.ask - best.bid) / ((best.ask + best.bid) / 2)) * 100;
    const res = await planFor(c.idea, price, spreadNow);
    if (!res.ok) throw new Error(res.reasons.join(' — '));
    const p = res.plan;
    setProgress('');

    if (!isLive()) {
      Object.assign(entry, p, { status: 'open', openedAt: Date.now() });
      saveJournal();
      c.plan = p;
      toast('معامله آزمایشی ثبت شد');
      renderSuggestion();
      return;
    }

    const ok = await modal(
      `<h2 style="margin-top:0;color:var(--text)">ثبت معامله واقعی در نوبیتکس</h2>
       <div class="sugg-head"><span class="sym" dir="ltr">${esc(p.symbol)}</span><span class="side ${p.side}">${p.side === 'long' ? 'لانگ' : 'شورت'}</span></div>
       ${planGrid(p)}
       <div class="note warn small">سفارش ورود به‌صورت بازار (با سقف لغزش ۰٫۳٪) ثبت می‌شود و بلافاصله حد سود و حد ضرر گذاشته می‌شود. در بدترین حالت (حرکت شدید قیمت) ضرر می‌تواند از مقدار بالا بیشتر شود.</div>`,
      { okText: 'ثبت سفارش', okClass: p.side, countdown: 3 },
    );
    if (!ok) return;

    const precision = state.market.precision(p.symbol);
    const result = await executePlan(state.api, p, precision, (t) => setProgress(t));
    Object.assign(entry, p, {
      status: 'open',
      openedAt: Date.now(),
      orderId: result.orderId,
      positionId: result.positionId,
      protectedOk: result.protectedOk,
      warnings: result.warnings,
    });
    saveJournal();
    c.plan = p;
    setProgress('');
    if (result.warnings.length) {
      await modal(`<h2 style="margin-top:0;color:var(--short)">توجه</h2>${result.warnings.map((w) => `<div class="note bad small">${esc(w)}</div>`).join('')}`, {
        okText: 'متوجه شدم',
        cancelText: null,
      });
    } else toast('سفارش ثبت شد و حد سود/ضرر فعال است ✓');
    refreshBalance();
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
  const open = state.journal.filter((e) => e.mode === 'paper' && e.status === 'open');
  if (!open.length || !state.api) return;
  const nowSec = Math.floor(Date.now() / 1000);
  for (const e of open) {
    try {
      const d = await state.api.ohlcRange(e.symbol, '15', Math.floor(e.openedAt / 1000) - 900, nowSec);
      const res = settlePaper(e, candlesFromUdf(d), nowSec);
      if (res) Object.assign(e, res);
    } catch {
      /* try next time */
    }
  }
  saveJournal();
  refreshBalance();
}

// ---------------------------------------------------------------- positions
// [field, label, kind]  kind: 't' = rial amount shown in toman, 'n' = number, 's' = text
const POS_FIELDS = [
  ['liability', 'بدهی/حجم', 'n'],
  ['collateral', 'وثیقه (ت)', 't'],
  ['entryPrice', 'قیمت ورود (ت)', 't'],
  ['liquidationPrice', 'قیمت لیکوئید (ت)', 't'],
  ['marginRatio', 'نسبت وثیقه', 'n'],
  ['unrealizedPNL', 'سود/زیان باز (ت)', 't'],
  ['unrealizedPNLPercent', 'سود/زیان باز ٪', 'n'],
  ['leverage', 'اهرم', 'n'],
  ['status', 'وضعیت', 's'],
];

function fmtField(v, kind) {
  if (kind === 't' && isFinite(Number(v))) return fmtToman(v);
  if (kind === 'n' && isFinite(Number(v))) return fmtNum(v, 8);
  return esc(String(v));
}

async function renderPositions() {
  const box = $('positions');
  if (!isLive()) {
    const open = state.journal.filter((e) => e.mode === 'paper' && e.status === 'open');
    if (!open.length) {
      box.innerHTML = '<div class="card muted small">معامله آزمایشی بازی ندارید.</div>';
      return;
    }
    box.innerHTML = open
      .map(
        (e) => `<div class="card">
          <div class="sugg-head"><span class="sym" dir="ltr">${esc(e.symbol)}</span><span class="side ${e.side}">${e.side === 'long' ? 'لانگ' : 'شورت'}</span></div>
          ${planGrid(e)}
          <div class="btn-row"><button class="btn ghost" data-close-paper="${esc(e.id)}">بستن با قیمت فعلی</button></div>
        </div>`,
      )
      .join('');
    box.querySelectorAll('[data-close-paper]').forEach((b) => (b.onclick = () => closePaper(b.dataset.closePaper)));
    return;
  }
  if (!state.api.hasAuth) {
    box.innerHTML = '<div class="card muted small">کلید API نوبیتکس تنظیم نشده است.</div>';
    return;
  }
  box.innerHTML = '<p class="muted small center"><span class="spin"></span>دریافت پوزیشن‌ها…</p>';
  try {
    const list = await activePositions(state.api);
    syncClosedLive(list).catch(() => {});
    if (!list.length) {
      box.innerHTML = '<div class="card muted small">پوزیشن بازی ندارید.</div>';
      return;
    }
    box.innerHTML = list
      .map((p) => {
        const side = positionSide(p);
        const entry = state.journal.find((e) => e.positionId === p.id);
        const rows = POS_FIELDS.filter(([k]) => p[k] !== undefined && p[k] !== null && p[k] !== '')
          .map(([k, label, kind]) => `<div><span>${label}</span><span>${fmtField(p[k], kind)}</span></div>`)
          .join('');
        const unprotected = entry && entry.protectedOk === false;
        return `<div class="card">
          <div class="sugg-head"><span class="sym" dir="ltr">${esc(String(p.srcCurrency || '').toUpperCase())}IRT</span>
          ${side ? `<span class="side ${side}">${side === 'long' ? 'لانگ' : 'شورت'}</span>` : ''}</div>
          <div class="grid">${rows}</div>
          ${entry ? `<div class="small muted">حد ضرر برنامه: ${fmtToman(entry.stopPrice)} · حد سود: ${fmtToman(entry.tpPrice)}</div>` : ''}
          ${unprotected ? '<div class="note bad small">حد ضرر برای این پوزیشن ثبت نشده است!</div>' : ''}
          <div class="btn-row">
            ${entry ? `<button class="btn ghost" data-protect="${esc(p.id)}">${unprotected ? 'ثبت حد ضرر' : 'حد سود/ضرر دوباره'}</button>` : ''}
            <button class="btn danger" data-close="${esc(p.id)}">بستن فوری</button>
          </div>
        </div>`;
      })
      .join('');
    box.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => closeLive(list.find((p) => String(p.id) === b.dataset.close))));
    box.querySelectorAll('[data-protect]').forEach((b) => (b.onclick = () => reprotect(list.find((p) => String(p.id) === b.dataset.protect))));
  } catch (e) {
    box.innerHTML = `<div class="card note bad small">${esc(e.message)}</div>`;
  }
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
      const pnl = Number(p.pnl ?? p.PNL ?? p.realizedPnl ?? p.profit);
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
  } catch (err) {
    toast(err.message, true);
  }
}

async function closeLive(p) {
  if (!p) return;
  const ok = await modal('<h2 style="margin-top:0;color:var(--text)">بستن فوری پوزیشن</h2><p>پوزیشن با قیمت بازار (حداکثر لغزش ۰٫۵٪) بسته می‌شود. اگر سفارش حد سود/ضرر فعالی دارد، ممکن است نوبیتکس ابتدا لغو آن را بخواهد.</p>', {
    okText: 'بستن',
    okClass: 'short',
    countdown: 2,
  });
  if (!ok) return;
  try {
    const symbol = `${String(p.srcCurrency).toUpperCase()}IRT`;
    if (!state.market.options) await state.market.load();
    await closeNow(state.api, p, state.market.precision(symbol));
    toast('دستور بستن ثبت شد');
    setTimeout(renderPositions, 2500);
    refreshBalance();
  } catch (e) {
    toast('بستن ناموفق: ' + e.message + ' — از اپ نوبیتکس ببندید', true);
  }
}

async function reprotect(p) {
  const entry = state.journal.find((e) => e.positionId === p.id);
  if (!entry) return;
  try {
    if (!state.market.options) await state.market.load();
    const warnings = [];
    const ok = await protectPosition(state.api, p, entry, state.market.precision(entry.symbol), () => {}, warnings);
    entry.protectedOk = ok;
    saveJournal();
    toast(ok ? 'حد سود و ضرر ثبت شد ✓' : warnings.join(' '), !ok);
    renderPositions();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------------------------------------------------------------- journal
const STATUS_FA = {
  suggested: 'پیشنهاد',
  blocked: 'رد توسط قوانین',
  skipped: 'رد شد',
  open: 'باز',
  won: 'حد سود ✓',
  lost: 'حد ضرر',
  expired: 'منقضی',
  closed: 'بسته شد',
};

function renderJournal() {
  const mode = state.settings.mode;
  const list = state.journal.filter((e) => e.mode === mode);
  const st = stats(list);
  $('stats').innerHTML = `
    <div class="stat"><b>${toFaDigits(st.count)}</b><span>معامله بسته</span></div>
    <div class="stat"><b>${st.count ? fmtPct(st.winRate, 0) : '—'}</b><span>درصد موفق</span></div>
    <div class="stat"><b class="${st.pnl >= 0 ? 'pos' : 'neg'}">${st.pnl >= 0 ? '+' : '−'}${fmtToman(Math.abs(st.pnl))}</b><span>سود/زیان (ت)</span></div>`;
  if (!list.length) {
    $('journal').innerHTML = `<div class="card muted small">هنوز پیشنهادی در حالت ${mode === 'live' ? 'واقعی' : 'آزمایشی'} ثبت نشده.</div>`;
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
        const date = new Date(e.createdAt).toLocaleString('fa-IR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return `<div class="jrow">
          <div><b dir="ltr">${esc(e.symbol)}</b> <span class="side ${e.side}" style="font-size:12px">${e.side === 'long' ? 'لانگ' : 'شورت'}</span><div class="small muted">${esc(date)}</div></div>
          <div style="text-align:left">
            <span class="tag ${e.status}">${STATUS_FA[e.status] || e.status}</span>
            ${done ? `<div class="small ${r.pnl >= 0 ? 'pos' : 'neg'}">${r.pnl >= 0 ? '+' : '−'}${fmtToman(Math.abs(r.pnl))} ت</div>` : ''}
          </div>
        </div>`;
      })
      .join('') +
    '</div>';
}

// ---------------------------------------------------------------- settings
function fillSettingsForm() {
  const s = state.settings;
  const eff = effectiveSettings(s);
  $('s-paper').value = s.paperBalanceToman;
  $('s-lev').value = eff.leverage;
  $('s-risk').value = eff.riskPct;
  $('s-day').value = eff.maxTradesPerDay;
  $('s-ai-url').value = s.aiBaseUrl || '';
  $('s-ai-model').value = s.aiModel || '';
  $('s-ai-key').value = state.secrets.aiKey || '';
  $('s-cands').value = Number(s.candidates) || 10;
  $('bg-enabled').checked = !!s.bgEnabled;
  $('s-nb-key').value = state.secrets.nbKey || '';
  $('s-nb-priv').value = state.secrets.nbPriv || '';
  renderModeSeg();
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
    const paper = stats(state.journal.filter((e) => e.mode === 'paper'));
    const ok = await modal(
      `<h2 style="margin-top:0;color:var(--short)">رفتن به حالت پول واقعی</h2>
       <p>از این به بعد با تایید شما سفارش واقعی در نوبیتکس ثبت می‌شود.</p>
       <div class="note small">کارنامه آزمایشی تا الان: ${toFaDigits(paper.count)} معامله بسته، ${paper.count ? fmtPct(paper.winRate, 0) : '—'} موفق، ${paper.pnl >= 0 ? '+' : '−'}${fmtToman(Math.abs(paper.pnl))} تومان.</div>
       ${paper.count < 10 ? '<div class="note warn small">کمتر از ۱۰ معامله آزمایشی دارید؛ هنوز نمی‌شود درباره کیفیت پیشنهادها قضاوت کرد.</div>' : ''}`,
      { okText: 'می‌دانم، فعال کن', okClass: 'short', countdown: 3 },
    );
    if (!ok) return;
  }
  state.settings.mode = mode;
  store.set('settings', state.settings);
  state.current = null;
  renderModeSeg();
  renderSuggestion();
  refreshBalance();
}

async function saveSettings() {
  const num = (id) => Number(normalizeDigits($(id).value));
  const eff = effectiveSettings({ leverage: num('s-lev'), riskPct: num('s-risk'), maxTradesPerDay: num('s-day') });
  const nbPriv = $('s-nb-priv').value.trim();
  if (nbPriv) {
    try {
      parsePrivateKey(nbPriv);
    } catch (e) {
      $('settings-msg').innerHTML = `<span class="err">${esc(e.message)}</span>`;
      return;
    }
  }
  Object.assign(state.settings, eff, {
    paperBalanceToman: num('s-paper') || DEFAULT_SETTINGS.paperBalanceToman,
    aiBaseUrl: $('s-ai-url').value.trim(),
    aiModel: $('s-ai-model').value.trim(),
    candidates: Math.min(15, Math.max(3, Math.round(num('s-cands')) || 10)),
  });
  state.secrets = {
    ...state.secrets,
    aiKey: $('s-ai-key').value.trim(),
    nbKey: $('s-nb-key').value.trim(),
    nbPriv,
  };
  if (!nbPriv || !state.secrets.nbKey) {
    if (state.settings.mode === 'live') state.settings.mode = 'paper';
  }
  store.set('settings', state.settings);
  store.set('secrets', await encryptSecrets(state.pin, state.secrets));
  makeApi();
  fillSettingsForm();
  if (state.settings.bgEnabled && nativeAvailable()) bgDispatch('configure', bgConfig(true)).catch(() => {});
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
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) state.hiddenAt = Date.now();
    else if (state.pin && state.hiddenAt && Date.now() - state.hiddenAt > AUTO_LOCK_MS && !state.busy) lockNow();
    else if (state.pin) checkBackgroundFinding();
  });
  setupLock();
}

init();
