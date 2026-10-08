import React, { useState } from 'react';
import { 
  X, Layers, Ruler, MapPin, Camera, CheckCircle2, ArrowRight, ArrowLeft, 
  Sparkles, FileText, Share2, Upload, AlertTriangle, ShieldCheck, DollarSign,
  Building2, Home, Hammer, Paintbrush, Umbrella, Volume2, ShieldAlert
} from 'lucide-react';
import { CountryCode, CurrencyCode, Language, RegionTunisia, TradeCategory } from '../types';
import { getCurrencyMeta, formatPrice } from '../data/countryConfig';
import { openWhatsApp } from '../utils/whatsapp';

interface VisualDevisWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  country: CountryCode;
  currency: CurrencyCode;
  userRegion?: string;
}

export interface WizardProjectRequest {
  projectType: string;
  projectTitle: string;
  tradeCategory: TradeCategory;
  lengthM: number;
  widthM: number;
  surfaceM2: number;
  heightM: number;
  boardType: string;
  hasInsulation: boolean;
  insulationType: string;
  governorate: string;
  cityOrQuartier: string;
  floorAccess: string;
  startDate: string;
  clientName: string;
  clientPhone: string;
  siteNotes: string;
  photoUrl?: string;
  photoFileName?: string;
}

export const TUNISIAN_GOVERNORATES = [
  'Tunis Grand', 'Ariana', 'Ben Arous', 'Manouba',
  'Nabeul / Cap Bon', 'Bizerte', 'Sousse / Sahel', 'Monastir',
  'Mahdia', 'Sfax', 'Kairouan', 'Gabès', 'Médenine / Djerba',
  'Béja', 'Jendouba', 'Le Kef', 'Siliana', 'Kasserine',
  'Sidi Bouzid', 'Gafsa', 'Tozeur', 'Kebili', 'Tataouine', 'Zaghouan'
];

