import React from 'react';
import { Calculator, Tag, FileText, Settings, Bot, Building2, Users, Wrench, Layers } from 'lucide-react';
import { Language } from '../types';

interface BottomNavBarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  lang: Language;
  devisCount: number;
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({
  activeTab,
  setActiveTab,
  lang,
  devisCount
}) => {
  const tabs = [
    {
      id: 'calculator',
      icon: Calculator,
      labelFr: 'Calcul',
      labelAr: 'الحاسبة',
      badge: null
    },
    {
      id: 'projects',
      icon: Building2,
      labelFr: 'Chantiers',
      labelAr: 'الشانطي',
      badge: null
    },
    {
      id: 'directory_market',
      icon: Users,
      labelFr: 'Marché',
      labelAr: 'السوق',
      badge: null
    },
    {
      id: 'maintenance',
      icon: Wrench,
      labelFr: 'Dépannage',
      labelAr: 'الصيانة',
      badge: null
    },
    {
      id: 'devis',
      icon: FileText,
      labelFr: 'Devis',
      labelAr: 'التقارير',
      badge: devisCount > 0 ? devisCount : null
    },
    {
      id: 'metre_workflow',
      icon: Layers,
      labelFr: 'Métré Pro',
      labelAr: 'المتراج',
      badge: null
    },
    {
      id: 'assistant',
      icon: Bot,
      labelFr: 'AI',
      labelAr: 'مساعد',
      badge: 'AI'
    }
  ];

  return (
    <nav
      id="konstrivo-bottom-nav"
      aria-label="Navigation principale mobile"
      className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800/90 md:hidden px-1.5 py-1.5 shadow-2xl print:hidden"
    >
      <div className="grid grid-cols-7 gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`bottom-nav-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex flex-col items-center justify-center py-1 px-0.5 rounded-xl transition-all ${
                isActive
                  ? 'text-amber-400 font-bold bg-amber-500/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <div className="relative">
                <Icon className={`w-4 h-4 ${isActive ? 'text-amber-400 stroke-[2.5]' : 'text-slate-400'}`} />
                {tab.badge && (
                  <span
                    className={`absolute -top-1.5 -right-2 px-1 py-0.2 text-[8px] font-black rounded-full leading-none ${
                      tab.badge === 'AI'
                        ? 'bg-gradient-to-r from-amber-400 to-amber-600 text-slate-950 px-1 py-0.5'
                        : 'bg-amber-500 text-slate-950 min-w-3 text-center'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[9px] mt-1 truncate max-w-full text-center">
                {lang === 'ar' || lang === 'ar' ? tab.labelAr : tab.labelFr}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
