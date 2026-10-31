import React from 'react';
import { CryptoAsset, MarketPair, QuoteCurrency } from '../types';
import { SUPPORTED_ASSETS, formatCurrency } from '../constants';
import { TrendingUp, TrendingDown, Clock, ShieldCheck, ArrowUpDown } from 'lucide-react';

interface MarketHeaderProps {
  selectedAsset: CryptoAsset;
  onSelectAsset: (asset: CryptoAsset) => void;
  activePair: MarketPair;
  quoteCurrency: QuoteCurrency;
  onToggleCurrency: (curr: QuoteCurrency) => void;
}

export const MarketHeader: React.FC<MarketHeaderProps> = ({
  selectedAsset,
  onSelectAsset,
  activePair,
  quoteCurrency,
  onToggleCurrency,
}) => {
  const isPositive = activePair.change24h >= 0;

  return (
    <div className="bg-[#101622] border-b border-nobi-border px-4 py-2.5 flex flex-wrap items-center justify-between gap-4">
      {/* Pair Selector Tabs */}
      <div className="flex items-center gap-3 overflow-x-auto scrollbar-none py-1">
        <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-xl border border-nobi-border">
          {SUPPORTED_ASSETS.map((asset) => {
            const isSelected = asset.symbol === selectedAsset.symbol;
            return (
              <button
                key={asset.symbol}
                onClick={() => onSelectAsset(asset)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  isSelected
                    ? 'bg-nobi-card text-emerald-400 shadow-sm border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <span className="text-slate-300">{asset.icon}</span>
                <span>{asset.symbol}</span>
                <span className="text-[10px] text-slate-400">/{quoteCurrency}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Market Metrics */}
      <div className="flex items-center gap-5 sm:gap-8 flex-wrap">
        {/* Main Price */}
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xl sm:text-2xl font-mono font-extrabold ${
                isPositive ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {formatCurrency(activePair.lastPrice, quoteCurrency)}
            </span>
            <div
              className={`flex items-center text-xs font-bold px-2 py-0.5 rounded-md ${
                isPositive
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
              }`}
            >
              {isPositive ? <TrendingUp className="w-3.5 h-3.5 mr-0.5 inline" /> : <TrendingDown className="w-3.5 h-3.5 mr-0.5 inline" />}
              {isPositive ? '+' : ''}
              {activePair.change24h.toFixed(2)}%
            </div>
          </div>
          <p className="text-[10px] text-slate-400">
            {selectedAsset.nameFa} / {quoteCurrency === 'IRT' ? 'تومان' : 'تتر'}
          </p>
        </div>

        {/* 24h High */}
        <div className="hidden md:block">
          <p className="text-[10px] text-slate-400">بالاترین ۲۴ ساعت</p>
          <p className="text-xs font-mono font-medium text-slate-200">
            {formatCurrency(activePair.high24h, quoteCurrency)}
          </p>
        </div>

        {/* 24h Low */}
        <div className="hidden md:block">
          <p className="text-[10px] text-slate-400">پایین‌ترین ۲۴ ساعت</p>
          <p className="text-xs font-mono font-medium text-slate-200">
            {formatCurrency(activePair.low24h, quoteCurrency)}
          </p>
        </div>

        {/* 24h Volume */}
        <div className="hidden sm:block">
          <p className="text-[10px] text-slate-400">حجم ۲۴ ساعت ({selectedAsset.symbol})</p>
          <p className="text-xs font-mono font-medium text-slate-200">
            {activePair.volume24h.toLocaleString('en-US', { maximumFractionDigits: 2 })}{' '}
            {selectedAsset.symbol}
          </p>
        </div>

        {/* Funding & Borrow Interest */}
        <div className="flex items-center gap-3 pl-3 border-l border-nobi-border">
          <div>
            <div className="flex items-center gap-1 text-[10px] text-slate-400">
              <Clock className="w-3 h-3 text-amber-400" />
              <span>نرخ کارمزد تامین مالی</span>
            </div>
            <p className="text-xs font-mono font-bold text-amber-300">
              {(activePair.fundingRate * 100).toFixed(4)}%
            </p>
          </div>

          <div>
            <div className="flex items-center gap-1 text-[10px] text-slate-400">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              <span>حداکثر ضریب</span>
            </div>
            <p className="text-xs font-mono font-bold text-emerald-400">
              {selectedAsset.maxLeverage}x
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
