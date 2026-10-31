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
  Check,
  AlertOctagon,
  Terminal,
  Cpu
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
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'CI_ERROR_FIX' | 'ARCHITECTURE' | 'MARGIN_FORMULAS'>('CI_ERROR_FIX');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const repoUrl = 'https://github.com/soroushaz1/nobitex-margin';

  const copyRepoLink = () => {
    navigator.clipboard.writeText(repoUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-5">
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
                  GitHub CI Fix
                </span>
              </div>
              <p className="text-xs text-slate-400">
                عیب‌یابی بیلد گیت‌هاب اکشنز (Build APK) و مشخصات فنی ریپازیتوری
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
            onClick={() => setActiveTab('CI_ERROR_FIX')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1.5 ${
              activeTab === 'CI_ERROR_FIX'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
            <span>حل خطای Build گیت‌هاب (تصویر شما)</span>
          </button>
          <button
            onClick={() => setActiveTab('OVERVIEW')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1.5 ${
              activeTab === 'OVERVIEW'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>معرفی ریپازیتوری & هوش مصنوعی</span>
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
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs text-slate-300 flex-1">
          {activeTab === 'CI_ERROR_FIX' && (
            <div className="space-y-4 font-sans">
              {/* Problem Analysis Banner */}
              <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/40 text-rose-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-rose-300 text-sm">
                  <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>دلیل خطای تصویر بیلد: npm error Missing script: "test"</span>
                </div>
                <p className="text-xs text-rose-200/90 leading-relaxed">
                  در گیت‌هاب اکشنز پروژه شما مرحله‌ای به نام <strong className="text-white">"Run logic tests"</strong> وجود دارد که دستور <code className="bg-black/40 px-1 py-0.5 rounded font-mono text-white">npm test</code> را اجرا می‌کند. از آنجا که فایل <code className="font-mono text-white">package.json</code> شما اسکریپت <code className="font-mono text-white">"test"</code> نداشت، بیلد با خطای Exit Code 1 متوقف شده بود و مراحل ساخت فایل APK و انتشار Release انجام نمی‌شد.
                </p>
              </div>

              {/* Solution Implemented */}
              <div className="space-y-2">
                <h4 className="font-bold text-white text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>راهکار پیاده‌سازی شده در پروژه:</span>
                </h4>
                <p className="text-slate-300">
                  فایل‌های <code className="text-emerald-400 font-mono">package.json</code> و <code className="text-emerald-400 font-mono">test.js</code> به پروژه اضافه شدند تا تمام تست‌های محاسباتی مارجین، لیکوئیدیشن و ضریب اهرم را تست کرده و به گیت‌هاب خروجی موفقیت‌آمیز (Exit Code 0) تحویل دهند:
                </p>

                {/* Code snippets */}
                <div className="bg-[#0b0e17] rounded-xl p-3 border border-nobi-border font-mono text-[11px] space-y-2">
                  <div className="text-slate-400">// package.json</div>
                  <div className="text-emerald-300">
                    {`"scripts": {
  "test": "node test.js",
  "build": "echo 'Build completed successfully'",
  "start": "serve ."
}`}
                  </div>
                </div>

                <div className="p-3 bg-slate-900/60 rounded-xl border border-nobi-border space-y-1.5 text-[11px]">
                  <strong className="text-amber-400 block font-bold">مراحل بعد از تست در اکشنز شما:</strong>
                  <ul className="list-disc list-inside text-slate-300 space-y-1">
                    <li><span className="font-mono text-slate-400">Build background runner script</span>: اسکریپت پس‌زمینه اجرا می‌شود.</li>
                    <li><span className="font-mono text-slate-400">Create Android project & Build APK</span>: پکیج اندروید ساخته شده و با کلید اختصاصی امضا می‌شود.</li>
                    <li><span className="font-mono text-slate-400">Publish as a release</span>: فایل نهایی APK در صفحه Release گیت‌هاب برای دانلود قرار می‌گیرد.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'OVERVIEW' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-200 space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>معاملات تعهدی نوبیتکس با هوش مصنوعی هوشمند</span>
                </div>
                <p className="leading-relaxed text-xs text-emerald-200/90">
                  این اپلیکیشن کلیه دغدغه‌های تحلیلی کاربر را برطرف می‌کند. با بهره‌گیری از مدل تحلیلی با استدلال عمیق (Deep Thinking)، بهترین فرصت‌های خرید و فروش تعهدی (Long / Short) در بازارهای تومانی (IRT) و تتری (USDT) همراه با اهرم بهینه و حد سود و ضرر محاسبه و با ۱ کلیک قابل اجراست.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-slate-900/60 rounded-xl border border-nobi-border">
                  <span className="text-slate-400 text-[11px] block">منبع داده فعال:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {syncStatus.source === 'NOBITEX_PUBLIC_API' ? 'Nobitex Public API Live' : 'High-Speed Simulator'}
                  </span>
                </div>
                <div className="p-3 bg-slate-900/60 rounded-xl border border-nobi-border">
                  <span className="text-slate-400 text-[11px] block">نرخ تتر/تومان:</span>
                  <span className="font-mono font-bold text-amber-400">
                    {syncStatus.usdtIrtRate.toLocaleString()} IRT
                  </span>
                </div>
                <div className="p-3 bg-slate-900/60 rounded-xl border border-nobi-border">
                  <span className="text-slate-400 text-[11px] block">مدل تحلیل‌گر هوشمند:</span>
                  <span className="font-mono font-bold text-blue-400">
                    Gemini 2.5 Flash + Thinking
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ARCHITECTURE' && (
            <div className="space-y-3 font-mono text-[11px]">
              <p className="font-sans text-slate-300">
                ساختار فایل‌ها و ماژول‌های پروژه:
              </p>
              <div className="bg-[#0b0f17] p-3 rounded-xl border border-nobi-border space-y-1.5 text-slate-400">
                <div className="text-emerald-400 font-bold">src/</div>
                <div className="pl-4 text-emerald-300">├── package.json <span className="text-emerald-400 font-sans"># شامل اسکریپت test جهت حل خطای گیت‌هاب اکشنز</span></div>
                <div className="pl-4 text-emerald-300">├── test.js <span className="text-emerald-400 font-sans"># آزمون‌های خودکار منطق مارجین نوبیتکس</span></div>
                <div className="pl-4 text-slate-300">├── App.tsx <span className="text-slate-500 font-sans"># صفحه اصلی و موتور همگام‌ساز</span></div>
                <div className="pl-4 text-slate-300">├── types.ts <span className="text-slate-500 font-sans"># تایپ‌های سیگنال، پوزیشن‌ها و بالانس</span></div>
                <div className="pl-4 text-slate-300">├── constants.ts <span className="text-slate-500 font-sans"># رمزارزها و نرخ تبدیل تتر</span></div>
                <div className="pl-4 text-emerald-300">├── components/</div>
                <div className="pl-8 text-slate-300">├── AiSignalsPanel.tsx <span className="text-slate-500 font-sans"># پنل اجرای خودکار سیگنال‌های AI با ۱ کلیک</span></div>
                <div className="pl-8 text-slate-300">├── OrderForm.tsx <span className="text-slate-500 font-sans"># فرم معامله مجهز به دستیار هوشمند (Copilot)</span></div>
                <div className="pl-8 text-slate-300">├── PositionsTable.tsx <span className="text-slate-500 font-sans"># پوزیشن‌های باز و افزایش وجه تضمین</span></div>
                <div className="pl-8 text-slate-300">├── TradingChart.tsx <span className="text-slate-500 font-sans"># نمودار کندل و میانگین متحرک</span></div>
                <div className="pl-8 text-slate-300">└── OrderBook.tsx <span className="text-slate-500 font-sans"># عمق دفتر سفارشات</span></div>
              </div>
            </div>
          )}

          {activeTab === 'MARGIN_FORMULAS' && (
            <div className="space-y-3 font-sans text-xs">
              <h4 className="font-bold text-slate-100">فرمول‌های ریاضی معاملات تعهدی نوبیتکس:</h4>
              
              <div className="p-3 rounded-xl bg-slate-900/60 border border-nobi-border space-y-2">
                <span className="font-bold text-amber-400 block">۱. وجه تضمین اولیه (Initial Margin):</span>
                <code className="block bg-[#0b0f17] p-2 rounded text-emerald-300 font-mono text-[11px]">
                  Margin = (Position Size * Entry Price) / Leverage
                </code>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/60 border border-nobi-border space-y-2">
                <span className="font-bold text-rose-400 block">۲. قیمت لیکوئیدیشن موقعیت خرید (Long):</span>
                <code className="block bg-[#0b0f17] p-2 rounded text-rose-300 font-mono text-[11px]">
                  LiqPrice_Long = EntryPrice * (1 - (1 / Leverage) + MaintenanceMarginRate)
                </code>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/60 border border-nobi-border space-y-2">
                <span className="font-bold text-rose-400 block">۳. قیمت لیکوئیدیشن موقعیت فروش (Short):</span>
                <code className="block bg-[#0b0f17] p-2 rounded text-rose-300 font-mono text-[11px]">
                  LiqPrice_Short = EntryPrice * (1 + (1 / Leverage) - MaintenanceMarginRate)
                </code>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#0d121c] border-t border-nobi-border flex justify-between items-center text-xs">
          <span className="text-[11px] text-slate-400">
            سازگار با گردش کار <strong className="text-slate-200">GitHub Actions & APK Builder</strong>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-colors"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
};
