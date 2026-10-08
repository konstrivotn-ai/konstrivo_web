import React, { useState } from 'react';
import { BookOpen, Search, Layers, CheckCircle2, Ruler, Shield, Info, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { KNOWLEDGE_ARTICLES } from '../data/knowledgeBase';
import { Language, KnowledgeArticle } from '../types';

interface KnowledgeTabProps {
  lang: Language;
}

export const KnowledgeTab: React.FC<KnowledgeTabProps> = ({ lang }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState<string>('kb-placo');

  const filteredArticles = KNOWLEDGE_ARTICLES.filter(art => {
    const query = searchTerm.toLowerCase();
    return (
      art.titleFr.toLowerCase().includes(query) ||
      art.titleAr.toLowerCase().includes(query) ||
      art.code.toLowerCase().includes(query) ||
      art.executionSteps.some(s => s.toLowerCase().includes(query)) ||
      art.formulas.some(f => f.toLowerCase().includes(query))
    );
  });

  return (
    <div className="space-y-6">
      {/* Search Header */}
      <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800 shadow-xl space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-amber-400" />
              {lang === 'ar' ? 'دليل المهن وقواعد الشانطي (Knowledge Base)' : 'Base de Connaissance BTP & Placo'}
            </h2>
            <p className="text-xs text-slate-400">
              {lang === 'ar' ? 'المعرفة التقنية والخطوات الميدانية لحرفيي ومقاولي البناء في تونس' : 'Guide technique des normes de pose, formules et étapes de chantier'}
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder={lang === 'ar' ? 'بحث في الدليل الميداني...' : 'Rechercher un cours/guide...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>
      </div>

      {/* Articles List */}
      <div className="space-y-4">
        {filteredArticles.map((article) => {
          const isExpanded = expandedId === article.id;

          return (
            <div
              key={article.id}
              className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-xl transition-all"
            >
              {/* Card Header (Accordion Toggle) */}
              <button
                onClick={() => setExpandedId(isExpanded ? '' : article.id)}
                className="w-full p-5 text-left flex items-center justify-between gap-4 bg-slate-900 hover:bg-slate-800/60 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="px-3 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg text-xs font-black font-mono">
                    {article.code}
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white">{article.titleFr}</h3>
                    <p className="text-xs text-amber-400 font-bold">{article.titleAr}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-slate-400">
                  <span className="text-xs hidden sm:inline">{isExpanded ? 'Fermer' : 'Déplier'}</span>
                  {isExpanded ? <ChevronUp className="w-5 h-5 text-amber-400" /> : <ChevronDown className="w-5 h-5" />}
                </div>
              </button>

              {/* Card Content */}
              {isExpanded && (
                <div className="p-5 border-t border-slate-800/80 bg-slate-950/50 space-y-6">
                  
                  {/* Introduction */}
                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 text-xs text-slate-300 leading-relaxed">
                    <span className="font-bold text-amber-400 block mb-1">Présentation Technique :</span>
                    {article.introduction}
                  </div>

                  {/* Subtypes Grid */}
                  {article.subTypes && article.subTypes.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5" />
                        <span>Variantes et Systèmes (أنواع وشغلات المادة)</span>
                      </h4>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {article.subTypes.map((st, i) => (
                          <div key={i} className="bg-slate-900 p-3 rounded-xl border border-slate-800/80 text-xs">
                            <div className="font-bold text-slate-100 mb-1">{st.name}</div>
                            <p className="text-slate-400 text-[11px] mb-2">{st.description}</p>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 font-semibold border border-amber-500/20 block w-fit">
                              {st.specs}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Execution Steps */}
                  <div>
                    <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>É tapes d’Exécution du Chantier (خطوات التنفيذ على الشانتي)</span>
                    </h4>

                    <div className="space-y-2">
                      {article.executionSteps.map((step, idx) => (
                        <div key={idx} className="bg-slate-900 p-3 rounded-xl border border-slate-800/60 text-xs text-slate-200 flex items-start gap-2.5">
                          <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 font-bold flex items-center justify-center text-[10px] shrink-0 font-mono mt-0.5">
                            {idx + 1}
                          </span>
                          <span className="leading-relaxed">{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Dimensions & Standards Table */}
                  <div>
                    <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Ruler className="w-3.5 h-3.5" />
                      <span>Dimensions & Normes de Pose (الأبعاد المعيارية)</span>
                    </h4>

                    <div className="overflow-x-auto rounded-xl border border-slate-800">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-900 text-slate-400 font-bold border-b border-slate-800">
                          <tr>
                            <th className="p-3">Élément</th>
                            <th className="p-3">Norme / Dim. Standard</th>
                            <th className="p-3">Notes & Remarques</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 bg-slate-950/80">
                          {article.dimensionsTable.map((dt, idx) => (
                            <tr key={idx}>
                              <td className="p-3 font-bold text-slate-200">{dt.element}</td>
                              <td className="p-3 font-mono text-amber-400 font-bold">{dt.standard}</td>
                              <td className="p-3 text-slate-400 text-[11px]">{dt.notes}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Formulas & Pro Tips */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
                      <div className="font-bold text-amber-400 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Formules de Métré (صيغ الحساب)</span>
                      </div>
                      <ul className="space-y-1.5 font-mono text-[11px] text-slate-300">
                        {article.formulas.map((f, i) => (
                          <li key={i} className="bg-slate-950 p-2 rounded border border-slate-800">
                            • {f}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-amber-500/10 p-4 rounded-xl border border-amber-500/20 space-y-2 text-xs">
                      <div className="font-bold text-amber-400 flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5" />
                        <span>Conseils de Pro (حيل وأسرار الشانطي)</span>
                      </div>
                      <ul className="space-y-1.5 text-[11px] text-slate-200">
                        {article.tips.map((t, i) => (
                          <li key={i} className="leading-relaxed">
                            👉 {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
