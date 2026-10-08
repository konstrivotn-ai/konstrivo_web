import React from 'react';
import { ShieldCheck, BookOpen, Scale, Award, Building, Compass, CheckCircle2, FileText, Users, Globe2, Sparkles } from 'lucide-react';
import { Language } from '../types';

interface AboutTabProps {
  lang: Language;
  onNavigate: (tabId: string) => void;
}

export const AboutTab: React.FC<AboutTabProps> = ({ lang, onNavigate }) => {
  const isAr = lang === 'ar';

  const dtuStandards = [
    {
      code: 'DTU 25.41',
      title: 'Ouvrages en plaques de plâtre à parements cartonnés',
      desc: 'Règles d\'implantation des ossatures métalliques M48/M70, entraxes de 40cm et 60cm, pose simple et double peau, suspentes et cavaliers.',
      category: 'Plâtrerie & Faux Plafonds'
    },
    {
      code: 'DTU 25.42',
      title: 'Ouvrages de doublage et d\'isolation thermique / acoustique',
      desc: 'Prescriptions pour les laines minérales (verre/roche), rupteurs de ponts thermiques, membranes pare-vapeur et bandes résilientes acoustiques.',
      category: 'Isolation & Acoustique'
    },
    {
      code: 'DTU 20.1 & Eurocode 2',
      title: 'Maçonnerie de petits éléments & Ouvrages en béton armé',
      desc: 'Dosages ciment (250-350 kg/m³), fers à béton haute adhérence (FeE500), chaînages horizontaux et verticaux, mortiers de pose.',
      category: 'Gros Œuvre'
    },
    {
      code: 'DTU 52.1 & 52.2',
      title: 'Revêtements de sol scellés & Pose collée de carrelage',
      desc: 'Tolérances de planéité sous règle de 2m, joints de fractionnement et de dilatation, colles ciment C2TE et mortiers de jointoiement hydrofuges.',
      category: 'Carrelage & Revêtements'
    },
    {
      code: 'NF C 15-100 & Normes STEG',
      title: 'Installations électriques à basse tension',
      desc: 'Sections de conducteurs (1.5mm² éclairage, 2.5mm² prises, 6mm² plaques/cuisson), calibres des disjoncteurs et protection différentielle 30mA.',
      category: 'Électricité'
    },
    {
      code: 'DTU 60.11 & Normes SONEDE',
      title: 'Distribution d\'eau froide et chaude sanitaire & Évacuations',
      desc: 'Dimensionnement des débits, raccords multicouche et PPR thermo-fusionnés, pentes minimales d\'évacuation PVC (1 à 2 cm/m).',
      category: 'Plomberie & Fluides'
    }
  ];

  return (
    <div className="space-y-10 pb-8">
      
      {/* Header & Mission */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/40 border border-slate-800 p-8 sm:p-12 shadow-2xl">
        <div className="max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold uppercase tracking-wider">
            <Award className="w-3.5 h-3.5" />
            <span>À Propos de KONSTRIVO BTP</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            L'Ingénierie Numérique au Service des Professionnels du BTP en Tunisie
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
            KONSTRIVO a été fondé avec une vision claire : moderniser les chantiers de construction et d'aménagement intérieur grâce à des algorithmes de métré ultra-précis, des bases de prix actualisées en temps réel selon les conditions économiques 2026, et des outils collaboratifs pensés pour le terrain.
          </p>

          <div className="flex flex-wrap gap-4 pt-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-3 py-1.5 rounded-lg">
              <CheckCircle2 className="w-4 h-4" /> Conformité DTU & Normes Tunisiennes
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 bg-amber-950/40 border border-amber-500/30 px-3 py-1.5 rounded-lg">
              <Scale className="w-4 h-4" /> Barème Fiscal 2026 Intégré (TVA & Retenues)
            </div>
          </div>
        </div>
      </div>

      {/* CORE VALUES & COMMITMENTS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Compass className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white">Précision Algorithmique</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Nos formules intègrent les règles réelles du chantier : pas de déduction des trémies &lt; 1m², majorations d'angles, calculs automatiques des profilés d'ossature, suspentes, cavaliers et marges de chute (scrap factor 5%).
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white">Transparence & Barème Réel</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Les tarifs de référence 2026 sont calibrés chaque semaine auprès des grossistes, quincailleries industrielles et fabricants (Knauf, Siniat, Placo Saint-Gobain, Ciments de Bizerte, Ciment Carthage, Astral).
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Globe2 className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white">Ancrage Local & Décentralisé</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Support multi-régions (Grand Tunis, Sahel, Sfax, Nord et Sud), adaptation en dialecte tunisien (Derja) et conversion multidevise instantanée pour les clients résidents à l'étranger (TRE).
          </p>
        </div>

      </div>

      {/* DTU STANDARDS MATRIX */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-amber-400" />
              Référentiel Technique & Normes DTU Appliquées
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Les calculs générés respectent rigoureusement les Documents Techniques Unifiés
            </p>
          </div>
          <button
            onClick={() => onNavigate('knowledge')}
            className="text-xs font-bold text-amber-400 hover:underline"
          >
            Consulter le Guide Complet →
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dtuStandards.map((st, i) => (
            <div key={i} className="p-5 rounded-xl bg-slate-900/40 border border-slate-800 hover:border-slate-700 transition-all space-y-2">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-1 text-xs font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-md">
                  {st.code}
                </span>
                <span className="text-[11px] font-semibold text-slate-400">{st.category}</span>
              </div>
              <h4 className="text-sm font-bold text-white">{st.title}</h4>
              <p className="text-xs text-slate-400 leading-relaxed">{st.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* LEGAL & CERTIFICATIONS */}
      <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 text-xs text-slate-400 space-y-3">
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          <Scale className="w-4 h-4 text-amber-400" />
          Mentions Légales & Dispositions Fiscales 2026
        </h4>
        <p className="leading-relaxed">
          KONSTRIVO est une suite logicielle d'aide à la décision et de métré technique. Les devis et estimations générés s'appuient sur les règles de calcul de la profession BTP. L'application des taxes (TVA 19%, timbre fiscal 1.000 TND, retenue de garantie 5% ou 10% selon cahier des charges) s'effectue conformément au Code Général des Impôts tunisien et aux lois de finances 2026 en vigueur.
        </p>
        <p className="text-slate-500 text-[11px]">
          Édition KONSTRIVO SaaS BTP • Siège : Centre Urbain Nord, Tunis • Contact technique : konstrivo.tn@gmail.com
        </p>
      </div>

    </div>
  );
};
