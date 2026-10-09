import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowRight, Search, MapPin, CheckCircle2,
  Layers, HardHat, ShieldCheck, PhoneCall, Sparkles,
  ChevronRight, Wrench, Paintbrush, Home, Building, Zap
} from 'lucide-react';
import { Language, MaterialRate, Trade } from '../types';
import { catalogKey, groupCatalogEntries, prettyCatalogCode, sameCatalogKey, uniqueCatalogValues, CatalogGroup } from '../utils/catalogDisplay';
import { isExcludedSentinelTradeCode, isDisplayableCatalogueTrade, isExcludedPublicTradeLabel } from '../utils/catalogDisplay';
import { listTrades, listTradeServices } from '../lib/api';
import { subscribeTradeRegistry, isTradeInactiveOrDeleted } from '../data/tradeRegistry';


export interface ServiceNavContext {
  tradeCode: string;
  serviceLabel?: string;
}

/**
 * Material count of one métier card — CATEGORY **OR** TRADE (READ-PATH ONLY).
 *
 * The same métier legitimately appears in the catalogue under two identities:
 * `category` (supplier family label from the CSV import, e.g. "Menuiserie
 * Aluminium") and `trade` (the authoritative trade code / registry label, e.g.
 * "aluminium"). Counting by `category` only showed «0 matériaux» on cards whose
 * materials are filed under the other identity. A rate is counted for the group
 * when `catalogKey(rate.category)` OR `catalogKey(rate.trade)` equals the
 * group's métier key or ANY of its classification codes — each RATE counts once
 * per group even when both of its identities map into the same group.
 *
 * Pure + display-only: no rate is created, changed, removed or written back,
 * and the calculator behaviour is untouched.
 */
export function countRatesForCatalogGroup(
  rates: MaterialRate[],
  group: Pick<CatalogGroup, 'key' | 'codes'>
): number {
  const targetKeys = new Set<string>();
  const addTarget = (raw: string | null | undefined) => {
    const key = catalogKey(raw);
    if (key) targetKeys.add(key);
  };
  addTarget(group.key);
  for (const code of group.codes) addTarget(code);
  if (targetKeys.size === 0) return 0;
  let count = 0;
  for (const rate of rates) {
    const byCategory = catalogKey(rate.category);
    const byTrade = catalogKey(rate.trade);
    if ((byCategory !== '' && targetKeys.has(byCategory))
      || (byTrade !== '' && targetKeys.has(byTrade))) count++;
  }
  return count;
}

interface ServicesTabProps {
  onNavigate: (tabId: string, opts?: { tradeCode?: string }) => void;
  lang: Language;
  /** Live catalogue — used to derive dynamic métier cards (material counts). */
  rates?: MaterialRate[];
  /** Deep-link to Outils/Calculator with a trade context. Falls back to onNavigate('calculator'). */
  onSelectService?: (ctx: ServiceNavContext) => void;
}

