import React, { useState } from 'react';
import { AlertCircle, Check, Copy, Terminal, ExternalLink, X, ChevronDown, ChevronUp } from 'lucide-react';

export const GitHubCiFixNotice: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const gitCommands = `git add package.json test.js\ngit commit -m "fix(ci): add npm test script for GitHub Actions build"\ngit push origin main`;

  const copyCommands = () => {
    navigator.clipboard.writeText(gitCommands);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="bg-[#18111e] border border-rose-500/40 rounded-2xl p-3 sm:p-4 mb-3 text-xs text-rose-200 shadow-xl animate-in fade-in">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 font-bold text-rose-300 text-sm">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>راهنمای رفع خطای بیلد گیت‌هاب اکشنز (تصویر ارسالی شما)</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded text-rose-300 hover:bg-rose-900/30 transition-colors"
            title={expanded ? 'کوچک کردن' : 'نمایش جزئیات'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-1 rounded text-rose-400 hover:text-white transition-colors"
            title="بستن اعلان"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-2.5 space-y-2.5 text-[11px] leading-relaxed">
          <p className="text-slate-200">
            در تصویری که از اجرای کامیت <code className="bg-black/50 px-1 py-0.5 rounded font-mono text-amber-300">3a8bda6</code> ارسال کردید، خطای 
            <strong className="text-white font-mono mx-1">npm error Missing script: "test"</strong> 
            رخ داده است؛ زیرا در فایل <code className="font-mono text-emerald-300">package.json</code> روی مخزن گیت‌هاب شما هنوز اسکریپت <code className="font-mono text-white">"test"</code> تعریف نشده بود.
          </p>

          <div className="bg-[#0b070f] p-3 rounded-xl border border-rose-900/60 font-mono text-[11px] space-y-2">
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1.5 text-slate-300 font-sans">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                دستورات لازم را در ترمینال پروژه اجرا و push کنید تا بیلد و ساخت فایل APK با موفقیت انجام شود:
              </span>
              <button
                onClick={copyCommands}
                className="px-2 py-1 bg-rose-600/30 hover:bg-rose-600/50 text-white rounded flex items-center gap-1 transition-colors text-[10px]"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'کپی شد' : 'کپی دستورات'}</span>
              </button>
            </div>
            <pre className="text-emerald-400 overflow-x-auto p-1 font-mono text-xs selection:bg-rose-500/30">
              {gitCommands}
            </pre>
          </div>

          <p className="text-slate-400 text-[10px]">
            به محض ارسال این کامیت، گیت‌هاب اکشنز مرحله <span className="font-mono text-slate-300">Run logic tests</span> را پاس کرده و بلافاصله مراحل 
            <span className="font-mono text-slate-300"> Build APK</span> و 
            <span className="font-mono text-slate-300"> Publish as a release</span> را تکمیل خواهد کرد.
          </p>
        </div>
      )}
    </div>
  );
};
