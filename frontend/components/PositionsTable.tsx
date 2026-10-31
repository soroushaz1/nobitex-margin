import React, { useState } from 'react';
import { Position, Order, QuoteCurrency } from '../types';
import { formatCurrency, formatPrice } from '../constants';
import { 
  CheckCircle, 
  XCircle, 
  PlusCircle, 
  AlertTriangle, 
  Layers, 
  FileText, 
  ArrowUpRight, 
  ArrowDownRight 
} from 'lucide-react';

interface PositionsTableProps {
  positions: Position[];
  orders: Order[];
  quoteCurrency: QuoteCurrency;
  onClosePosition: (positionId: string) => void;
  onCancelOrder: (orderId: string) => void;
  onAddMargin: (positionId: string, addedAmount: number) => void;
}

export const PositionsTable: React.FC<PositionsTableProps> = ({
  positions,
  orders,
  quoteCurrency,
  onClosePosition,
  onCancelOrder,
  onAddMargin,
}) => {
  const [activeTab, setActiveTab] = useState<'POSITIONS' | 'ORDERS'>('POSITIONS');
  const [addMarginModalPos, setAddMarginModalPos] = useState<Position | null>(null);
  const [addMarginVal, setAddMarginVal] = useState<string>('5000000');

  return (
    <div className="bg-nobi-card border border-nobi-border rounded-xl flex flex-col h-[320px] overflow-hidden text-xs">
      {/* Header Tabs */}
      <div className="px-4 py-2 border-b border-nobi-border flex items-center justify-between bg-[#131a26]">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('POSITIONS')}
            className={`px-3 py-1 rounded-lg font-bold text-xs transition-colors flex items-center gap-1.5 ${
              activeTab === 'POSITIONS'
                ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>موقعیت‌های باز تعهدی ({positions.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('ORDERS')}
            className={`px-3 py-1 rounded-lg font-bold text-xs transition-colors flex items-center gap-1.5 ${
              activeTab === 'ORDERS'
                ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>سفارشات باز ({orders.length})</span>
          </button>
        </div>

        <span className="text-[10px] text-slate-400">
          نمایش سود و زیان بر اساس ارز مبنا: <strong className="text-slate-200">{quoteCurrency}</strong>
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'POSITIONS' ? (
          positions.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
              <Layers className="w-8 h-8 opacity-40 text-slate-400" />
              <p>هیچ موقعیت بازی وجود ندارد.</p>
              <p className="text-[11px] text-slate-600">برای باز کردن معامله تعهدی، فرم ثبت سفارش را تکمیل کنید.</p>
            </div>
          ) : (
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="border-b border-nobi-border text-[10px] text-slate-400 bg-slate-900/40">
                  <th className="py-2 px-3">نماد / ضریب</th>
                  <th className="py-2 px-3">حجم موقعیت</th>
                  <th className="py-2 px-3">قیمت ورود</th>
                  <th className="py-2 px-3">قیمت تعهد (Mark)</th>
                  <th className="py-2 px-3">قیمت لیکوئید</th>
                  <th className="py-2 px-3">وجه تضمین (Margin)</th>
                  <th className="py-2 px-3">سود/زیان محقق‌نشده (PnL)</th>
                  <th className="py-2 px-3 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-nobi-border/60 font-mono text-[11px]">
                {positions.map((pos) => {
                  const isProfit = pos.unrealizedPnl >= 0;
                  return (
                    <tr key={pos.id} className="hover:bg-slate-800/40 transition-colors">
                      {/* Symbol & Side */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 font-sans">
                          <span
                            className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                              pos.side === 'BUY'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-rose-500/20 text-rose-400'
                            }`}
                          >
                            {pos.side === 'BUY' ? 'Long' : 'Short'} {pos.leverage}x
                          </span>
                          <span className="font-bold text-slate-200">
                            {pos.baseAsset}/{pos.quoteCurrency}
                          </span>
                          <span className="text-[9px] text-slate-400 bg-slate-800 px-1 py-0.5 rounded">
                            {pos.marginMode}
                          </span>
                        </div>
                      </td>

                      {/* Size */}
                      <td className="py-2.5 px-3 text-slate-200">
                        {pos.size.toFixed(4)} {pos.baseAsset}
                      </td>

                      {/* Entry Price */}
                      <td className="py-2.5 px-3 text-slate-300">
                        {formatPrice(pos.entryPrice, pos.quoteCurrency)}
                      </td>

                      {/* Mark Price */}
                      <td className="py-2.5 px-3 text-slate-300">
                        {formatPrice(pos.markPrice, pos.quoteCurrency)}
                      </td>

                      {/* Liq Price */}
                      <td className="py-2.5 px-3">
                        <span className="text-rose-400 font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                          {formatPrice(pos.liquidationPrice, pos.quoteCurrency)}
                        </span>
                      </td>

                      {/* Margin Collateral */}
                      <td className="py-2.5 px-3 text-slate-300">
                        <div className="flex items-center gap-1.5">
                          <span>{formatCurrency(pos.margin, pos.quoteCurrency)}</span>
                          {pos.marginMode === 'ISOLATED' && (
                            <button
                              onClick={() => {
                                setAddMarginModalPos(pos);
                                setAddMarginVal(pos.quoteCurrency === 'IRT' ? '5000000' : '50');
                              }}
                              title="افزایش وجه تضمین برای دور کردن قیمت لیکوئید"
                              className="text-slate-400 hover:text-emerald-400 transition-colors"
                            >
                              <PlusCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* PnL & ROE */}
                      <td className="py-2.5 px-3">
                        <div className={isProfit ? 'text-emerald-400' : 'text-rose-400'}>
                          <span className="font-bold">
                            {isProfit ? '+' : ''}
                            {formatCurrency(pos.unrealizedPnl, pos.quoteCurrency)}
                          </span>
                          <span className="text-[10px] ml-1.5 opacity-90">
                            ({isProfit ? '+' : ''}
                            {pos.roePercentage.toFixed(2)}%)
                          </span>
                        </div>
                      </td>

                      {/* Action */}
                      <td className="py-2.5 px-3 text-center">
                        <button
                          onClick={() => onClosePosition(pos.id)}
                          className="px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 rounded font-sans text-[11px] transition-colors"
                        >
                          بستن سریع
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : (
          /* Orders Tab */
          orders.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
              <FileText className="w-8 h-8 opacity-40 text-slate-400" />
              <p>سفارش بازی ثبت نشده است.</p>
            </div>
          ) : (
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="border-b border-nobi-border text-[10px] text-slate-400 bg-slate-900/40">
                  <th className="py-2 px-3">نماد</th>
                  <th className="py-2 px-3">نوع</th>
                  <th className="py-2 px-3">جهت</th>
                  <th className="py-2 px-3">قیمت</th>
                  <th className="py-2 px-3">حجم</th>
                  <th className="py-2 px-3">زمان ثبت</th>
                  <th className="py-2 px-3 text-center">لغو</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-nobi-border/60 font-mono text-[11px]">
                {orders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2 px-3 font-bold text-slate-200">
                      {ord.baseAsset}/{ord.quoteCurrency}
                    </td>
                    <td className="py-2 px-3 text-slate-400">{ord.type}</td>
                    <td className="py-2 px-3">
                      <span className={ord.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>
                        {ord.side === 'BUY' ? 'خرید (Long)' : 'فروش (Short)'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-200">
                      {formatPrice(ord.price, ord.quoteCurrency)}
                    </td>
                    <td className="py-2 px-3 text-slate-300">
                      {ord.amount} {ord.baseAsset}
                    </td>
                    <td className="py-2 px-3 text-[10px] text-slate-400">{ord.createdAt}</td>
                    <td className="py-2 px-3 text-center">
                      <button
                        onClick={() => onCancelOrder(ord.id)}
                        className="text-rose-400 hover:text-rose-300 text-xs px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20"
                      >
                        لغو
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      {/* Add Margin Modal */}
      {addMarginModalPos && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-nobi-card border border-nobi-border rounded-xl p-5 w-full max-w-sm shadow-2xl animate-in zoom-in-95">
            <h4 className="text-sm font-bold text-slate-100 mb-2">
              افزایش وجه تضمین مارجین ({addMarginModalPos.baseAsset}/{addMarginModalPos.quoteCurrency})
            </h4>
            <p className="text-xs text-slate-400 mb-3 leading-relaxed">
              افزودن مارجین فاصله تا قیمت لیکوئید را افزایش داده و ریسک کال مارجین را کاهش می‌دهد.
            </p>
            <div className="mb-4">
              <label className="text-[11px] text-slate-300 block mb-1">
                مبلغ افزودنی ({addMarginModalPos.quoteCurrency}):
              </label>
              <input
                type="number"
                value={addMarginVal}
                onChange={(e) => setAddMarginVal(e.target.value)}
                className="w-full bg-[#111724] border border-nobi-border rounded-lg p-2 font-mono text-xs text-white outline-none focus:border-emerald-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const val = parseFloat(addMarginVal);
                  if (val > 0) {
                    onAddMargin(addMarginModalPos.id, val);
                    setAddMarginModalPos(null);
                  }
                }}
                className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold text-xs text-white transition-colors"
              >
                تایید افزایش مارجین
              </button>
              <button
                onClick={() => setAddMarginModalPos(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition-colors"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
