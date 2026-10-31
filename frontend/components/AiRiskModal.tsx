import React, { useState } from 'react';
import { Position, GeminiAnalysisResult, QuoteCurrency, CryptoAsset } from '../types';
import { analyzeMarginRiskWithGemini } from '../services/geminiService';
import { formatCurrency } from '../constants';
import { 
  Sparkles, 
  ShieldAlert, 
  ShieldCheck, 
  AlertTriangle, 
  X, 
  RefreshCw, 
  TrendingUp, 
  CheckCircle2 
} from 'lucide-react';

interface AiRiskModalProps {
  isOpen: boolean;
  onClose: () => void;
  positions: Position[];
  activeQuote: QuoteCurrency;
  currentAsset: CryptoAsset;
  currentPrice: number;
}

export const AiRiskModal: React.FC<AiRiskModalProps> = ({
  isOpen,
  onClose,
  positions,
  activeQuote,
  currentAsset,
  currentPrice,
}) => {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<GeminiAnalysisResult | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    try {
      const res = await analyzeMarginRiskWithGemini(positions, activeQuote, {
        symbol: currentAsset.symbol,
        currentPrice,
        leverage: 5,
        side: 'BUY',
      });
      setAnalysis(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Run on first open if empty
  React.useEffect(() => {
    if (isOpen && !analysis && !loading) {
      runAnalysis();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-nobi-card border border-nobi-border rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-nobi-border bg-gradient-to-r from-slate-900 via-[#161d2d] to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>دیده‌بان هوشمند مارجین نوبیتکس</span>
                <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">
                  Gemini 2.5 Flash
                </span>
              </h3>
              <p className="text-[10px] text-slate-400">
                ارزیابی ریسک لیکوئیدیشن و مدیریت موقعیت‌های تعهدی در بازار {activeQuote}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
              <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
              <p className="text-xs font-semibold text-slate-200">
                در حال تحلیل موقعیت‌های باز، نرخ بهره تامین مالی و فواصل لیکوئید...
              </p>
              <p className="text-[11px] text-slate-500">
                Gemini Margin Intelligence Engine is evaluating market depth
              </p>
            </div>
          ) : analysis ? (
            <>
              {/* Risk Score Meter */}
              <div className="bg-[#101622] rounded-xl p-4 border border-nobi-border flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-400 block mb-1">شاخص ریسک سبد تعهدی:</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-2xl font-mono font-extrabold ${
                        analysis.riskScore > 70
                          ? 'text-rose-400'
                          : analysis.riskScore > 40
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {analysis.riskScore} / 100
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                        analysis.riskLevel === 'CRITICAL' || analysis.riskLevel === 'HIGH'
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          : analysis.riskLevel === 'MEDIUM'
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      }`}
                    >
                      سطح ریسک: {analysis.riskLevel}
                    </span>
                  </div>
                </div>

                <div className="w-24 h-12 flex items-center justify-center">
                  {analysis.riskScore > 60 ? (
                    <ShieldAlert className="w-10 h-10 text-rose-400" />
                  ) : (
                    <ShieldCheck className="w-10 h-10 text-emerald-400" />
                  )}
                </div>
              </div>

              {/* Summary */}
              <div className="bg-slate-900/60 p-3.5 rounded-xl border border-nobi-border text-xs text-slate-300 leading-relaxed">
                <p className="font-semibold text-slate-200 mb-1">خلاصه تحلیل هوش مصنوعی:</p>
                <p>{analysis.summary}</p>
              </div>

              {/* Liquidation Warning */}
              <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl flex items-start gap-2.5 text-xs text-amber-300">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">هشدار آستانه لیکوئیدیشن:</span>
                  <span>{analysis.liquidationProximityWarning}</span>
                </div>
              </div>

              {/* Suggested TP / SL */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#121926] p-3 rounded-xl border border-nobi-border">
                  <span className="text-[10px] text-slate-400 block mb-1">حد سود پیشنهادی (TP):</span>
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    {formatCurrency(analysis.suggestedTakeProfit, activeQuote)}
                  </span>
                </div>
                <div className="bg-[#121926] p-3 rounded-xl border border-nobi-border">
                  <span className="text-[10px] text-slate-400 block mb-1">حد ضرر پیشنهادی (SL):</span>
                  <span className="text-xs font-mono font-bold text-rose-400">
                    {formatCurrency(analysis.suggestedStopLoss, activeQuote)}
                  </span>
                </div>
              </div>

              {/* Recommendations */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-200 block">
                  راهکارهای هوشمند حفظ سرمایه:
                </span>
                <div className="space-y-1.5">
                  {analysis.recommendations.map((rec, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 text-xs text-slate-300 bg-slate-900/40 p-2 rounded-lg border border-slate-800"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{rec}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#111724] border-t border-nobi-border flex justify-between items-center">
          <span className="text-[10px] text-slate-500">
            تحلیل با هوش مصنوعی صرفاً جنبه مشورتی داشته و مسئولیت معامله بر عهده کاربر است.
          </span>
          <button
            onClick={runAnalysis}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-semibold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحلیل مجدد</span>
          </button>
        </div>
      </div>
    </div>
  );
};