export const VisualDevisWizardModal: React.FC<VisualDevisWizardModalProps> = ({
  isOpen,
  onClose,
  lang,
  country,
  currency,
  userRegion = 'Tunis Grand'
}) => {
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Form State
  const [projectData, setProjectData] = useState<WizardProjectRequest>({
    projectType: 'faux_plafond_ba13',
    projectTitle: 'Faux Plafond BA13 Standard',
    tradeCategory: 'placo',
    lengthM: 6,
    widthM: 4,
    surfaceM2: 24,
    heightM: 2.8,
    boardType: 'ba13_standard',
    hasInsulation: true,
    insulationType: 'laine_verre_50',
    governorate: userRegion || 'Tunis Grand',
    cityOrQuartier: 'Cité Ennasr',
    floorAccess: '2ème étage sans ascenseur',
    startDate: 'Immédiat (Sous 48h)',
    clientName: 'M. Sami Ben Salem',
    clientPhone: '+216 98 123 456',
    siteNotes: 'Besoin d\'une finition lisse prête à peindre avec réservation spot encastré LED.',
    photoUrl: undefined,
    photoFileName: undefined
  });

  if (!isOpen) return null;

  const currMeta = getCurrencyMeta(currency);

  // Quick Area Auto-Calculation
  const handleDimensionChange = (field: 'lengthM' | 'widthM', val: number) => {
    const updatedLength = field === 'lengthM' ? val : projectData.lengthM;
    const updatedWidth = field === 'widthM' ? val : projectData.widthM;
    const updatedSurface = +(updatedLength * updatedWidth).toFixed(2);

    setProjectData(prev => ({
      ...prev,
      [field]: val,
      surfaceM2: updatedSurface
    }));
  };

  // Quick Material Cost Estimates
  const calculateEstimatedTotals = () => {
    const area = projectData.surfaceM2 || 1;
    let pricePerM2Mat = 32.0; // TND/m2 material
    let pricePerM2Labor = 18.0; // TND/m2 labor

    if (projectData.boardType === 'ba13_hydrofuge') pricePerM2Mat += 8.0;
    if (projectData.boardType === 'ba13_coupe_feu') pricePerM2Mat += 10.0;
    if (projectData.boardType === 'aquapanel') pricePerM2Mat += 35.0;
    if (projectData.hasInsulation) pricePerM2Mat += 6.5;

    const totalMatTnd = +(area * pricePerM2Mat).toFixed(3);
    const totalLaborTnd = +(area * pricePerM2Labor).toFixed(3);
    const totalHt = +(totalMatTnd + totalLaborTnd).toFixed(3);
    const tvaVal = +(totalHt * 0.19).toFixed(3);
    const totalTtc = +(totalHt + tvaVal + 1.0).toFixed(3);

    return { totalMatTnd, totalLaborTnd, totalHt, tvaVal, totalTtc, pricePerM2Mat, pricePerM2Labor };
  };

  const totals = calculateEstimatedTotals();

  // Photo Upload Simulation
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        setProjectData(prev => ({
          ...prev,
          photoUrl: evt.target?.result as string,
          photoFileName: file.name
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSendWhatsApp = () => {
    const text = `🇹🇳 *DEMANDE DE DEVIS DEMANDÉE VIA ASSISTANT KONSTRIVO 2026*\n\n` +
      `📋 *Projet:* ${projectData.projectTitle}\n` +
      `📐 *Dimensions:* ${projectData.lengthM}m x ${projectData.widthM}m = *${projectData.surfaceM2} m²*\n` +
      `🛠️ *Spécifications:* Plaque ${projectData.boardType.toUpperCase()} ${projectData.hasInsulation ? '+ Isolation' : ''}\n` +
      `📍 *Localisation:* ${projectData.governorate} (${projectData.cityOrQuartier})\n` +
      `🏢 *Accès Chantier:* ${projectData.floorAccess}\n\n` +
      `💰 *Estimation Fournitures HT:* ${formatPrice(totals.totalMatTnd, currency, country)}\n` +
      `👷 *Estimation Main d'œuvre:* ${formatPrice(totals.totalLaborTnd, currency, country)}\n` +
      `🧾 *TOTAL ESTIMÉ TTC:* ${formatPrice(totals.totalTtc, currency, country)}\n\n` +
      `👤 *Client:* ${projectData.clientName} (${projectData.clientPhone})\n` +
      `📝 *Remarques:* ${projectData.siteNotes}\n\n` +
      `_Envoyé depuis KONSTRIVO Assistant Visuel BTP_`;
    openWhatsApp(text);
  };

  const projectTypesList = [
    {
      id: 'faux_plafond_ba13',
      title: 'Faux Plafond Simple BA13',
      titleAr: 'سقف مستعار بلاكو BA13',
      icon: Layers,
      category: 'placo' as TradeCategory,
      desc: 'Plafond suspendu sur ossature métallique F530'
    },
    {
      id: 'cloison_separative',
      title: 'Cloison Séparative Placo',
      titleAr: 'حائط فاصل بلاكو',
      icon: Home,
      category: 'placo' as TradeCategory,
      desc: 'Séparation intérieure double ou simple peau avec rails R48'
    },
    {
      id: 'plafond_demontable',
      title: 'Plafond Démontable 60x60',
      titleAr: 'سقف تفكيكي 60x60',
      icon: Building2,
      category: 'placo' as TradeCategory,
      desc: 'Dalles vinyle ou laine de roche sur ossature apparente'
    },
    {
      id: 'aquapanel_exterieur',
      title: 'Habillage Extérieur Aquapanel',
      titleAr: 'تغليف خارجي أكوابانال',
      icon: Umbrella,
      category: 'facade' as TradeCategory,
      desc: 'Plaque ciment extérieure haute résistance aux intempéries'
    },
    {
      id: 'peinture_finition',
      title: 'Peinture & Enduit Finition',
      titleAr: 'دهان وتغليف داخلي',
      icon: Paintbrush,
      category: 'peinture' as TradeCategory,
      desc: 'Impression, enduit de lissage & peinture vinylique'
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-[#0b0f17] border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 text-white">
        
        {/* Wizard Top Header */}
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/40 p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-white flex items-center gap-2">
                Assistant Devis Visuel Multi-Étapes
                <span className="px-2 py-0.5 text-[10px] font-black uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full font-mono">
                  Étape {currentStep} / 5
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Créez une demande de chiffrage précise et envoyez-la directement sur WhatsApp
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Wizard Progress Bar */}
        <div className="w-full bg-slate-950 h-1.5 flex">
          {[1, 2, 3, 4, 5].map((step) => (
            <div
              key={step}
              className={`h-full flex-1 transition-all duration-300 ${
                step <= currentStep ? 'bg-gradient-to-r from-amber-400 to-amber-500' : 'bg-slate-800'
              }`}
            />
          ))}
        </div>

        {/* Wizard Body Steps */}
        <div className="p-5 sm:p-6 space-y-6">
          
          {/* STEP 1: PROJECT TYPE SELECTION */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-in fade-in">
              <div className="text-center space-y-1 mb-4">
                <h4 className="text-base font-bold text-white">1. Choisissez le type d'ouvrage BTP :</h4>
                <p className="text-xs text-slate-400">Sélectionnez la catégorie de votre chantier</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {projectTypesList.map((pt) => {
                  const Icon = pt.icon;
                  const isSelected = projectData.projectType === pt.id;
                  return (
                    <div
                      key={pt.id}
                      onClick={() => setProjectData(prev => ({
                        ...prev,
                        projectType: pt.id,
                        projectTitle: pt.title,
                        tradeCategory: pt.category
                      }))}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500 text-white shadow-lg shadow-amber-500/10'
                          : 'bg-slate-950 border-slate-800/80 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <div className={`p-2.5 rounded-xl ${isSelected ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-900 text-amber-400'}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-xs font-bold text-white">{pt.title}</div>
                        <div className="text-[10px] text-slate-400">{pt.titleAr}</div>
                        <div className="text-[10px] text-slate-500 line-clamp-1">{pt.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2: DIMENSIONS & TECHNICAL SPECS */}
          {currentStep === 2 && (
            <div className="space-y-5 animate-in fade-in">
              <div className="text-center space-y-1">
                <h4 className="text-base font-bold text-white">2. Saisissez les dimensions et options techniques :</h4>
                <p className="text-xs text-slate-400">Calcul automatique de la surface et fournitures nécessaires</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">Longueur (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={projectData.lengthM}
                    onChange={(e) => handleDimensionChange('lengthM', parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-amber-400 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">Largeur (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={projectData.widthM}
                    onChange={(e) => handleDimensionChange('widthM', parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-amber-400 font-mono"
                  />
                </div>

                <div className="col-span-2 sm:col-span-1 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl text-center">
                  <span className="text-[10px] text-slate-400 block font-bold">Surface Calculée :</span>
                  <span className="text-base font-black text-amber-400 font-mono">{projectData.surfaceM2} m²</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Type de Plaque / Matériau</label>
                  <select
                    value={projectData.boardType}
                    onChange={(e) => setProjectData(prev => ({ ...prev, boardType: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold"
                  >
                    <option value="ba13_standard">BA13 Standard 12.5mm (Gris)</option>
                    <option value="ba13_hydrofuge">BA13 Hydrofuge Vert (Salles d'eau)</option>
                    <option value="ba13_coupe_feu">BA13 Ignifuge Coupe-Feu Rose</option>
                    <option value="ba13_phonique">BA13 Phonique Acoustique Bleu</option>
                    <option value="aquapanel">Aquapanel Ciment Extérieur</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Isolation Acoustique & Thermique</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="checkbox"
                      id="insulation_check"
                      checked={projectData.hasInsulation}
                      onChange={(e) => setProjectData(prev => ({ ...prev, hasInsulation: e.target.checked }))}
                      className="w-4 h-4 accent-amber-500"
                    />
                    <label htmlFor="insulation_check" className="text-xs text-slate-300 font-medium">
                      Inclure Laine de verre 50mm avec kraft
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: LOCATION & SITE ACCESS */}
          {currentStep === 3 && (
            <div className="space-y-4 animate-in fade-in">
              <div className="text-center space-y-1">
                <h4 className="text-base font-bold text-white">3. Localisation du chantier en Tunisie :</h4>
                <p className="text-xs text-slate-400">Pour cibler les artisans et quincailleries à proximité</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Gouvernorat</label>
                  <select
                    value={projectData.governorate}
                    onChange={(e) => setProjectData(prev => ({ ...prev, governorate: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold"
                  >
                    {TUNISIAN_GOVERNORATES.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Ville / Quartier</label>
                  <input
                    type="text"
                    value={projectData.cityOrQuartier}
                    onChange={(e) => setProjectData(prev => ({ ...prev, cityOrQuartier: e.target.value }))}
                    placeholder="Ex: Marsa, Ennasr, Menzah 9..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Accès Chantier & Étage</label>
                  <input
                    type="text"
                    value={projectData.floorAccess}
                    onChange={(e) => setProjectData(prev => ({ ...prev, floorAccess: e.target.value }))}
                    placeholder="Ex: Rez-de-chaussée, 3ème étage sans ascenseur"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Délai Souhaité</label>
                  <select
                    value={projectData.startDate}
                    onChange={(e) => setProjectData(prev => ({ ...prev, startDate: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  >
                    <option value="Immédiat (Sous 48h)">Immédiat (Sous 48h)</option>
                    <option value="D'ici 1 à 2 semaines">D'ici 1 à 2 semaines</option>
                    <option value="Planification mois prochain">Planification mois prochain</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: PHOTO / BLUEPRINT UPLOAD */}
          {currentStep === 4 && (
            <div className="space-y-4 animate-in fade-in">
              <div className="text-center space-y-1">
                <h4 className="text-base font-bold text-white">4. Importez des photos du chantier ou plans :</h4>
                <p className="text-xs text-slate-400">Facilite l'estimation par les artisans et évite les surprises</p>
              </div>

              <div className="border-2 border-dashed border-slate-800 rounded-2xl p-6 text-center bg-slate-950/60 hover:border-amber-400/50 transition-all">
                <Camera className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                <p className="text-xs font-bold text-white mb-1">Prenez une photo depuis votre mobile ou choisissez un fichier</p>
                <p className="text-[10px] text-slate-400 mb-4">Formats acceptés: JPG, PNG, PDF (Plan d'architecte, photo de la pièce)</p>

                <label className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs cursor-pointer inline-flex items-center gap-2 shadow-lg shadow-amber-500/20">
                  <Upload className="w-4 h-4" />
                  <span>Sélectionner / Prende Photo</span>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </label>

                {projectData.photoUrl && (
                  <div className="mt-4 p-2 bg-slate-900 border border-slate-700 rounded-xl inline-flex items-center gap-3">
                    <img src={projectData.photoUrl} alt="Chantier" className="w-12 h-12 object-cover rounded-lg" />
                    <div className="text-left">
                      <div className="text-xs font-bold text-emerald-400">✓ Photo ajoutée</div>
                      <div className="text-[10px] text-slate-400">{projectData.photoFileName || 'Image chantier'}</div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Remarques ou besoins spécifiques</label>
                <textarea
                  rows={2}
                  value={projectData.siteNotes}
                  onChange={(e) => setProjectData(prev => ({ ...prev, siteNotes: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white"
                />
              </div>
            </div>
          )}

          {/* STEP 5: SUMMARY & INSTANT WHATSAPP SHARE */}
          {currentStep === 5 && (
            <div className="space-y-4 animate-in fade-in">
              <div className="text-center space-y-1">
                <h4 className="text-base font-bold text-white">5. Récapitulatif & Chiffrage Estimatif :</h4>
                <p className="text-xs text-slate-400">Votre devis estimatif est prêt à être partagé</p>
              </div>

              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Ouvrage BTP :</span>
                  <span className="font-bold text-white">{projectData.projectTitle}</span>
                </div>

                <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Métré Net :</span>
                  <span className="font-bold text-amber-400 font-mono">{projectData.surfaceM2} m²</span>
                </div>

                <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Fournitures H.T Estimées :</span>
                  <span className="font-bold font-mono text-white">{formatPrice(totals.totalMatTnd, currency, country)}</span>
                </div>

                <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Pose & Main d'œuvre :</span>
                  <span className="font-bold font-mono text-amber-400">{formatPrice(totals.totalLaborTnd, currency, country)}</span>
                </div>

                <div className="flex justify-between items-center text-sm font-bold pt-1 bg-amber-500/10 p-3 rounded-xl border border-amber-500/20">
                  <span className="text-amber-300">ESTIMATION TOTALE TTC :</span>
                  <span className="text-base font-black text-amber-400 font-mono">{formatPrice(totals.totalTtc, currency, country)}</span>
                </div>
              </div>

              <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-[11px] text-emerald-300 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Prêt à envoyer aux quincailleries et artisans certifiés KONSTRIVO de la région de <strong>{projectData.governorate}</strong>.</span>
              </div>
            </div>
          )}

        </div>

        {/* Wizard Footer Controls */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          {currentStep > 1 ? (
            <button
              onClick={() => setCurrentStep(prev => prev - 1)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Précédent</span>
            </button>
          ) : (
            <div />
          )}

          {currentStep < 5 ? (
            <button
              onClick={() => setCurrentStep(prev => prev + 1)}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-amber-500/20 flex items-center gap-2 transition-all cursor-pointer"
            >
              <span>Étape Suivante</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSendWhatsApp}
              className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black rounded-xl shadow-xl shadow-emerald-500/20 flex items-center gap-2 transition-all cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              <span>Envoyer ma demande via WhatsApp</span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
