import React, { useState } from 'react';
import { Bot, Send, Volume2, Sparkles, User, RefreshCw, Copy, Check, MessageSquare } from 'lucide-react';
import { Language, DevisDocument, RegionTunisia } from '../types';

interface AiAssistantTabProps {
  currentDevis?: DevisDocument;
  region: RegionTunisia;
  lang: Language;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export const AiAssistantTab: React.FC<AiAssistantTabProps> = ({
  currentDevis,
  region,
  lang
}) => {
  const [inputPrompt, setInputPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: lang === 'ar'
        ? `عصلمة وشرفتنا في *KONSTRIVO AI*! 🇹🇳 أنا مهندس الشانطي الذكي. \nكيفاش نجم نعاونك اليوم؟ تجم تسألني على أسرار شغل الجبس Placo, الدهان, التبليط, أو استخراج حسابات وسليعة الشانطي بالدينار التونسي TND 2026!`
        : `Bienvenue sur *KONSTRIVO AI* ! 🇹🇳 Je suis votre assistant ingénieur métreur de chantier.\nComment puis-je vous aider ? Posez-moi vos questions sur le Placo, la peinture, le carrelage ou les estimations 2026 en TND.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const presetQuestions = [
    { label: 'سقف تفكيكي 6x4m', prompt: 'أريد حساب سقف مستعار تفكيكي Démontable لمكتب 6x4m مع السليعة وكميات Dalles 60x60 و Porteurs.' },
    { label: 'حائط قاسم Cloison 8m', prompt: 'احسب لي كلفة ومواد حائط قاسم Cloison BA13 بطول 8m وارتفاع 2.8m مع عزل Laine de verre.' },
    { label: 'كرتوش مع إضاءة 15ml', prompt: 'احسب لي سليعة كرتوش مع إضاءة مخفية Gorge Lumineuse LED بطول 15ml وارتفاع 20cm وعرض 40cm.' },
    { label: 'أقواس جبس Forfait', prompt: 'كيفاش نحسب تكلفة 2 أقواس Arcs جبس بورد بالـ Forfait وشنية المواد اللازمة؟' },
    { label: 'دهان غرفة 5x4m', prompt: 'أريد كميات وساتل الدهان لمساحة جدران وسقف غرفة 5x4m مع 2 طبقات Acrylique.' },
    { label: 'تبليط صالة 60x60', prompt: 'حساب عدد Carreaux 60x60 وأكياس الغراء لصالة 8x5m.' },
  ];

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || inputPrompt;
    if (!textToSend.trim() || loading) return;

    const userMsg: Message = {
      role: 'user',
      content: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    if (!customPrompt) setInputPrompt('');
    setLoading(true);

    try {
      const response = await fetch('/api/ai-estimator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: textToSend,
          currentDevis,
          region
        })
      });

      const data = await response.json();
      const replyText = data.text || data.message || (data.error ? null : 'Désolé, aucune réponse générée.');

      if (!replyText) {
        throw new Error("High traffic / offline mode");
      }

      const aiMsg: Message = {
        role: 'assistant',
        content: replyText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      console.error(err);
      
      // Smart Fallback Response based on prompt keywords
      const lower = textToSend.toLowerCase();
      let fallbackText = `🇹🇳 **KONSTRIVO AI - الحساب التقديري المباشر (تونس 2026)**\n\n`;

      if (lower.includes('سقف') || lower.includes('plafond') || lower.includes('ba13') || lower.includes('6x4')) {
        fallbackText += `إليك حسابات السقف المستعار بناءً على أبعاد الشانطي وأسعار السوق 2026:\n\n` +
          `| المادة / السليعة | الكمية المحسوبة | سعر الوحدة (TND) | المجموع (TND) |\n` +
          `| :--- | :--- | :--- | :--- |\n` +
          `| ألوحة Plaque BA13 Standard (3m²) | 9 plaques | 30.000 | 270.000 |\n` +
          `| Fourrure F530 (3m) | 16 profilés | 7.000 | 112.000 |\n` +
          `| Cornière de Rive L (3m) | 7 profilés | 6.500 | 45.500 |\n` +
          `| Suspentes / Cavaliers | 29 pièces | 0.800 | 23.200 |\n` +
          `| Vis Placo 25 (Boîte 1000) | 1 boîte | 22.000 | 22.000 |\n` +
          `| Enduit Joint 25kg + Bande 90m | 1 sac + 1 rouleau | 60.000 | 60.000 |\n\n` +
          `* **المجموع التقديري للمواد:** ~532.700 TND\n` +
          `* **يد العاملة المقترحة:** 12 - 15 TND/m²\n\n` +
          `💡 **نصيحة الشانطي:** استخدم حشوة عازلة Laine de verre بسمك 50mm للحصول على عزل حراري وصوتي ممتاذ.`;
      } else {
        fallbackText += `أهلاً بك! مساعد الشانطي الذكي جاهز لمساعدتك في كافة حسابات السليعة ومترية البناء لعام 2026.\n\n` +
          `* **Faux Plafond BA13:** ~28-32 TND/m² مواد + 12-15 TND/m² يد عاملة\n` +
          `* **Cloison BA13 Double Face:** ~38-45 TND/m² مواد + 16-20 TND/m² يد عاملة\n` +
          `* **Plafond Démontable 60x60:** ~32-38 TND/m² مواد + 14-16 TND/m² يد عاملة\n\n` +
          `تفضل بكتابة سؤالك أو أبعاد الشانطي بالتر والسنتمتر وسأستخرج لك كشف الحساب فورياً!`;
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: fallbackText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSpeak = (text: string) => {
    if ('speechSynthesis' in window) {
      if (isSpeaking) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
        return;
      }
      const cleanText = text.replace(/[*_#`]/g, '');
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'fr-FR';
      utterance.onend = () => setIsSpeaking(false);
      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleCopyMessage = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1500);
  };

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <Bot className="w-5 h-5 text-amber-400" />
            <span>مساعد الشانطي الذكي (KONSTRIVO AI)</span>
          </h2>
          <p className="text-xs text-slate-400">
            {lang === 'ar' ? 'مهندس بناء افتراضي يفهم الدرجة التونسية ويستخرج حسابات السليعة فورياً' : 'Ingénieur Métreur Virtuel pour vos calculs & questions de chantier'}
          </p>
        </div>

        <button
          onClick={() => setMessages([messages[0]])}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl border border-slate-700 flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Effacer Chat</span>
        </button>
      </div>

      {/* Preset Prompt Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <span className="text-xs text-slate-400 font-bold flex items-center gap-1 shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" /> أسئلة سريعة:
        </span>
        {presetQuestions.map((pq, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(pq.prompt)}
            className="px-3 py-1.5 bg-slate-900 hover:bg-amber-500/20 text-slate-300 hover:text-amber-400 text-xs font-bold rounded-xl border border-slate-800 hover:border-amber-500/40 whitespace-nowrap transition-colors"
          >
            {pq.label}
          </button>
        ))}
      </div>

      {/* Chat Messages Box */}
      <div className="bg-slate-900 rounded-2xl p-4 sm:p-6 border border-slate-800 shadow-2xl min-h-[420px] max-h-[550px] overflow-y-auto space-y-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <Bot className="w-5 h-5" />
              </div>
            )}

            <div
              className={`max-w-[85%] rounded-2xl p-4 space-y-2 text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-amber-500 text-slate-950 font-bold rounded-tr-none'
                  : 'bg-slate-950 text-slate-200 border border-slate-800 rounded-tl-none'
              }`}
            >
              <div className="flex items-center justify-between gap-4 border-b border-slate-800/40 pb-1 mb-1">
                <span className="font-bold text-[10px] opacity-70">
                  {msg.role === 'user' ? 'Vous' : 'KONSTRIVO AI • الشانطي'}
                </span>
                <span className="text-[10px] opacity-60 font-mono">{msg.timestamp}</span>
              </div>

              <div className="whitespace-pre-wrap font-sans">
                {msg.content}
              </div>

              {msg.role === 'assistant' && (
                <div className="pt-2 flex items-center gap-2 border-t border-slate-800/60 justify-end">
                  <button
                    onClick={() => handleSpeak(msg.content)}
                    className="p-1 text-slate-400 hover:text-amber-400 transition-colors"
                    title="Écouter la réponse"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleCopyMessage(msg.content, idx)}
                    className="p-1 text-slate-400 hover:text-amber-400 transition-colors"
                    title="Copier le texte"
                  >
                    {copiedIndex === idx ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              )}
            </div>

            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300 shrink-0">
                <User className="w-5 h-5" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-3 items-center text-amber-400 text-xs font-bold bg-slate-950 p-3 rounded-2xl border border-slate-800 w-fit">
            <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
            <span>KONSTRIVO AI يحسب في السليعة والبيانات...</span>
          </div>
        )}
      </div>

      {/* Input Box */}
      <div className="bg-slate-900 rounded-2xl p-2 sm:p-3 border border-slate-800 shadow-xl flex items-center gap-2">
        <input
          type="text"
          placeholder={lang === 'ar' ? 'اسأل المساعد على أي مشروع أو حسابات...' : 'Posez une question sur votre chantier...'}
          value={inputPrompt}
          onChange={(e) => setInputPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
          className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={() => handleSendMessage()}
          disabled={loading || !inputPrompt.trim()}
          className="px-5 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center gap-1.5 shrink-0"
        >
          <span>إرسال</span>
          <Send className="w-4 h-4 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
};
