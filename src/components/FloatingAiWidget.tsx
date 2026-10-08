import React, { useState } from 'react';
import { Bot, Sparkles, X, Send, Maximize2, RefreshCw } from 'lucide-react';
import { Language, RegionTunisia, DevisDocument } from '../types';

interface FloatingAiWidgetProps {
  onOpenFullAssistant: () => void;
  lang: Language;
  region: RegionTunisia;
  currentDevis?: DevisDocument;
}

export const FloatingAiWidget: React.FC<FloatingAiWidgetProps> = ({
  onOpenFullAssistant,
  lang,
  region,
  currentDevis
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputMsg, setInputMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [chatLog, setChatLog] = useState<{ sender: 'user' | 'ai'; text: string }[]>([
    {
      sender: 'ai',
      text: lang === 'ar'
        ? `عصلمة! 🇹🇳 أنا مساعد الشانطي الذكي KONSTRIVO AI. تفضل باسألتك حول حسابات Placo BA13, الأسعار والكميات!`
        : `Bonjour ! 🇹🇳 Je suis l'assistant AI KONSTRIVO. Posez-moi vos questions de métré et devis !`
    }
  ]);

  const handleSendQuickMsg = async (customText?: string) => {
    const text = customText || inputMsg;
    if (!text.trim() || loading) return;

    setChatLog(prev => [...prev, { sender: 'user', text }]);
    if (!customText) setInputMsg('');
    setLoading(true);

    try {
      const response = await fetch('/api/ai-estimator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, currentDevis, region })
      });
      const data = await response.json();
      const reply = data.text || data.message || 'Haza lakum al-hisab al-mubashir.';
      setChatLog(prev => [...prev, { sender: 'ai', text: reply }]);
    } catch (err) {
      setChatLog(prev => [
        ...prev,
        {
          sender: 'ai',
          text: `🇹🇳 **KONSTRIVO AI (تونس 2026)**\n\nحساب تقديري سريع:\n- Faux Plafond BA13: ~30 TND/m² مواد + 13 TND/m² يد عاملة.\n- Démontable 60x60: ~35 TND/m² مواد + 15 TND/m² يد عاملة.`
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-50 print:hidden">
      
      {/* Floating Chat Popover Window */}
      {isOpen && (
        <div className="mb-3 w-80 sm:w-96 bg-[#0b0f17] border border-amber-500/40 rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[480px] transition-all animate-in fade-in slide-in-from-bottom-5">
          
          {/* Header */}
          <div className="bg-gradient-to-r from-[#131b2e] to-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-black text-white block">KONSTRIVO AI</span>
                <span className="text-[10px] text-amber-400 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  مساعد الشانطي الذكي
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setIsOpen(false);
                  onOpenFullAssistant();
                }}
                title="Plein Écran"
                className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Preset Buttons */}
          <div className="p-2 bg-slate-900/90 border-b border-slate-800 flex items-center gap-1.5 overflow-x-auto text-[11px] scrollbar-none">
            <button
              onClick={() => handleSendQuickMsg("احسب لي سقف تفكيكي 60x60 لمكتب 6x4m")}
              className="px-2.5 py-1 bg-slate-800 hover:bg-amber-500/20 text-slate-300 hover:text-amber-400 rounded-lg whitespace-nowrap transition-colors border border-slate-700/80"
            >
              سقف 60x60 (6x4m)
            </button>
            <button
              onClick={() => handleSendQuickMsg("كم كلفة حائط قاسم Cloison 8m؟")}
              className="px-2.5 py-1 bg-slate-800 hover:bg-amber-500/20 text-slate-300 hover:text-amber-400 rounded-lg whitespace-nowrap transition-colors border border-slate-700/80"
            >
              Cloison BA13
            </button>
          </div>

          {/* Messages Body */}
          <div className="flex-1 p-3 overflow-y-auto space-y-3 bg-[#070a10]">
            {chatLog.map((m, i) => (
              <div
                key={i}
                className={`flex gap-2 ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {m.sender === 'ai' && (
                  <div className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 text-xs shrink-0 mt-0.5">
                    🤖
                  </div>
                )}
                <div
                  className={`p-3 rounded-2xl text-xs max-w-[85%] leading-relaxed whitespace-pre-line ${
                    m.sender === 'user'
                      ? 'bg-amber-500 text-slate-950 font-medium rounded-tr-none'
                      : 'bg-[#131b2e] text-slate-200 border border-slate-800 rounded-tl-none'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-amber-400 font-bold p-2 bg-slate-900/80 rounded-xl w-fit">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>جاري الحساب والتحليل...</span>
              </div>
            )}
          </div>

          {/* Quick Input Bar */}
          <div className="p-2.5 bg-slate-900 border-t border-slate-800">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendQuickMsg();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
                placeholder="اسأل معلم الشانطي..."
                className="flex-1 bg-[#0b0f17] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
              <button
                type="submit"
                disabled={loading}
                className="p-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl transition-colors shrink-0"
              >
                <Send className="w-4 h-4 stroke-[2.5]" />
              </button>
            </form>
          </div>

        </div>
      )}

      {/* Floating Main Button */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="relative group flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-xs sm:text-sm rounded-full shadow-2xl shadow-amber-500/40 border border-amber-300/50 transition-all transform hover:scale-105 cursor-pointer"
      >
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-950 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-slate-950"></span>
        </span>

        <Bot className="w-5 h-5 stroke-[2.2]" />
        <span className="hidden sm:inline font-mono tracking-tight">KONSTRIVO AI</span>

        {/* Pulse Glow Effect */}
        <div className="absolute -inset-0.5 rounded-full bg-gradient-to-r from-amber-400 to-amber-600 blur opacity-30 group-hover:opacity-75 transition duration-500 -z-10" />
      </button>

    </div>
  );
};
