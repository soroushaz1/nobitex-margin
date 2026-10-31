import React, { useState } from 'react';
import { AITradeSignal, QuoteCurrency, CryptoAsset } from '../types';
import { formatCurrency } from '../constants';
import { 
  Sparkles, 
  ArrowUpRight, 
  ArrowDownRight, 
  Zap, 
  ShieldCheck, 
  RefreshCw, 
  Target, 
  CheckCircle,
  HelpCircle,
  ChevronRight,
  TrendingUp,
  BrainCircuit,
  SlidersHorizontal
} from 'lucide-react';

interface AiSignalsPanelProps {
  signals: AITradeSignal[];
  quoteCurrency: QuoteCurrency;
  isLoading: boolean;
  onRefreshSignals: () => void;
  onExecuteSignal: (signal: AITradeSignal) => void;
  onSelectAssetBySymbol: (symbol: string) => void;
}

export const AiSignalsPanel: React.FC<AiSignalsPanelProps> = ({
  signals,
  quoteCurrency,
  isLoading,
  onRefreshSignals,
  onExecuteSignal,
  onSelectAssetBySymbol,
}) => {
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const filteredSignals = signals.filter((s) => {
    if (activeFilter === 'ALL') return true;
    return s.side === activeFilter;
  });

  const handleInstantTrade = (signal: AITradeSignal) => {
    onSelectAssetBySymbol(signal.symbol);
    onExecuteSignal(signal);
    setSuccessNotice(`سفارش هوشمند ${signal.symbol}/${signal.quoteCurrency} با موفقیت در صف معاملات تعهدی ثبت شد!`);
    setTimeout(() => setSuccessNotice(null), 4000);
  };

  return (
    <div className="bg-[#121824] border border-nobi-border rounded-2xl p-3 sm:p-4 mb-3 relative overflow-hidden shadow-xl">
      {/* Background Decorative Glow */}
      <div className="absolute top-0 right-0 w-72 h-40 bg-gradient-to-b from-amber-500/10 via-emerald-500/5 to-transparent blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-nobi-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 via-emerald-500 to-teal-400 p-[1px] shadow-lg shadow-emerald-500/20">
            <div className="w-full h-full bg-[#0d121c] rounded-[11px] flex items-center justify-center text-amber-400">
              <BrainCircuit className="w-5 h-5 animate-pulse" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-extrabold text-white flex items-center gap-1.5">
                <span>سیگنال‌های معاملاتی هوش مصنوعی</span>
                <span className="text-[10px] bg-gradient-to-r from-amber-500/20 to-emerald-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">
                  Gemini 2.5 Flash + Thinking
                </span>
              </h2>
            </div>
            <p className="text-[11px] text-slate-400">
              بدون نیاز به تحلیل فردی؛ موقعیت‌های با احتمال برد بالا را با ۱ کلیک مستقیماً معامله کنید.
            </p>
          </div>
        </div>

        {/* Filter Pills & Refresh */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-900/80 p-0.5 rounded-xl border border-nobi-border text-xs">
            <button
              onClick={() => setActiveFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                activeFilter === 'ALL'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              همه ({signals.length})
            </button>
            <button
              onClick={() => setActiveFilter('BUY')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all flex items-center gap-1 ${
                activeFilter === 'BUY'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              خرید تعهدی (Long)
            </button>
            <button
              onClick={() => setActiveFilter('SELL')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all flex items-center gap-1 ${
                activeFilter === 'SELL'
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              فروش تعهدی (Short)
            </button>
          </div>

          <button
            onClick={onRefreshSignals}
            disabled={isLoading}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition-colors disabled:opacity-50"
            title="تحلیل مجدد اوردربوک و کندل‌ها توسط هوش مصنوعی"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-400' : 'text-slate-300'}`} />
            <span className="hidden sm:inline">تحلیل مجدد AI</span>
          </button>
        </div>
      </div>

      {/* Success Notification Bar */}
      {successNotice && (
        <div className="mt-3 p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between animate-in fade-in zoom-in-95">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successNotice}</span>
          </div>
          <span className="text-[10px] text-emerald-400 font-mono">اجرا شد</span>
        </div>
      )}

      {/* Signals Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-[#0f1420] border border-nobi-border rounded-xl p-4 animate-pulse space-y-3"
            >
              <div className="flex justify-between items-center">
                <div className="w-20 h-5 bg-slate-800 rounded"></div>
                <div className="w-14 h-5 bg-slate-800 rounded"></div>
              </div>
              <div className="w-full h-8 bg-slate-800/60 rounded"></div>
              <div className="w-3/4 h-4 bg-slate-800/40 rounded"></div>
              <div className="w-full h-9 bg-slate-800 rounded-lg"></div>
            </div>
          ))
        ) : filteredSignals.length === 0 ? (
          <div className="col-span-full py-8 text-center text-slate-500 text-xs">
            سیگنالی با این فیلتر یافت نشد. روی "تحلیل مجدد AI" کلیک کنید.
          </div>
        ) : (
          filteredSignals.map((signal) => {
            const isLong = signal.side === 'BUY';
            return (
              <div
                key={signal.id}
                className="bg-[#0f1420] hover:bg-[#131a29] border border-nobi-border hover:border-slate-600 rounded-xl p-3.5 flex flex-col justify-between transition-all group relative overflow-hidden"
              >
                {/* Confidence Badge */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-xs font-black px-2 py-0.5 rounded-md flex items-center gap-1 ${
                        isLong
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                      }`}
                    >
                      {isLong ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      {isLong ? 'Long تعهد خرید' : 'Short تعهد فروش'}
                    </span>
                    <span className="font-extrabold text-sm text-white">
                      {signal.symbol}/{signal.quoteCurrency}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 text-[11px] font-mono">
                    <span className="text-slate-400">اطمینان:</span>
                    <span className="font-bold text-amber-400">{signal.confidenceScore}%</span>
                  </div>
                </div>

                {/* Technical Rationale */}
                <div className="my-1.5 bg-[#0b0e17] p-2 rounded-lg border border-slate-800/80">
                  <p className="text-[11px] text-slate-300 leading-snug line-clamp-2">
                    {signal.rationale}
                  </p>
                  <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400">
                    <span>تحریک: {signal.triggerEvent}</span>
                    <span className="text-amber-300 font-semibold">{signal.timeframe}</span>
                  </div>
                </div>

                {/* Key Metrics: Entry, TP, SL, Leverage */}
                <div className="grid grid-cols-2 gap-1.5 py-1.5 text-[11px] font-mono border-y border-slate-800/60 my-1.5">
                  <div>
                    <span className="text-slate-400 block text-[10px]">قیمت ورود:</span>
                    <span className="font-bold text-slate-200">
                      {formatCurrency(signal.entryPrice, signal.quoteCurrency)}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[10px]">ضریب تعهد (Lev):</span>
                    <span className="font-bold text-amber-400">
                      {signal.recommendedLeverage}x اهرم
                    </span>
                  </div>

                  <div>
                    <span className="text-emerald-400 block text-[10px]">حد سود (TP):</span>
                    <span className="font-semibold text-emerald-400">
                      {formatCurrency(signal.takeProfitPrice, signal.quoteCurrency)}
                      <span className="text-[9px] mr-1 opacity-80">
                        (+{signal.expectedProfitPct}%)
                      </span>
                    </span>
                  </div>

                  <div>
                    <span className="text-rose-400 block text-[10px]">حد ضرر (SL):</span>
                    <span className="font-semibold text-rose-400">
                      {formatCurrency(signal.stopLossPrice, signal.quoteCurrency)}
                      <span className="text-[9px] mr-1 opacity-80">
                        (-{signal.maxRiskPct}%)
                      </span>
                    </span>
                  </div>
                </div>

                {/* 1-Click Action Button */}
                <div className="mt-2 pt-1 flex items-center gap-2">
                  <button
                    onClick={() => handleInstantTrade(signal)}
                    className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs text-white shadow-md flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] ${
                      isLong
                        ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-600/20'
                        : 'bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 shadow-rose-600/20'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5 fill-current" />
                    <span>ورود خودکار با ۱ کلیک</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
