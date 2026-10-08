import React, { useState } from 'react';
import { Mail, Phone, MapPin, Send, MessageSquare, CheckCircle2, Clock, ShieldCheck, Building2, Sparkles, User, AlertCircle } from 'lucide-react';
import { Language } from '../types';

interface ContactTabProps {
  lang: Language;
}

export const ContactTab: React.FC<ContactTabProps> = ({ lang }) => {
  const isAr = lang === 'ar' || lang === 'ar';

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    subject: 'support_technique',
    message: '',
    role: 'artisan'
  });

  const [submitted, setSubmitted] = useState(false);

  // The detailed office list has been removed from this component to avoid
  // presenting unverified contact locations. The page preserves the layout
  // and provides official contact channels (WhatsApp + email) only.

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      setFormData({
        name: '',
        email: '',
        phone: '',
        subject: 'support_technique',
        message: '',
        role: 'artisan'
      });
    }, 3500);
  };

  const handleOpenWhatsApp = () => {
    const text = encodeURIComponent("Bonjour KONSTRIVO BTP, je souhaite obtenir des informations techniques ou un partenariat pour mon entreprise.");
    window.open(`https://wa.me/21650772371?text=${text}`, '_blank');
  };

  return (
    <div className="space-y-10 pb-8">
      
      {/* Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/40 border border-slate-800 p-8 sm:p-12 shadow-2xl">
        <div className="max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold uppercase tracking-wider">
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Support & Assistance Client 2026</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Contactez les Ingénieurs & Experts Techniques KONSTRIVO
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
            Une question sur un calcul de métré, une intégration de barème fournisseur ou un problème sur votre chantier ? Notre équipe vous répond pendant les heures ouvrables.
          </p>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={handleOpenWhatsApp}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Assistance Directe WhatsApp : +216 50 772 371</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Grid: Form + Office Locations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Contact Form */}
        <div className="lg:col-span-7 bg-slate-900/60 border border-slate-800 p-6 sm:p-8 rounded-2xl shadow-xl space-y-6">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Send className="w-5 h-5 text-amber-400" />
              Formulaire de Contact Professionnel
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Remplissez les informations ci-dessous pour être mis en relation avec un chargé d'affaires BTP
            </p>
          </div>

          {submitted && (
            <div className="p-4 bg-emerald-950/80 border border-emerald-500/50 rounded-xl flex items-center gap-3 text-emerald-300">
              <CheckCircle2 className="w-6 h-6 flex-shrink-0" />
              <div>
                <h4 className="text-sm font-bold">Message envoyé avec succès !</h4>
                <p className="text-xs text-emerald-400/80">
                  Un ingénieur d'affaires KONSTRIVO prendra contact avec vous dans les plus brefs délais.
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Nom & Prénom / Société *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: Mohamed Trabelsi (Placo Carthage)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Téléphone Portable *</label>
                <input
                  type="tel"
                  required
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+216 98 123 456"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Adresse Email *</label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="contact@exemple.tn"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Votre Profil Métier</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none"
                >
                  <option value="artisan">Artisan / Plaquiste / Entrepreneur</option>
                  <option value="fournisseur">Fournisseur / Quincaillerie</option>
                  <option value="ingenieur">Bureau d'études / Ingénieur / Architecte</option>
                  <option value="particulier">Particulier (Projet de construction/rénovation)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Objet de votre demande</label>
              <select
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none"
              >
                <option value="support_technique">Support technique sur les calculs & métrés</option>
                <option value="partenariat_fournisseur">Partenariat Fournisseur & Synchronisation Tarifs</option>
                <option value="demande_devis_gros_oeuvre">Demande de devis & étude personnalisée</option>
                <option value="formation_logiciel">Formation & Déploiement Entreprise</option>
                <option value="autre">Autre demande</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Votre Message / Détails du Chantier *</label>
              <textarea
                required
                rows={4}
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                placeholder="Décrivez votre besoin technique, dimensions du chantier ou questions..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white focus:border-amber-400 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              <span>Envoyer ma Demande aux Équipes Techniques</span>
            </button>
          </form>
        </div>

        {/* Agency Offices & Hotlines */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-amber-400" />
              Contact & Support
            </h3>
            <span className="text-xs text-emerald-400 font-semibold">Tunisie 2026</span>
          </div>

          <div className="space-y-3">
            <div className="p-5 rounded-2xl border bg-gradient-to-br from-amber-500/10 to-slate-900/60 border-amber-500/30">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold text-white flex items-center gap-1.5">Canaux Officiels</h4>
              </div>

              <p className="text-xs text-slate-300 flex items-start gap-2 mb-2">
                <MapPin className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                <span>Tunisie — Support à distance</span>
              </p>

              <p className="text-xs text-slate-400 flex items-center gap-2 mb-2">
                <Phone className="w-3.5 h-3.5 text-slate-500" />
                <span className="font-mono text-white">WhatsApp : +216 50 772 371</span>
              </p>

              <p className="text-xs text-slate-400 flex items-center gap-2 mb-2">
                <Mail className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-mono text-white">konstrivo.tn@gmail.com</span>
              </p>

              <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                <span>Support via WhatsApp et formulaire — disponibilité en heures ouvrables</span>
              </p>
            </div>
          </div>

          {/* Quick SLA Commitment */}
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl text-xs space-y-2">
            <div className="flex items-center gap-2 text-emerald-400 font-bold">
              <ShieldCheck className="w-4 h-4" />
              <span>Engagement Qualité & Réactivité 2026</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Toutes les demandes de devis et d'assistance technique pour les artisans abonnés reçoivent un accusé de réception instantané et une prise en charge prioritaire.
            </p>
          </div>
        </div>

      </div>

    </div>
  );
};
