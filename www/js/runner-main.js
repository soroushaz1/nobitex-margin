// Background runner entry point. Bundled with the shared modules into
// www/runners/background.js by scripts/build-runner.mjs (the runner has no ES modules).
// Runs in a headless JS engine every ~15 minutes (Android decides the exact timing).
// It only reads PUBLIC market data and asks the AI; it never places orders and never
// has access to the Nobitex API keys.

import { Nobitex } from './nobitex.js';
import { MarketInfo } from './market.js';
import { runAnalysis } from './ai.js';
import { ideaLooksValid } from './risk.js';

const KV_CONFIG = 'bg_config';
const KV_LATEST = 'bg_latest';
const KV_LAST_NOTIFY = 'bg_last_notify';
const KV_STATUS = 'bg_status';
const SAME_IDEA_SILENCE_MS = 2 * 60 * 60 * 1000;

function kvGet(key) {
  try {
    const r = CapacitorKV.get(key);
    const v = r && typeof r === 'object' ? r.value : r;
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}

function kvSet(key, value) {
  CapacitorKV.set(key, JSON.stringify(value));
}

const FA = '۰۱۲۳۴۵۶۷۸۹';
function fa(x) {
  return String(x).replace(/[0-9]/g, (d) => FA[d]);
}

async function backgroundCheck(now) {
  const cfg = kvGet(KV_CONFIG);
  if (!cfg || !cfg.enabled || !cfg.aiKey || !cfg.aiBaseUrl || !cfg.aiModel) {
    return { skipped: 'disabled' };
  }
  const api = new Nobitex({ fetchFn: (u, o) => fetch(u, o) });
  const market = new MarketInfo(api);
  const res = await runAnalysis(
    api,
    market,
    { baseUrl: cfg.aiBaseUrl, apiKey: cfg.aiKey, model: cfg.aiModel },
    cfg.candidates || 10,
  );
  const finding = {
    at: now,
    idea: res.idea,
    price: res.price,
    spreadPct: res.spreadPct,
    scanned: res.scanned,
    notified: false,
  };
  if (ideaLooksValid(res.idea, res.spreadPct)) {
    const last = kvGet(KV_LAST_NOTIFY);
    const repeat =
      last && last.symbol === res.idea.symbol && last.side === res.idea.side && now - last.at < SAME_IDEA_SILENCE_MS;
    if (!repeat) {
      const side = res.idea.side === 'long' ? 'لانگ' : 'شورت';
      CapacitorNotifications.schedule([
        {
          id: Math.floor(now / 1000) % 2000000000,
          title: `فرصت معامله: ${res.idea.symbol} ${side}`,
          body: `اطمینان ${fa(Math.round(res.idea.confidence))}٪ · حد ضرر ${fa(res.idea.stop_loss_pct)}٪ · حد سود ${fa(res.idea.take_profit_pct)}٪ — برای بررسی و تایید، برنامه را باز کنید (تا ۲۰ دقیقه معتبر است).`,
          autoCancel: true,
        },
      ]);
      kvSet(KV_LAST_NOTIFY, { at: now, symbol: res.idea.symbol, side: res.idea.side });
      finding.notified = true;
    }
  }
  kvSet(KV_LATEST, finding);
  return finding;
}

async function guardedCheck() {
  const now = Date.now();
  try {
    const f = await backgroundCheck(now);
    kvSet(KV_STATUS, { at: now, ok: true, skipped: f.skipped || null, decision: f.idea ? f.idea.decision : null, scanned: f.scanned || 0 });
    return f;
  } catch (e) {
    kvSet(KV_STATUS, { at: now, ok: false, error: String((e && e.message) || e) });
    return { error: String((e && e.message) || e) };
  }
}

// Scheduled by Android (see capacitor.config.json → BackgroundRunner.event)
addEventListener('checkMarket', async (resolve) => {
  await guardedCheck();
  resolve();
});

// From the app: save/replace the background configuration
addEventListener('configure', (resolve, reject, args) => {
  try {
    const cfg = args || {};
    if (!cfg.enabled) {
      kvSet(KV_CONFIG, { enabled: false });
    } else {
      kvSet(KV_CONFIG, {
        enabled: true,
        aiBaseUrl: String(cfg.aiBaseUrl || ''),
        aiModel: String(cfg.aiModel || ''),
        aiKey: String(cfg.aiKey || ''),
        candidates: Number(cfg.candidates) || 10,
      });
    }
    resolve({ ok: true });
  } catch (e) {
    reject(e);
  }
});

// From the app: what did the background scanner find last?
addEventListener('getLatest', (resolve) => {
  const cfg = kvGet(KV_CONFIG);
  resolve({ latest: kvGet(KV_LATEST), status: kvGet(KV_STATUS), enabled: !!(cfg && cfg.enabled) });
});

// From the app: run one background check right now (for testing)
addEventListener('runNow', async (resolve) => {
  resolve(await guardedCheck());
});