export const ServicesTab: React.FC<ServicesTabProps> = ({
  onNavigate,
  rates = [],
  onSelectService,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [locationTerm, setLocationTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // ── Dynamic métiers (DB trades + categories present in `rates`) ──────────
  const [dynTrades, setDynTrades] = useState<Trade[]>([]);
  const [serviceCountByCode, setServiceCountByCode] = useState<Record<string, number>>({});
  const [tradeRegistryTick, setTradeRegistryTick] = useState(0);

  useEffect(() => {
    return subscribeTradeRegistry(() => setTradeRegistryTick((t) => t + 1));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await listTrades();
        if (!cancelled && Array.isArray(res?.data)) setDynTrades(res.data);
      } catch { /* offline — rates-only fallback below */ }
    })();
    return () => { cancelled = true; };
  }, [tradeRegistryTick]);
  // Service counts actually present in DB (no fake services ever created here).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const withId = dynTrades.filter(t => t?.id && t?.code);
      if (withId.length === 0) return;
      const entries = await Promise.all(
        withId.slice(0, 30).map(async (t) => {
          try {
            const list = await listTradeServices(t.id);
            return [t.code, Array.isArray(list) ? list.length : 0] as const;
          } catch { return [t.code, 0] as const; }
        })
      );
      if (!cancelled) {
        const next: Record<string, number> = {};
        for (const [code, n] of entries) next[code] = n;
        setServiceCountByCode(next);
      }
    })();
    return () => { cancelled = true; };
  }, [dynTrades]);

  // ── Public-catalogue cleaning for « Métiers du catalogue » (DISPLAY ONLY) ──
  // The section must advertise only the ADDITIONAL catalogue métiers — never a
  // duplicate of an official trade the Calculator / « Nos services » already
  // serve, and never a bare import/administration machine identifier. The one
  // shared rule lives in `isDisplayableCatalogueTrade()` (non-official AND
  // human-labelled); `officialTradeKeys` lets the rates-only fallback apply the
  // same official exclusion as the registry path. NOTHING is deleted from the
  // Registry or the DB, and no `trade_code` is invented.
  const officialTradeKeys = useMemo(
    () => new Set(dynTrades.filter(t => t.isOfficial && t.code).map(t => catalogKey(t.code))),
    [dynTrades]
  );
  // Unique trade codes: DB registry codes (isActive=true) + any classification present in local rates
  // UNLESS proven inactive or deleted by Admin in the DB registry.
  const rateTradeCodes: string[] = useMemo(
    () => uniqueCatalogValues(rates.map(r => r.category)).filter(code =>
      !isTradeInactiveOrDeleted(code)
      && !isExcludedSentinelTradeCode(code)
      && !isExcludedPublicTradeLabel(code)
      && !officialTradeKeys.has(catalogKey(code))
    ),
    [rates, officialTradeKeys]
  );
  const activeDynTrades = useMemo(() => {
    return dynTrades.filter(t => t.isActive !== false
      && !isTradeInactiveOrDeleted(t.code)
      && !isExcludedSentinelTradeCode(t.code)
      && isDisplayableCatalogueTrade(t)
    );
  }, [dynTrades]);

  const mergedTradeCodes: string[] = useMemo(() => {
    // When the registry answered (any row), it is the authoritative source —
    // even if the cleaning above left it empty (the section then simply hides).
    // The local-rate categories are ONLY the offline fallback (registry down),
    // so a loaded registry never silently repopulates the section with raw
    // import families.
    if (dynTrades.length > 0) {
      return uniqueCatalogValues(activeDynTrades.map(t => (t.code || '').trim()).filter(Boolean));
    }
    return uniqueCatalogValues([
      ...activeDynTrades.map(t => (t.code || '').trim()).filter(Boolean),
      ...rateTradeCodes,
    ]);
  }, [dynTrades, activeDynTrades, rateTradeCodes]);

  const tradeLabelByCode: Record<string, string> = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of activeDynTrades) if (t?.code) m[t.code] = t.labelFr || t.code;
    return m;
  }, [activeDynTrades]);
  function prettyCode(code: string): string {
    return prettyCatalogCode(code);
  }

  // ── Display grouping (no data change) ─────────────────────────────────────
  // The registry can contain many trade codes that all carry the SAME métier
  // label (production: 21 aluminium classifications — profilés, fenêtres,
  // portes, joints… — all labelled "Aluminium"). Each métier is now rendered
  // ONCE, and every classification stays reachable as a sub-chip that opens the
  // calculator with its own code.
  const tradeGroups: CatalogGroup[] = useMemo(
    () => groupCatalogEntries(
      mergedTradeCodes.map(code => {
        const dbTrade = activeDynTrades.find(t => t.code === code);
        return {
          code,
          label: dbTrade?.labelFr || tradeLabelByCode[code] || prettyCatalogCode(code),
          official: !!dbTrade?.isOfficial,
        };
      })
    ),
    [mergedTradeCodes, activeDynTrades, tradeLabelByCode]
  );
  // Categories already covered by the static "Nos services" cards are filtered
  // out of the dynamic list below (compared spelling-insensitively so "Placo"
  // never duplicates "placo").
  // Material count per métier card — CATEGORY **OR** TRADE (was: category
  // only). The pure helper above matches each rate against the group's métier
  // key and every classification code, spelling-insensitively, exactly once
  // per rate — so the 40 aluminium materials appear on the Aluminium card
  // whether they are filed under the trade code or the supplier family label.
  function materialCountForGroup(group: CatalogGroup): number {
    return countRatesForCatalogGroup(rates, group);
  }
  function serviceCountForGroup(group: CatalogGroup): number {
    return group.codes.reduce((sum, code) => sum + (serviceCountByCode[code] || 0), 0);
  }
  function goToCalculator(tradeCode: string, serviceLabel?: string): void {
    if (onSelectService) onSelectService({ tradeCode, serviceLabel });
    else onNavigate('calculator');
  }

  const servicesList = [
    {
      id: 'placo',
      title: 'Placo & Plaques de plâtre',
      description: 'Pose de plaques, cloisons, doublage, aménagement intérieur.',
      image: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=800&q=80',
      badge: 'BA13 / BA15',
      category: 'placo'
    },
    {
      id: 'faux_plafond',
      title: 'Faux plafond',
      description: 'Faux plafonds simples, décoratifs, solutions techniques.',
      image: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80',
      badge: 'Gorge & LED',
      category: 'placo'
    },
    {
      id: 'cloison',
      title: 'Cloison & Séparation',
      description: 'Cloisons fixes, démontables, organisation des espaces.',
      image: 'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=800&q=80',
      badge: 'M48 / M70',
      category: 'cloison'
    },
    {
      id: 'isolation',
      title: 'Isolation',
      description: 'Solutions d’isolation thermique et acoustique.',
      image: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=800&q=80',
      badge: 'Laine minérale',
      category: 'isolation'
    },
    {
      id: 'decoration',
      title: 'Décoration intérieure',
      description: 'Habillage mural, finitions.',
      image: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=800&q=80',
      badge: 'Sur-mesure',
      category: 'decoration'
    },
    {
      id: 'peinture',
      title: 'Peinture & Finitions',
      description: 'Finition, rénovation surfaces.',
      image: 'https://images.unsplash.com/photo-1562259949-e8e7689d7828?auto=format&fit=crop&w=800&q=80',
      badge: 'Enduit & Laque',
      category: 'peinture'
    },
    {
      id: 'renovation',
      title: 'Rénovation',
      description: 'Transformer, moderniser les espaces existants.',
      image: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=800&q=80',
      badge: 'Clé en main',
      category: 'renovation'
    },
    {
      id: 'construction',
      title: 'Construction',
      description: 'Différents travaux de construction et gros œuvre.',
      image: 'https://images.unsplash.com/photo-1541888946425-d0fbb180c5f7?auto=format&fit=crop&w=800&q=80',
      badge: 'Structure',
      category: 'construction'
    }
  ];

  const filteredServices = servicesList.filter((s) => {
    const matchSearch = searchTerm === '' || s.title.toLowerCase().includes(searchTerm.toLowerCase()) || s.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCategory = selectedCategory === 'all' || s.category === selectedCategory;
    return matchSearch && matchCategory;
  });

  // One card per métier NOT already covered by the static services above — so
  // "Aluminium" (21 classifications in the registry) is listed exactly once,
  // in its own section, with each classification reachable below it.
  const serviceCategoryKeys = new Set(servicesList.map(s => catalogKey(s.category)));

  // LAYOUT-ONLY ordering inside the SAME grid: canonical métiers first (their
  // own registry order), then the dynamically detected groups in data order.
  // The API returns registry rows in insertion order, which made the section
  // open with a large multi-classification card and scattered the rows.
  // No name, group, content or behaviour changes — render order only.
  const tradeByCode = new Map<string, Trade>(dynTrades.filter(t => t?.code).map(t => [t.code, t] as const));
  const officialGroups: Array<{ group: CatalogGroup; sort: number }> = [];
  const otherGroups: CatalogGroup[] = [];
  for (const group of tradeGroups) {
    if (serviceCategoryKeys.has(group.key)) continue;
    const officialMembers = group.codes
      .map((code) => tradeByCode.get(code))
      .filter((t): t is Trade => !!t && t.isOfficial);
    if (officialMembers.length > 0) {
      officialGroups.push({ group, sort: Math.min(...officialMembers.map((t) => t.sortOrder)) });
    } else {
      otherGroups.push(group);
    }
  }
  officialGroups.sort((a, b) => a.sort - b.sort);
  const dynamicTradeGroups: CatalogGroup[] = [...officialGroups.map((e) => e.group), ...otherGroups];

  return (
    <div className="space-y-12 pb-12">
      
      {/* 1. HERO SECTION (Matching service.jpg 1:1) */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-[#0b0f17] shadow-2xl p-6 sm:p-12 lg:p-14">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          {/* Left Hero Content */}
          <div className="lg:col-span-7 space-y-6">
            <div className="text-xs font-bold text-amber-400 uppercase tracking-widest">
              SERVICES DU BÂTIMENT
            </div>

            <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-[1.15]">
              Tous les services du <br />
              bâtiment, <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-200">au même endroit.</span>
            </h1>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
              Trouvez les compétences, les professionnels et les solutions nécessaires pour réaliser vos projets de construction, rénovation et décoration.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                onClick={() => {
                  const target = document.getElementById('service-discovery');
                  target?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="px-6 py-3.5 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-sm rounded-2xl shadow-lg shadow-amber-500/25 transition-all flex items-center gap-2 cursor-pointer"
              >
                <span>Trouver un service</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={() => onNavigate('directory_market')}
                className="px-6 py-3.5 bg-transparent hover:bg-slate-800 text-white font-bold text-sm rounded-2xl border border-slate-700 hover:border-slate-500 transition-all flex items-center gap-2 cursor-pointer"
              >
                <span>Voir les professionnels</span>
                <ArrowRight className="w-4 h-4 text-slate-400" />
              </button>
            </div>
          </div>

          {/* Right Hero Image Card */}
          <div className="lg:col-span-5 relative">
            <div className="relative rounded-3xl overflow-hidden border border-slate-700 shadow-2xl h-72 sm:h-80">
              <img
                src="https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1000&q=80"
                alt="Chantier de construction"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0b0f17] via-transparent to-transparent" />
            </div>
          </div>

        </div>
      </section>

      {/* 2. NOS SERVICES (8 Photorealistic Cards Grid) */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-white">Nos services</h2>
          <p className="text-sm text-slate-400 mt-1">
            Des solutions adaptées à chaque étape de votre projet.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {filteredServices.map((srv) => (
            <div
              key={srv.id}
              onClick={() => goToCalculator(srv.category || srv.id, srv.title)}
              className="bg-[#131b2e] border border-slate-800 hover:border-amber-500/60 rounded-3xl overflow-hidden transition-all duration-300 hover:shadow-2xl hover:shadow-amber-500/10 cursor-pointer group flex flex-col justify-between"
            >
              {/* Card Photo Header */}
              <div className="relative h-44 overflow-hidden">
                <img
                  src={srv.image}
                  alt={srv.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#131b2e] via-transparent to-transparent" />
                
                {/* Gold Tag */}
                <div className="absolute top-3 left-3 bg-slate-950/80 backdrop-blur-md border border-amber-500/40 text-amber-300 text-[10px] font-bold px-2.5 py-1 rounded-full">
                  {srv.badge}
                </div>
              </div>

              {/* Card Content */}
              <div className="p-5 space-y-2 flex-1 flex flex-col justify-between">
                <div className="space-y-1.5">
                  <h3 className="text-base font-bold text-white group-hover:text-amber-400 transition-colors">
                    {srv.title}
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {srv.description}
                  </p>
                </div>

                <div className="pt-3 flex items-center justify-between text-xs font-bold text-amber-400 group-hover:text-amber-300 border-t border-slate-800/80">
                  <span>Calculer le métré</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 2b. DYNAMIC MÉTIERS (from DB trades + rates — no hardcode) ─────────── */}
      {dynamicTradeGroups.length > 0 && (
        <section className="space-y-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-black text-white">Métiers du catalogue</h2>
            <p className="text-sm text-slate-400 mt-1">
              Issus de vos imports et du registre professionnel — automatiquement détectés.
            </p>
          </div>
          {/* ONE unified grid — same columns/gap as "Nos services" above:
              equal-height cards, a fixed header slot, height-capped
              classification chips and a footer aligned on the card baseline. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 items-stretch">
            {dynamicTradeGroups
              .map((group) => {
                const label = group.label;
                const matCount = materialCountForGroup(group);
                const svcCount = serviceCountForGroup(group);
                const hasChips = group.codes.length > 1;
                return (
                  <div
                    key={`dyn-${group.key}`}
                    onClick={() => goToCalculator(group.primaryCode, label)}
                    className="h-full min-w-0 flex flex-col bg-[#131b2e] border border-slate-800 hover:border-amber-500/60 rounded-3xl overflow-hidden transition-all duration-300 hover:shadow-2xl hover:shadow-amber-500/10 cursor-pointer group p-5"
                  >
                    {/* Card body — grows so the footer always sits on the card
                        baseline, exactly like the "Nos services" cards */}
                    <div className="flex-1">
                      {/* Header — same slot and size on every card */}
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-black text-sm">
                          {label.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-base font-bold text-white group-hover:text-amber-400 transition-colors leading-tight truncate">
                            {label}
                          </h3>
                          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono truncate">
                            {hasChips ? `${group.codes.length} classifications` : group.codes[0]}
                          </p>
                        </div>
                      </div>

                      {/* Classifications — same slot in every card; the height is
                          capped so one large group can no longer stretch its row */}
                      {hasChips && (
                        <div className="mt-3 max-h-32 overflow-y-auto pr-1">
                          <div className="flex flex-wrap gap-1 content-start">
                            {group.codes.map((code) => (
                              <button
                                key={code}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  goToCalculator(code, label);
                                }}
                                className="px-1.5 py-0.5 rounded-lg text-[10px] font-bold border bg-slate-900 text-slate-300 border-slate-700 hover:border-amber-500/40 hover:text-amber-300 transition-colors cursor-pointer"
                              >
                                {code === group.primaryCode && sameCatalogKey(code, group.key) ? 'Général' : prettyCode(code)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Footer — always the last row, aligned on every card of the
                        row ("Calculer le métré" content and behaviour unchanged) */}
                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs font-bold text-amber-400 group-hover:text-amber-300">
                      <span>{matCount > 0 ? `${matCount} matériau${matCount > 1 ? 'x' : ''}` : svcCount > 0 ? `${svcCount} service${svcCount > 1 ? 's' : ''}` : 'Calculer le métré'}</span>
                      <ArrowRight className="w-4 h-4 flex-shrink-0 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* 3. SERVICE DISCOVERY SEARCH BAR (Matching service.jpg 1:1) */}
      <section id="service-discovery" className="bg-[#131b2e] border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6">
        <h2 className="text-xl sm:text-2xl font-bold text-white">Service discovery</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Que recherchez-vous? */}
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">Que recherchez-vous ?</label>
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Rechercher un service..."
                className="w-full bg-[#0b0f17] border border-slate-700 rounded-2xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
            </div>
          </div>

          {/* Où? (Ville / Gouvernorat) */}
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">Où ?</label>
            <div className="relative">
              <input
                type="text"
                value={locationTerm}
                onChange={(e) => setLocationTerm(e.target.value)}
                placeholder="(Ville / Gouvernorat)"
                className="w-full bg-[#0b0f17] border border-slate-700 rounded-2xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
            </div>
          </div>

          {/* Catégorie Dropdown */}
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">Catégorie</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full bg-[#0b0f17] border border-slate-700 rounded-2xl px-4 py-3 text-xs text-white focus:outline-none focus:border-amber-400"
            >
              <option value="all">Toutes les catégories</option>
              <option value="placo">Placo & Plâtre</option>
              <option value="cloison">Cloisons</option>
              <option value="isolation">Isolation</option>
              <option value="peinture">Peinture</option>
              <option value="renovation">Rénovation</option>
              <option value="construction">Construction</option>
            </select>
          </div>

          {/* Rechercher Button */}
          <div className="flex items-end">
            <button
              onClick={() => {
                const resultsSection = document.getElementById('service-discovery');
                resultsSection?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="w-full py-3.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-xs rounded-2xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Rechercher</span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>

        </div>
      </section>

      {/* 4. HOW IT WORKS (4 STEPS from screenshot) */}
      <section className="space-y-6">
        <h2 className="text-xl sm:text-2xl font-bold text-white">How it works</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          <div className="bg-[#131b2e] border border-slate-800 rounded-2xl p-5 space-y-3 relative group hover:border-amber-500/40 transition-colors">
            <div className="w-8 h-8 rounded-lg bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center">
              1
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Recherchez</h3>
              <p className="text-xs text-slate-400 mt-1">service adapté</p>
            </div>
            <ArrowRight className="w-4 h-4 text-amber-400" />
          </div>

          <div className="bg-[#131b2e] border border-slate-800 rounded-2xl p-5 space-y-3 relative group hover:border-amber-500/40 transition-colors">
            <div className="w-8 h-8 rounded-lg bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center">
              2
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Comparez</h3>
              <p className="text-xs text-slate-400 mt-1">professionnels disponibles</p>
            </div>
            <ArrowRight className="w-4 h-4 text-amber-400" />
          </div>

          <div className="bg-[#131b2e] border border-slate-800 rounded-2xl p-5 space-y-3 relative group hover:border-amber-500/40 transition-colors">
            <div className="w-8 h-8 rounded-lg bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center">
              3
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Contactez</h3>
              <p className="text-xs text-slate-400 mt-1">échanges directs</p>
            </div>
            <ArrowRight className="w-4 h-4 text-amber-400" />
          </div>

          <div className="bg-[#131b2e] border border-slate-800 rounded-2xl p-5 space-y-3 relative group hover:border-amber-500/40 transition-colors">
            <div className="w-8 h-8 rounded-lg bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center">
              4
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Réalisez</h3>
              <p className="text-xs text-slate-400 mt-1">solution adaptée</p>
            </div>
            <ArrowRight className="w-4 h-4 text-amber-400" />
          </div>

        </div>
      </section>

      {/* 5. BOTTOM CTA BANNER: Vous êtes un professionnel du bâtiment ? */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-[#0b0f17] p-8 sm:p-12 shadow-2xl">
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-25"
          style={{ backgroundImage: `url('https://images.unsplash.com/photo-1541888946425-d0fbb180c5f7?auto=format&fit=crop&w=1600&q=80')` }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0b0f17] via-[#0b0f17]/90 to-transparent" />

        <div className="relative z-10 max-w-2xl space-y-4">
          <h2 className="text-2xl sm:text-3xl font-black text-white">
            Vous êtes un professionnel <br />
            du bâtiment ?
          </h2>

          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            Présentez vos services, développez votre activité et trouvez de nouvelles opportunités avec KONSTRIVO.
          </p>

          <div className="flex flex-wrap gap-4 pt-2">
            <button
              onClick={() => onNavigate('directory_market')}
              className="px-6 py-3 bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 font-bold text-xs rounded-2xl shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2 cursor-pointer"
            >
              <span>Rejoindre KONSTRIVO</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => onNavigate('about')}
              className="px-6 py-3 bg-[#131b2e] hover:bg-slate-800 text-white font-bold text-xs rounded-2xl border border-slate-700 transition-all cursor-pointer"
            >
              <span>Découvrir les avantages</span>
            </button>
          </div>
        </div>
      </section>

    </div>
  );
};
