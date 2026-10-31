import React, { useState } from 'react';
import { QuoteCurrency, WalletBalances } from '../types';
import { USDT_TO_IRT_RATE, formatCurrency } from '../constants';
import { 
  ArrowLeftRight, 
  Wallet, 
  RotateCcw, 
  ShieldAlert, 
  Sparkles, 
  TrendingUp, 
  Zap, 
  Coins,
  ChevronDown
} from 'lucide-react';

interface NavbarProps {
  quoteCurrency: QuoteCurrency;
  onSelectQuoteCurrency: (currency: QuoteCurrency) => void;
  balances: WalletBalances;
  onResetBalances: () => void;
  onOpenAiRisk: () => void;
  onQuickDeposit: (currency: QuoteCurrency, amount: number) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  quoteCurrency,
  onSelectQuoteCurrency,
  balances,
  onResetBalances,
  onOpenAiRisk,
  onQuickDeposit,
}) => {
  const [showWalletMenu, setShowWalletMenu] = useState(false);

  const totalEquityInActiveCurrency =
    quoteCurrency === 'IRT'
      ? balances.IRT.free + balances.IRT.locked + (balances.USDT.free + balances.USDT.locked) * USDT_TO_IRT_RATE
      : balances.USDT.free + balances.USDT.locked + (balances.IRT.free + balances.IRT.locked) / USDT_TO_IRT_RATE;

  return (
    <header className="bg-nobi-dark border-b border-nobi-border sticky top-0 z-40 select-none">
      <div className="max-w-[1920px] mx-auto px-4 h-16 flex items-center justify-between gap-4">
        {/* Brand & Market Switcher */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 via-emerald-500 to-teal-400 flex items-center justify-center font-bold text-white shadow-lg shadow-emerald-500/20 text-lg tracking-wider">
              N
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-tight text-white">NOBITEX</span>
                <span className="bg-emerald-500/15 text-emerald-400 text-[11px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">
                  MARGIN 10x
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium">نوبیتکس معاملات تعهدی</p>
            </div>
          </div>

          {/* IRT vs USDT Main Toggle */}
          <div className="bg-[#121824] p-1 rounded-xl border border-nobi-border flex items-center gap-1 shadow-inner">
            <button
              onClick={() => onSelectQuoteCurrency('IRT')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                quoteCurrency === 'IRT'
                  ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse"></span>
              بازار تومانی (IRT)
            </button>

            <button
              onClick={() => onSelectQuoteCurrency('USDT')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                quoteCurrency === 'USDT'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Coins className="w-3.5 h-3.5" />
              USDT Market ($)
            </button>
          </div>

          {/* Quick Rate Indicator */}
          <div className="hidden lg:flex items-center gap-2 text-xs px-3 py-1 rounded-lg bg-slate-900/60 border border-slate-800 text-slate-300">
            <span className="text-slate-400">1 USDT =</span>
            <span className="font-mono font-semibold text-emerald-400">
              {USDT_TO_IRT_RATE.toLocaleString()} IRT
            </span>
            <span className="text-[10px] text-slate-400">تومان</span>
          </div>
        </div>

        {/* Right actions: AI Advisor, Wallet, Reset */}
        <div className="flex items-center gap-3">
          {/* Gemini AI Risk Auditor Button */}
          <button
            onClick={onOpenAiRisk}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500/10 via-purple-500/10 to-blue-500/10 hover:from-amber-500/20 hover:to-blue-500/20 border border-amber-500/30 text-amber-300 text-xs font-semibold shadow-sm transition-all group"
          >
            <Sparkles className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
            <span className="hidden sm:inline">AI Margin Guardian</span>
            <span className="px-1.5 py-0.2 bg-amber-500/20 rounded text-[10px] text-amber-300">Gemini</span>
          </button>

          {/* Wallet Balance Overview */}
          <div className="relative">
            <button
              onClick={() => setShowWalletMenu(!showWalletMenu)}
              className="flex items-center gap-3 px-3 py-1.5 rounded-xl bg-nobi-card border border-nobi-border hover:border-slate-600 transition-colors"
            >
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Wallet className="w-3.5 h-3.5" />
              </div>
              <div className="text-right">
                <p className="text-[10px] text-slate-400">
                  موجودی در دسترس ({quoteCurrency})
                </p>
                <p className="text-xs font-mono font-bold text-slate-100">
                  {formatCurrency(balances[quoteCurrency].free, quoteCurrency)}
                </p>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {/* Dropdown Menu */}
            {showWalletMenu && (
              <div className="absolute right-0 mt-2 w-80 bg-nobi-card border border-nobi-border rounded-xl p-4 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="flex items-center justify-between pb-3 border-b border-nobi-border">
                  <span className="text-xs font-bold text-slate-200">کیف پول مارجین (Margin Wallet)</span>
                  <button
                    onClick={onResetBalances}
                    title="Reset to initial demo balances"
                    className="text-[11px] text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> ریست موجودی
                  </button>
                </div>

                <div className="py-3 space-y-2.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">موجودی آزاد IRT:</span>
                    <span className="font-mono font-medium text-emerald-400">
                      {balances.IRT.free.toLocaleString()} تومان
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">موجودی آزاد USDT:</span>
                    <span className="font-mono font-medium text-blue-400">
                      ${balances.USDT.free.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">مارجین مسدود (Locked):</span>
                    <span className="font-mono text-slate-300">
                      {formatCurrency(balances[quoteCurrency].locked, quoteCurrency)}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-nobi-border/60 flex justify-between items-center text-xs">
                    <span className="font-semibold text-slate-200">کل دارایی تخمینی:</span>
                    <span className="font-mono font-bold text-white">
                      {formatCurrency(totalEquityInActiveCurrency, quoteCurrency)}
                    </span>
                  </div>
                </div>

                {/* Quick Simulated Deposit */}
                <div className="pt-2 border-t border-nobi-border space-y-1.5">
                  <p className="text-[10px] text-slate-400">شارژ دمو (Demo Top-up):</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        onQuickDeposit('IRT', 100000000);
                        setShowWalletMenu(false);
                      }}
                      className="px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[11px] font-medium rounded-lg border border-emerald-500/20 transition-colors"
                    >
                      +۱۰۰ میلیون تومان
                    </button>
                    <button
                      onClick={() => {
                        onQuickDeposit('USDT', 1500);
                        setShowWalletMenu(false);
                      }}
                      className="px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-[11px] font-medium rounded-lg border border-blue-500/20 transition-colors"
                    >
                      +1,500 USDT
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
