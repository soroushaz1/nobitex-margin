import React, { useState } from 'react';
import { 
  GitBranch, 
  ExternalLink, 
  FolderTree, 
  CheckCircle2, 
  Code2, 
  Zap, 
  FileCode, 
  X, 
  Layers, 
  ShieldAlert, 
  Database,
  ArrowRightLeft,
  Copy,
  Check
} from 'lucide-react';
import { LiveSyncStatus } from '../types';

interface RepoInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  syncStatus: LiveSyncStatus;
}

export const RepoInspectorModal: React.FC<RepoInspectorModalProps> = ({
  isOpen,
  onClose,
  syncStatus,
}) => {
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'ARCHITECTURE' | 'MARGIN_FORMULAS' | 'API_SPEC'>('OVERVIEW');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const repoUrl = 'https://github.com/soroushaz1/nobitex-margin';

  const copyRepoLink = () => {
    navigator.clipboard.writeText(repoUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="bg-[#121824] border border-nobi-border rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[88vh] animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-nobi-border bg-gradient-to-r from-slate-900 via-[#182133] to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <GitBranch className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-white">
                  soroushaz1 / nobitex-margin
                </h3>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30 font-mono">
                  v2.0 Dual IRT/USDT
                </span>
              </div>
              <p className="text-xs text-slate-400">
                بررسی معماری و مشخصات فنی ریپازیتوری معاملات تعهدی نوبیتکس
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={copyRepoLink}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 flex items-center gap-1.5 border border-slate-700 transition-colors"
              title="Copy GitHub URL"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copied ? 'کپی شد' : 'کپی آدرس'}</span>
            </button>
            <a
              href={repoUrl}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              title="Open in GitHub"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-4 py-2 bg-[#0e131d] border-b border-nobi-border overflow-x-auto text-xs">
          <button
            onClick={() => setActiveTab('OVERVIEW')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1.5 ${
              activeTab === 'OVERVIEW'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>معرفی ریپازیتوری & پاسخ</span>
          </button>
          <button
            onClick={() => setActiveTab('ARCHITECTURE')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1.5 ${
              activeTab === 'ARCHITECTURE'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FolderTree className="w-3.5 h-3.5" />
            <span>ساختار ماژول‌ها</span>
          </button>
          <button
            onClick={() => setActiveTab('MARGIN_FORMULAS')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1.5 ${
              activeTab === 'MARGIN_FORMULAS'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>فرمول‌های مارجین و لیکوئید</span>
          </button>
          <button
            onClick={() => setActiveTab('API_SPEC')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1.5 ${
              activeTab === 'API_SPEC'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>ارتباط با API نوبیتکس</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs text-slate-300 flex-1">
          {activeTab === 'OVERVIEW' && (
            <div className="space-y-4">
              {/* Quick Answer Card */}
              <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-200 space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>پاسخ: بله، ساختار و لاجیک ریپازیتوری nobitex-margin پیاده‌سازی و ارتقا داده شد!</span>
                </div>
                <p className="leading-relaxed text-xs text-emerald-200/90">
                  ریپازیتوری <strong className="text-white">soroushaz1/nobitex-margin</strong> پروژه‌ای برای پیاده‌سازی و شبیه‌سازی سیستم معاملات تعهدی (Margin Trading) صرافی نوبیتکس است. 
                  این برنامه طبق خواسته شما به‌طور کامل به‌روزرسانی شده تا کاربر امکان معامله در دو بازار کاملاً مستقل 
                  <span className="font-bold text-emerald-400"> تومان (IRT) </span> 
                  و 
                  <span className="font-bold text-blue-400"> تتر (USDT) </span> 
                  با سوییچ لحظه‌ای، دفتر سفارشات مجزا و فرمول‌های دقیق لیکوئیدیشن نوبیتکس را داشته باشد.
                </p>
              </div>

              {/* Status Banner */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-slate-900/60 rounded-xl border border-nobi-border">
                  <span className="text-slate-400 text-[11px] block">منبع داده فعال:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {syncStatus.source === 'NOBITEX_PUBLIC_API' ? 'Nobitex Public API Live' : 'High-Speed Simulator'}
                  </span>
                </div>
                <div className="p-3 bg-slate-900/60 rounded-xl border border-nobi-border">
                  <span className="text-slate-400 text-[11px] block">نرخ مبنای تتر/تومان:</span>
                  <span className="font-mono font-bold text-amber-400">
                    {syncStatus.usdtIrtRate.toLocaleString()} IRT
                  </span>
                </div>
                <div className="p-3 bg-slate-900/60 rounded-xl border border-nobi-border">
                  <span className="text-slate-400 text-[11px] block">زمان پاسخ موتور (Latency):</span>
                  <span className="font-mono font-bold text-blue-400">
                    {syncStatus.latencyMs}ms
                  </span>
                </div>
              </div>

              {/* Key Features Implemented */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-100 text-sm">امکانات اصلی اضافه شده بر اساس ریپازیتوری:</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-slate-900/40 border border-slate-800 flex items-start gap-2">
                    <ArrowRightLeft className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-slate-200 block">انتخابگر دوگانه IRT و USDT:</strong>
                      تغییر آنی تمام محاسبات، موجودی کیف‌پول، ارزش دفتر سفارشات و نمودار قیمتی به تومان و تتر.
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900/40 border border-slate-800 flex items-start gap-2">
                    <Zap className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-slate-200 block">اهرم تعهد (1x تا 10x):</strong>
                      پشتیبانی از موقعیت‌های خرید تعهدی (Long) و فروش تعهدی (Short) با حالت ایزوله و کراس.
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900/40 border border-slate-800 flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-slate-200 block">محاسبه‌گر لیکوئیدیشن لحظه‌ای:</strong>
                      نمایش فاصله قیمت ورود تا آستانه کال‌مارجین و امکان تزریق وجه تضمین مازاد (Add Margin).
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900/40 border border-slate-800 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-slate-200 block">دیده‌بان ریسک هوشمند Gemini:</strong>
                      تحلیل سبد تعهدی کاربر و ارائه سطوح TP/SL پیشنهادی متناسب با شرایط بازار.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ARCHITECTURE' && (
            <div className="space-y-3 font-mono text-[11px]">
              <p className="font-sans text-slate-300">
                نگاشت ماژول‌های ریپازیتوری <code className="text-emerald-400">nobitex-margin</code> به معماری مدرن React 19 + TypeScript:
              </p>
              <div className="bg-[#0b0f17] p-3 rounded-xl border border-nobi-border space-y-1.5 text-slate-400">
                <div className="text-emerald-400 font-bold">src/</div>
                <div className="pl-4 text-slate-300">├── App.tsx <span className="text-slate-500 font-sans"># استیت مرکزی، بالانس، پوزیشن‌ها، تیکر لحظه‌ای و تبدیل IRT/USDT</span></div>
                <div className="pl-4 text-slate-300">├── types.ts <span className="text-slate-500 font-sans"># اینترفیس‌های QuoteCurrency, Position, Order, TradeEntry</span></div>
                <div className="pl-4 text-slate-300">├── constants.ts <span className="text-slate-500 font-sans"># نرخ ارز، رمزارزها، لوریج مجاز و توابع فرمت‌بندی تومانی/دلاری</span></div>
                <div className="pl-4 text-emerald-300">├── services/</div>
                <div className="pl-8 text-slate-300">├── nobitexService.ts <span className="text-slate-500 font-sans"># فراخوانی API زنده نوبیتکس (/market/stats)</span></div>
                <div className="pl-8 text-slate-300">└── geminiService.ts <span className="text-slate-500 font-sans"># تحلیل مارجین توسط Google GenAI 2.5 Flash</span></div>
                <div className="pl-4 text-emerald-300">├── components/</div>
                <div className="pl-8 text-slate-300">├── Navbar.tsx <span className="text-slate-500 font-sans"># انتخابگر IRT/USDT، کیف‌پول و دیپازیت دمو</span></div>
                <div className="pl-8 text-slate-300">├── MarketHeader.tsx <span className="text-slate-500 font-sans"># نمادها، نرخ بهره استخر تعهدی و آمار ۲۴ ساعته</span></div>
                <div className="pl-8 text-slate-300">├── TradingChart.tsx <span className="text-slate-500 font-sans"># نمودار قیمت تعهد و میانگین متحرک (Recharts)</span></div>
                <div className="pl-8 text-slate-300">├── OrderBook.tsx <span className="text-slate-500 font-sans"># عمق بازار سفارشات و آخرین معاملات</span></div>
                <div className="pl-8 text-slate-300">├── OrderForm.tsx <span className="text-slate-500 font-sans"># فرم معامله خرید/فروش، لوریج، اسلایدر و TP/SL</span></div>
                <div className="pl-8 text-slate-300">└── PositionsTable.tsx <span className="text-slate-500 font-sans"># مدیریت موقعیت‌های باز، ROE، لیکوئید و افزایش مارجین</span></div>
              </div>
            </div>
          )}

          {activeTab === 'MARGIN_FORMULAS' && (
            <div className="space-y-3 font-sans text-xs">
              <h4 className="font-bold text-slate-100">فرمول‌های ریاضی معاملات تعهدی نوبیتکس (قوانین استخر مشارکت):</h4>
              
              <div className="p-3 rounded-xl bg-slate-900/60 border border-nobi-border space-y-2">
                <span className="font-bold text-amber-400 block">۱. وجه تضمین اولیه (Initial Margin):</span>
                <code className="block bg-[#0b0f17] p-2 rounded text-emerald-300 font-mono text-[11px]">
                  Margin = (Position Size * Entry Price) / Leverage
                </code>
                <p className="text-[11px] text-slate-400">
                  مبلغی که از موجودی آزاد ({syncStatus.usdtIrtRate > 0 ? 'تومان یا تتر' : ''}) کاربر کسر و نزد استخر به عنوان وثیقه قفل می‌شود.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/60 border border-nobi-border space-y-2">
                <span className="font-bold text-rose-400 block">۲. قیمت لیکوئیدیشن موقعیت خرید (Long Liquidation):</span>
                <code className="block bg-[#0b0f17] p-2 rounded text-rose-300 font-mono text-[11px]">
                  LiqPrice_Long = EntryPrice * (1 - (1 / Leverage) + MaintenanceMarginRate)
                </code>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/60 border border-nobi-border space-y-2">
                <span className="font-bold text-rose-400 block">۳. قیمت لیکوئیدیشن موقعیت فروش (Short Liquidation):</span>
                <code className="block bg-[#0b0f17] p-2 rounded text-rose-300 font-mono text-[11px]">
                  LiqPrice_Short = EntryPrice * (1 + (1 / Leverage) - MaintenanceMarginRate)
                </code>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/60 border border-nobi-border space-y-2">
                <span className="font-bold text-emerald-400 block">۴. بازده سرمایه (ROE %):</span>
                <code className="block bg-[#0b0f17] p-2 rounded text-emerald-300 font-mono text-[11px]">
                  ROE % = (Unrealized PnL / Initial Margin) * 100
                </code>
              </div>
            </div>
          )}

          {activeTab === 'API_SPEC' && (
            <div className="space-y-3 font-sans text-xs">
              <h4 className="font-bold text-slate-100">مشخصات فراخوانی و تبدیل ارز در نوبیتکس:</h4>
              <p className="text-slate-300 leading-relaxed">
                اندپوینت رسمی نوبیتکس <code className="text-emerald-400 bg-slate-900 px-1 py-0.5 rounded font-mono">https://api.nobitex.ir/market/stats</code> قیمت‌ها را به ریال (RLS) ارسال می‌کند.
                این برنامه به‌طور خودکار:
              </p>
              <ul className="space-y-1.5 list-disc list-inside text-slate-400 text-[11px]">
                <li>قیمت‌های ریالی جفت‌های <span className="font-mono text-slate-200">btc-rls</span>, <span className="font-mono text-slate-200">eth-rls</span> و ... را بر ۱۰ تقسیم کرده و به واحد استاندارد <strong className="text-emerald-400">تومان (IRT)</strong> تبدیل می‌کند.</li>
                <li>جفت‌های تتر شامل <span className="font-mono text-slate-200">btc-usdt</span> را مستقیماً در بازار دلاری با ۲ الی ۴ رقم اعشار بارگذاری می‌نماید.</li>
                <li>نرخ واقعی تبدیل تتر به تومان را از مارکت <span className="font-mono text-slate-200">usdt-rls</span> استخراج کرده و ارزش تخمینی دارایی‌های کاربر را به‌روزرسانی می‌کند.</li>
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#0d121c] border-t border-nobi-border flex justify-between items-center text-xs">
          <span className="text-[11px] text-slate-400">
            سازگار با مشخصات <strong className="text-slate-200">Nobitex Margin API</strong>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-colors"
          >
            متوجه شدم
          </button>
        </div>
      </div>
    </div>
  );
};
