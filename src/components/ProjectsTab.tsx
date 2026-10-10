import React, { useState } from 'react';
import { 
  Building2, HardHat, Search, MapPin, Calendar, Clock, 
  ArrowRight, User, Eye, Plus, X, CheckCircle2, ChevronRight,
  Filter, Sparkles, Phone, Award, Layers
} from 'lucide-react';
import { ChantierProject, Language, CountryCode, CurrencyCode } from '../types';

interface ProjectsTabProps {
  projects: ChantierProject[];
  onUpdateProjects: (projects: ChantierProject[]) => void;
  /**
   * Phase 1 — persist the published project through the EXISTING authenticated
   * endpoint (POST /api/v1/projects, guarded server-side by
   * requireFeature('projects:save')). Fire-and-forget: the local state update
   * remains the immediate UI source of truth, and the caller keeps the
   * offline/unauthenticated localStorage fallback.
   */
  onSaveProject?: (project: any) => void | Promise<void>;
  lang: Language;
  country: CountryCode;
  currency: CurrencyCode;
  onNavigate?: (tabId: string) => void;
}

export const ProjectsTab: React.FC<ProjectsTabProps> = ({
  projects,
  onUpdateProjects,
  onSaveProject,
  onNavigate
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedModalProject, setSelectedModalProject] = useState<any | null>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);

  // New Project Form state
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('Placo & Plâtre');
  const [newRegion, setNewRegion] = useState('Tunis');
  const [newSurface, setNewSurface] = useState(120);
  const [newDuration, setNewDuration] = useState('3 semaines');
  const [newProName, setNewProName] = useState('Artisan Plaquiste Pro');
  const [newDescription, setNewDescription] = useState('');

  // Display-only: remove demo showcase from the public projects page.
  // Real project records and the existing publish/API flow remain untouched.
  const showcaseProjects: any[] = [];
  void showcaseProjects;

  const baseProjects: any[] = (projects && projects.length > 0) ? projects : [];
  void baseProjects;

  const handlePublishProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const newProj = {
      id: `proj-${Date.now()}`,
      title: newTitle,
      category: newCategory,
      location: `${newRegion} • Résidentiel`,
      surface: `${newSurface} m²`,
      duration: newDuration,
      author: newProName,
      authorAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
      image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1000&q=80',
      description: newDescription || 'Nouveau projet réalisé avec succès et conformité aux règles professionnelles.',
      services: [newCategory, 'Métré Pro', 'Finitions'],
      budget: 'Sur devis',
      status: 'Terminé'
    } as any;

    // Phase 1 — persist to the server through the existing endpoint. Never
    // blocks the publish action: the local update below happens either way,
    // and App falls back to localStorage when offline/unauthenticated.
    if (onSaveProject) {
      try {
        void onSaveProject(newProj);
      } catch (e) {
        // non-blocking: a failed sync must never break publishing
      }
    }

    if (onUpdateProjects) {
      try {
        onUpdateProjects([newProj, ...(projects || [])]);
      } catch (e) {
        // fallback for dev: mutate showcaseProjects
        showcaseProjects.unshift(newProj);
      }
    } else {
      // dev fallback
      showcaseProjects.unshift(newProj);
    }

    setShowPublishModal(false);
    setNewTitle('');
    setNewDescription('');
  };

  return (
    <div className="space-y-12 pb-12">
      
      {/* 1. HERO SECTION (Matching projets.jpg 1:1) */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-[#0b0f17] shadow-2xl p-6 sm:p-12 lg:p-14">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          {/* Left Content */}
          <div className="lg:col-span-7 space-y-6">
            <div className="text-xs font-bold text-amber-400 uppercase tracking-widest">
              NOS PROJETS
            </div>

            <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-[1.15]">
              Des projets qui <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-200">donnent vie aux idées.</span>
            </h1>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
              Découvrez des réalisations dans le bâtiment, la rénovation, l'aménagement intérieur et la décoration. Inspirez-vous de projets réalisés par des professionnels de la plateforme.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                onClick={() => setShowPublishModal(true)}
                className="px-6 py-3.5 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-sm rounded-2xl shadow-lg shadow-amber-500/25 transition-all flex items-center gap-2 cursor-pointer"
              >
                <span>Publier un projet</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={() => onNavigate && onNavigate('directory_market')}
                className="px-6 py-3.5 bg-transparent hover:bg-slate-800 text-white font-bold text-sm rounded-2xl border border-slate-700 hover:border-slate-500 transition-all flex items-center gap-2 cursor-pointer"
              >
                <span>Trouver un professionnel</span>
                <ArrowRight className="w-4 h-4 text-slate-400" />
              </button>
            </div>
          </div>

          {/* Right Image */}
          <div className="lg:col-span-5 relative">
            <div className="relative rounded-3xl overflow-hidden border border-slate-700 shadow-2xl h-72 sm:h-80">
              <img
                src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1000&q=80"
                alt="Architecture moderne"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0b0f17] via-transparent to-transparent" />
            </div>
          </div>

        </div>
      </section>

      {/* 2. DÉCOUVREZ NOS RÉALISATIONS (Search & Filters Bar from screenshot) */}
      <section className="bg-[#131b2e] border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6">
        <h2 className="text-xl sm:text-2xl font-bold text-white">Découvrez nos réalisations</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          
          {/* Search Input */}
          <div className="space-y-1.5 lg:col-span-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher un projet..."
              className="w-full bg-[#0b0f17] border border-slate-700 rounded-2xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* Catégories Dropdown */}
          <div className="space-y-1.5">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full bg-[#0b0f17] border border-slate-700 rounded-2xl px-4 py-3 text-xs text-white focus:outline-none focus:border-amber-400"
            >
              <option value="all">Toutes les catégories</option>
              <option value="Construction">Construction</option>
              <option value="Rénovation">Rénovation</option>
              <option value="Faux plafond">Faux plafond</option>
              <option value="Décoration">Décoration</option>
              <option value="Isolation">Isolation</option>
              <option value="Aménagement">Aménagement</option>
            </select>
          </div>

          {/* Régions Dropdown */}
          <div className="space-y-1.5">
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="w-full bg-[#0b0f17] border border-slate-700 rounded-2xl px-4 py-3 text-xs text-white focus:outline-none focus:border-amber-400"
            >
              <option value="all">Toutes les régions</option>
              <option value="Tunis">Tunis</option>
              <option value="Ariana">Ariana</option>
              <option value="Sousse">Sousse</option>
              <option value="Sfax">Sfax</option>
              <option value="Nabeul">Nabeul</option>
              <option value="Bizerte">Bizerte</option>
            </select>
          </div>

          {/* Rechercher Button */}
          <div className="flex items-center">
            <button
              onClick={() => {}}
              className="w-full py-3 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-xs rounded-2xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Rechercher</span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>

        </div>
      </section>

      {/* Public demo projects and their demo statistics removed (display-only). */}

      {/* 6. BOTTOM CTA: Un projet vous inspire ? */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        <div className="bg-[#131b2e] border border-slate-800 rounded-3xl p-8 space-y-4 flex flex-col justify-between">
          <div className="space-y-2">
            <h3 className="text-xl sm:text-2xl font-bold text-white">
              Un projet vous inspire ? Trouvez le professionnel qu'il vous faut.
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Trouvez vos professionnels, communiquez sereinement et recevez vos devis avec KONSTRIVO.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={() => onNavigate && onNavigate('directory_market')}
              className="px-5 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2 cursor-pointer"
            >
              <span>Trouver un professionnel</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => onNavigate && onNavigate('devis')}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl border border-slate-700 transition-all cursor-pointer"
            >
              <span>Demander un devis</span>
            </button>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-[#0b0f17] p-8 space-y-4 flex flex-col justify-between">
          <div 
            className="absolute inset-0 bg-cover bg-center opacity-20"
            style={{ backgroundImage: `url('https://images.unsplash.com/photo-1541888946425-d0fbb180c5f7?auto=format&fit=crop&w=800&q=80')` }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0b0f17] to-transparent" />

          <div className="relative z-10 space-y-2">
            <h3 className="text-xl sm:text-2xl font-bold text-white">
              Vous avez réalisé un projet ?
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Partagez votre savoir-faire, développez votre activité et trouvez de nouvelles opportunités avec KONSTRIVO.
            </p>
          </div>

          <div className="relative z-10 flex flex-wrap gap-3 pt-2">
            <button
              onClick={() => setShowPublishModal(true)}
              className="px-5 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2 cursor-pointer"
            >
              <span>Publier mon projet</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => onNavigate && onNavigate('directory_market')}
              className="px-5 py-2.5 bg-[#131b2e] hover:bg-slate-800 text-white font-bold text-xs rounded-xl border border-slate-700 transition-all cursor-pointer"
            >
              <span>Créer mon profil professionnel</span>
            </button>
          </div>
        </div>

      </section>

      {/* MODAL: Project Details */}
      {selectedModalProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#131b2e] border border-slate-700 rounded-3xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 sm:p-8 space-y-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <span className="px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-full text-xs font-bold">
                  {selectedModalProject.category}
                </span>
                <h2 className="text-2xl font-bold text-white mt-2">{selectedModalProject.title}</h2>
                <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-1">
                  <MapPin className="w-3.5 h-3.5 text-amber-400" />
                  <span>{selectedModalProject.location}</span>
                </p>
              </div>
              <button 
                onClick={() => setSelectedModalProject(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="rounded-2xl overflow-hidden h-72 border border-slate-800">
              <img
                src={selectedModalProject.image}
                alt={selectedModalProject.title}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#0b0f17] p-4 rounded-2xl border border-slate-800 text-xs">
              <div>
                <span className="text-slate-500 block text-[11px]">Surface</span>
                <span className="text-white font-bold">{selectedModalProject.surface}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Durée</span>
                <span className="text-white font-bold">{selectedModalProject.duration}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Budget</span>
                <span className="text-amber-400 font-bold">{selectedModalProject.budget}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Statut</span>
                <span className="text-emerald-400 font-bold">{selectedModalProject.status}</span>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-bold text-white">Description du projet</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {selectedModalProject.description}
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                onClick={() => setSelectedModalProject(null)}
                className="px-5 py-2.5 bg-slate-900 text-slate-300 rounded-xl text-xs font-bold"
              >
                Fermer
              </button>
              <button
                onClick={() => {
                  setSelectedModalProject(null);
                  if (onNavigate) onNavigate('devis');
                }}
                className="px-5 py-2.5 bg-amber-500 text-slate-950 rounded-xl text-xs font-bold"
              >
                Demander un devis similaire
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Publier un projet */}
      {showPublishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#131b2e] border border-slate-700 rounded-3xl w-full max-w-xl p-6 sm:p-8 space-y-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-amber-400" />
                <span>Publier un nouveau projet</span>
              </h2>
              <button onClick={() => setShowPublishModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePublishProject} className="space-y-4">
              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">Titre du projet</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Ex: Faux plafond LED salon villa"
                  className="w-full bg-[#0b0f17] border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">Catégorie</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full bg-[#0b0f17] border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white"
                  >
                    <option value="Placo & Plâtre">Placo & Plâtre</option>
                    <option value="Faux plafond">Faux plafond</option>
                    <option value="Cloison">Cloison</option>
                    <option value="Isolation">Isolation</option>
                    <option value="Rénovation">Rénovation</option>
                    <option value="Construction">Construction</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">Région</label>
                  <select
                    value={newRegion}
                    onChange={(e) => setNewRegion(e.target.value)}
                    className="w-full bg-[#0b0f17] border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white"
                  >
                    <option value="Tunis">Tunis</option>
                    <option value="Ariana">Ariana</option>
                    <option value="Sousse">Sousse</option>
                    <option value="Sfax">Sfax</option>
                    <option value="Nabeul">Nabeul</option>
                    <option value="Bizerte">Bizerte</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">Surface (m²)</label>
                  <input
                    type="number"
                    value={newSurface}
                    onChange={(e) => setNewSurface(Number(e.target.value))}
                    className="w-full bg-[#0b0f17] border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">Durée des travaux</label>
                  <input
                    type="text"
                    value={newDuration}
                    onChange={(e) => setNewDuration(e.target.value)}
                    placeholder="Ex: 3 semaines"
                    className="w-full bg-[#0b0f17] border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">Nom du professionnel / Entreprise</label>
                <input
                  type="text"
                  value={newProName}
                  onChange={(e) => setNewProName(e.target.value)}
                  className="w-full bg-[#0b0f17] border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">Description</label>
                <textarea
                  rows={3}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Détails techniques, matériaux utilisés, spécificités..."
                  className="w-full bg-[#0b0f17] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowPublishModal(false)}
                  className="px-4 py-2 bg-slate-900 text-slate-300 rounded-xl text-xs font-bold"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-amber-500 text-slate-950 font-bold rounded-xl text-xs shadow-lg shadow-amber-500/20"
                >
                  Publier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
