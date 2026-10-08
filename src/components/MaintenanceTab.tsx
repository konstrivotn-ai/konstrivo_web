import React, { useState } from 'react';
import { 
  Wrench, AlertTriangle, Clock, CheckCircle2, Phone, Share2, 
  MapPin, Shield, Plus, X, Search, Filter, Sparkles, User, Droplet, Zap, Hammer
} from 'lucide-react';
import { MaintenanceTicket, UrgentServiceType, TradeCategory, Language, CountryCode, CurrencyCode } from '../types';
import { getCurrencyMeta, formatPrice } from '../data/countryConfig';
import { openWhatsApp } from '../utils/whatsapp';

interface MaintenanceTabProps {
  tickets: MaintenanceTicket[];
  onUpdateTickets: (tickets: MaintenanceTicket[]) => void;
  lang: Language;
  country: CountryCode;
  currency: CurrencyCode;
}

export const MaintenanceTab: React.FC<MaintenanceTabProps> = ({
  tickets,
  onUpdateTickets,
  lang,
  country,
  currency
}) => {
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [selectedService, setSelectedService] = useState<UrgentServiceType>('fuite_eau');
  const [urgencyLevel, setUrgencyLevel] = useState<'urgence_extreme_2h' | 'urgent_24h' | 'normal_48h'>('urgent_24h');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [description, setDescription] = useState('');

  const currMeta = getCurrencyMeta(currency);

  const urgentServicesList = [
    { id: 'fuite_eau', label: 'Fuite d’Eau & Sanitaire', icon: Droplet, trade: 'plomberie', defaultEst: 110, desc: 'Tuyau percé, siphon qui fuit, robinetterie' },
    { id: 'court_circuit', label: 'Court-Circuit & Panne Élec', icon: Zap, trade: 'electricite', defaultEst: 95, desc: 'Disjoncteur saute, tableau, prise brûlée' },
    { id: 'fissure_placo', label: 'Fissure Plafond / Placo', icon: Hammer, trade: 'placo', defaultEst: 130, desc: 'Joint fendu, plaque décollée, retouche' },
    { id: 'infiltration_toit', label: 'Infiltration Toiture / Terrasse', icon: Shield, trade: 'etancheite', defaultEst: 180, desc: 'Goutte à goutte, étanchéité membrane' },
    { id: 'climatisation_panne', label: 'Panne Climatiseur / Split', icon: Wrench, trade: 'electricite', defaultEst: 85, desc: 'Manque de gaz, fuite split intérieur' },
    { id: 'serrure_bloquee', label: 'Serrure & Porte Bloquée', icon: Wrench, trade: 'menuiserie', defaultEst: 75, desc: 'Cylindre bloqué, porte claquée' }
  ];

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || !clientName.trim() || !clientPhone.trim()) return;

    const matchedService = urgentServicesList.find(s => s.id === selectedService);
    const est = (matchedService?.defaultEst || 100) * (urgencyLevel === 'urgence_extreme_2h' ? 1.4 : urgencyLevel === 'urgent_24h' ? 1.15 : 1.0);

    const newTicket: MaintenanceTicket = {
      id: `tkt_${Date.now()}`,
      ticketCode: `URG-2026-${Math.floor(100 + Math.random() * 900)}`,
      title: `${matchedService?.label || 'Dépannage'} - ${clientAddress.slice(0, 25) || 'Tunis'}`,
      serviceType: selectedService,
      trade: (matchedService?.trade as TradeCategory) || 'plomberie',
      urgency: urgencyLevel,
      clientName: clientName.trim(),
      clientPhone: clientPhone.trim(),
      clientAddress: clientAddress.trim() || 'Tunisie',
      region: 'Tunis Grand',
      status: 'signalé',
      description: description.trim(),
      estimatedPrice: Math.round(est),
      createdAt: `${new Date().toISOString().split('T')[0]} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    };

    onUpdateTickets([newTicket, ...tickets]);
    setShowNewTicketModal(false);

    // Reset Form
    setDescription('');
    setClientName('');
    setClientPhone('');
    setClientAddress('');
  };

  const handleAdvanceStatus = (ticketId: string) => {
    const updated = tickets.map(t => {
      if (t.id === ticketId) {
        let nextStatus: MaintenanceTicket['status'] = t.status;
        if (t.status === 'signalé') nextStatus = 'artisan_assigné';
        else if (t.status === 'artisan_assigné') nextStatus = 'en_route';
        else if (t.status === 'en_route') nextStatus = 'en_intervention';
        else if (t.status === 'en_intervention') nextStatus = 'clôturé';
        return { ...t, status: nextStatus };
      }
      return t;
    });
    onUpdateTickets(updated);
  };

  const handleWhatsAppTicket = (ticket: MaintenanceTicket) => {
    const text = `*🚨 INTERVENTION TECHNIQUE URGENTE - KONSTRIVO PRO 2026*\n\n` +
      `📌 *Ticket:* ${ticket.ticketCode} (${ticket.urgency.toUpperCase()})\n` +
      `🛠️ *Prestation:* ${ticket.title}\n` +
      `👤 *Client:* ${ticket.clientName} (${ticket.clientPhone})\n` +
      `📍 *Adresse:* ${ticket.clientAddress}\n` +
      `💰 *Estimation Tarif:* ${formatPrice(ticket.estimatedPrice, currency, country)}\n` +
      `📝 *Description:* ${ticket.description}\n\n` +
      `_Service dépannage BTP KONSTRIVO_`;
    openWhatsApp(text);
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner Header */}
      <div className="bg-slate-900 rounded-3xl p-5 sm:p-6 border border-slate-800 shadow-xl space-y-4">
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
              <Wrench className="w-5 h-5 text-amber-400" />
              <span>{lang === 'ar' ? 'خدمات الصيانة والتدخل الفني السريع' : 'Services de Maintenance & Dépannage BTP'}</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-mono border border-rose-500/20">
                Intervention 2h / 24h
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              {lang === 'ar' ? 'إصلاح فوري للأعطال الطارئة: سباكة، كهرباء، تشققات جبس، وعزل مائي مع ضمان العمل' : 'Dépannage d’urgence et maintenance sur site pour particuliers, entreprises et chantiers en cours.'}
            </p>
          </div>

          <button
            onClick={() => setShowNewTicketModal(true)}
            className="text-xs font-black px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl shadow-lg shadow-amber-500/20 flex items-center gap-2 transition-all cursor-pointer"
          >
            <AlertTriangle className="w-4 h-4 text-slate-950" />
            <span>Signaler une Urgence</span>
          </button>
        </div>

        {/* 6 Quick Category Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-2">
          {urgentServicesList.map(srv => (
            <div
              key={srv.id}
              onClick={() => {
                setSelectedService(srv.id as any);
                setShowNewTicketModal(true);
              }}
              className="bg-slate-950 p-3 rounded-2xl border border-slate-800 hover:border-amber-500/50 hover:bg-slate-900 transition-all cursor-pointer text-left"
            >
              <srv.icon className="w-4 h-4 text-amber-400 mb-1.5" />
              <div className="text-xs font-bold text-white leading-tight truncate">{srv.label}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Dès {formatPrice(srv.defaultEst, currency, country)}</div>
            </div>
          ))}
        </div>

      </div>

      {/* Tickets List Section */}
      <div className="space-y-4">
        
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black text-slate-300 uppercase tracking-wider">
            Tickets d'Intervention en Cours ({tickets.length})
          </h3>
          <span className="text-[11px] text-slate-500 font-mono">Suivi en Temps Réel 2026</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {tickets.map(tkt => (
            <div
              key={tkt.id}
              className="bg-slate-900 rounded-3xl p-5 border border-slate-800 flex flex-col justify-between space-y-4 shadow-xl hover:border-slate-700 transition-all"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                    {tkt.ticketCode}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                    tkt.urgency === 'urgence_extreme_2h'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                      : tkt.urgency === 'urgent_24h'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                  }`}>
                    {tkt.urgency === 'urgence_extreme_2h' ? '⚡ Urgence 2h' : tkt.urgency === 'urgent_24h' ? 'Urgent 24h' : 'Standard 48h'}
                  </span>
                </div>

                <h4 className="text-sm font-black text-white leading-snug mb-1">{tkt.title}</h4>
                <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed mb-3">
                  {tkt.description}
                </p>

                <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-1.5 text-xs">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Client :</span>
                    <span className="text-white font-bold">{tkt.clientName}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Contact :</span>
                    <span className="text-white font-mono">{tkt.clientPhone}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Lieu :</span>
                    <span className="text-white truncate max-w-[180px]">{tkt.clientAddress}</span>
                  </div>
                  <div className="flex justify-between items-center pt-1 border-t border-slate-900">
                    <span className="text-slate-400">Tarif Estimé :</span>
                    <span className="text-base font-black text-amber-400 font-mono">
                      {formatPrice(tkt.estimatedPrice, currency, country)}
                    </span>
                  </div>
                </div>

                {/* Status Badge & Progression */}
                <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                  <div className="text-xs">
                    <span className="text-slate-500 text-[10px] block">Statut Actuel :</span>
                    <span className={`font-bold capitalize text-xs ${
                      tkt.status === 'clôturé' ? 'text-emerald-400' : 'text-amber-400'
                    }`}>
                      {tkt.status.replace('_', ' ')}
                    </span>
                  </div>

                  {tkt.status !== 'clôturé' && (
                    <button
                      onClick={() => handleAdvanceStatus(tkt.id)}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                    >
                      Étape Suivante ➔
                    </button>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                <a
                  href={`tel:${tkt.clientPhone}`}
                  className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 text-center transition-all"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Appeler</span>
                </a>

                <button
                  onClick={() => handleWhatsAppTicket(tkt)}
                  className="py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md shadow-emerald-500/20"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>WhatsApp</span>
                </button>
              </div>
            </div>
          ))}
        </div>

      </div>

      {/* NEW TICKET MODAL */}
      {showNewTicketModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-lg w-full space-y-5 shadow-2xl animate-in fade-in zoom-in-95">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                <span>Signaler une Panne / Demande d'Intervention</span>
              </h3>
              <button
                onClick={() => setShowNewTicketModal(false)}
                className="p-1 rounded-xl bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTicket} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-300 mb-1 block">Type de Panne :</label>
                <select
                  value={selectedService}
                  onChange={(e) => setSelectedService(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold cursor-pointer"
                >
                  {urgentServicesList.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 mb-1 block">Niveau d'Urgence :</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'urgence_extreme_2h', label: '⚡ 2 Heures', color: 'border-rose-500 text-rose-400' },
                    { id: 'urgent_24h', label: '24 Heures', color: 'border-amber-500 text-amber-400' },
                    { id: 'normal_48h', label: '48 Heures', color: 'border-blue-500 text-blue-400' }
                  ].map(u => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setUrgencyLevel(u.id as any)}
                      className={`p-2 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                        urgencyLevel === u.id
                          ? 'bg-slate-950 font-black shadow-md ' + u.color
                          : 'bg-slate-950/40 border-slate-800 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {u.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-300 mb-1 block">Nom du Client :</label>
                  <input
                    type="text"
                    required
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Ex: Mme. Salma"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-300 mb-1 block">Téléphone Portable :</label>
                  <input
                    type="text"
                    required
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="Ex: +216 98 123 456"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 mb-1 block">Adresse & Ville :</label>
                <input
                  type="text"
                  required
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                  placeholder="Ex: Résidence Les Roses, Ennasr 2, Ariana"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 mb-1 block">Description du Problème :</label>
                <textarea
                  rows={3}
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Décrivez précisément la fuite, l'infiltration ou la fissure constatée..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewTicketModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-amber-500/20 cursor-pointer"
                >
                  Envoyer la Demande
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
};
