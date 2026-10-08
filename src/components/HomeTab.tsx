import React from 'react';
import { 
  Building2, HardHat, Calculator, Layers, Users, FileText, 
  ArrowRight, ShieldCheck, Briefcase, ChevronRight, Sparkles
} from 'lucide-react';
import { Language, CountryCode, CurrencyCode } from '../types';

interface HomeTabProps {
  onNavigate: (tabId: string) => void;
  lang: Language;
  country: CountryCode;
  currency: CurrencyCode;
  onOpenAuth: () => void;
}

export const HomeTab: React.FC<HomeTabProps> = ({
  onNavigate,
}) => {
  const coreCategoryCards = [
    {
      id: 'services',
      title: 'Services',
      description: "Découvrez tous nos services de construction et d'aménagement.",
      icon: Building2,
      targetTab: 'services'
    },
    {
      id: 'projects',
      title: 'Projets',
      description: 'Explorez nos réalisations et projets menés avec excellence.',
      icon: HardHat,
      targetTab: 'projects'
    },
    {
      id: 'tools',
      title: 'Outils',
      description: 'Accédez à des outils professionnels pour vos calculs et estimations.',
      icon: Calculator,
      targetTab: 'calculator'
    },
    {
      id: 'materials',
      title: 'Matériaux',
      description: 'Trouvez les meilleurs matériaux pour vos projets.',
      icon: Layers,
      targetTab: 'rates'
    },
    {
      id: 'professionals',
      title: 'Professionnels',
      description: 'Trouvez des professionnels qualifiés près de chez vous.',
      icon: Users,
      targetTab: 'directory_market'
    },
    {
      id: 'devis',
      title: 'Devis',
      description: 'Créez et gérez vos devis rapidement et simplement.',
      icon: FileText,
      targetTab: 'devis'
    }
  ];

  const statsMetrics = [
    {
      id: 'projects',
      number: '450 +',
      label: 'Projets réalisés',
      icon: Building2
    },
    {
      id: 'pros',
      number: '1200 +',
      label: 'Professionnels partenaires',
      icon: Users
    },
    {
      id: 'tools',
      number: '25 +',
      label: 'Outils professionnels',
      icon: Briefcase
    },
    {
      id: 'satisfaction',
      number: '98%',
      label: 'Clients satisfaits',
      icon: ShieldCheck
    }
  ];

  return (
    <div className="space-y-8 pb-12">
      
      {/* 1. HERO SECTION (Matching Accueil.png 1:1) */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-[#0b0f17] shadow-2xl min-h-[480px] sm:min-h-[520px] flex items-center">
        
        {/* Luxury Modern Villa Night Background */}
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-50 scale-105 transform transition-transform duration-1000"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=2000&q=85')`
          }}
        />
        
        {/* Deep Dark Navy Multi-Stop Gradient Overlays */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#0b0f17] via-[#0b0f17]/85 to-[#0b0f17]/50" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b0f17] via-transparent to-[#0b0f17]/60" />
        <div className="absolute inset-0 bg-blueprint opacity-40 pointer-events-none" />

        {/* Ambient Warm Golden Glow */}
        <div className="absolute top-10 left-10 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 right-10 w-80 h-80 bg-amber-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* Content Container (Left-aligned as in screenshot) */}
        <div className="relative z-10 px-6 py-12 sm:px-12 sm:py-16 max-w-3xl space-y-6">
          
          {/* Main Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-[1.1]">
            La technologie <br />
            au service <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500">
              du bâtiment.
            </span>
          </h1>

          {/* Subtext */}
          <p className="text-sm sm:text-base text-slate-300 leading-relaxed font-normal max-w-xl">
            KONSTRIVO est la plateforme tout-en-un dédiée aux professionnels de la construction, aux artisans, aux entrepreneurs et aux spécialistes du bâtiment.
          </p>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <button
              onClick={() => onNavigate('calculator')}
              className="px-6 sm:px-8 py-3.5 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-sm sm:text-base rounded-2xl shadow-lg shadow-amber-500/25 transition-all transform hover:-translate-y-0.5 flex items-center gap-2.5 cursor-pointer"
            >
              <span>Découvrir la plateforme</span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>

            <button
              onClick={() => onNavigate('services')}
              className="px-6 sm:px-7 py-3.5 bg-transparent hover:bg-slate-800/80 text-white font-bold text-sm sm:text-base rounded-2xl border border-slate-700 hover:border-slate-500 transition-all flex items-center gap-2.5 cursor-pointer"
            >
              <span>Explorer les services</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </button>
          </div>

        </div>

      </section>

      {/* 2. SIX CORE CATEGORY CARDS GRID (Matching Accueil.png 1:1) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        {coreCategoryCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.id}
              onClick={() => onNavigate(card.targetTab)}
              className="bg-[#131b2e] hover:bg-[#18233c] border border-slate-800 hover:border-amber-500/50 rounded-2xl p-6 flex flex-col justify-between transition-all duration-300 hover:shadow-xl hover:shadow-amber-500/10 cursor-pointer group space-y-4"
            >
              {/* Icon Container */}
              <div>
                <div className="w-12 h-12 rounded-xl bg-slate-900/80 border border-slate-700/80 flex items-center justify-center text-amber-400 group-hover:border-amber-500/50 group-hover:scale-105 transition-all">
                  <Icon className="w-6 h-6 stroke-[1.75]" />
                </div>
              </div>

              {/* Title & Description */}
              <div className="space-y-2 flex-1">
                <h3 className="text-lg font-bold text-white group-hover:text-amber-400 transition-colors">
                  {card.title}
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed font-normal">
                  {card.description}
                </p>
              </div>

              {/* Link CTA */}
              <div className="pt-2 border-t border-slate-800/60 flex items-center gap-1.5 text-xs font-bold text-amber-400 group-hover:text-amber-300">
                <span>Découvrir</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          );
        })}
      </section>

      {/* 3. METRICS STATS BAR (Matching Accueil.png 1:1) */}
      <section className="bg-[#131b2e] border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
          {statsMetrics.map((stat) => {
            const Icon = stat.icon;
            return (
              <div 
                key={stat.id} 
                className="flex items-center gap-4 group p-2 rounded-2xl hover:bg-slate-900/40 transition-colors"
              >
                {/* Outlined Gold Icon Box */}
                <div className="w-14 h-14 rounded-2xl bg-slate-900/90 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0 group-hover:border-amber-400 group-hover:scale-105 transition-all shadow-md shadow-amber-500/5">
                  <Icon className="w-7 h-7 stroke-[1.5]" />
                </div>

                {/* Stat Content */}
                <div className="space-y-1">
                  <div className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tight">
                    {stat.number}
                  </div>
                  <div className="text-xs text-slate-400 font-medium">
                    {stat.label}
                  </div>
                  {/* Subtle Gold Accent Line */}
                  <div className="w-8 h-0.5 bg-amber-500/80 rounded-full group-hover:w-12 transition-all" />
                </div>
              </div>
            );
          })}
        </div>
      </section>

    </div>
  );
};
