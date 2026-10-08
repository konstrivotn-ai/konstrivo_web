import React, { useState, useEffect } from 'react';
import { X, User, Shield, Briefcase, Store, Compass, CheckCircle2, Lock, Mail, Phone, Building, MapPin, Sparkles, LogOut, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { UserProfile, UserRole, Language } from '../types';
import { login, register, forgotPassword } from '../lib/api';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile | null;
  onLogin: (user: UserProfile) => void;
  onLogout: () => void;
  lang: Language;
  onOpenAdminModal?: () => void;
  /** Tab the modal must open on. 'register' lands directly on the EXISTING
   *  "Créer un compte" tab; omitted or 'login' keeps the previous behaviour. */
  initialMode?: 'login' | 'register';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onLogin,
  onLogout,
  lang,
  onOpenAdminModal,
  initialMode
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode ?? 'login');
  const [role, setRole] = useState<UserRole>('artisan');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [region, setRegion] = useState('Grand Tunis');
  const [taxNumber, setTaxNumber] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [authError, setAuthError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // AUTH PHASE 2A — "Mot de passe oublié ?" flow: ask for the email inside this
  // modal and call the existing POST /api/v1/auth/forgot. /reset-password is
  // opened ONLY from an email link carrying ?token=..., never from this modal.
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotNotice, setForgotNotice] = useState('');
  const [forgotError, setForgotError] = useState('');

  // Re-align the active tab whenever the modal is opened, so the header's
  // "S'inscrire" entry point lands on the register tab while login keeps its
  // default. Declared ABOVE the early return below (Rules of Hooks).
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode ?? 'login');
      setShowForgot(false);
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const rolesConfig = [
    {
      id: 'particulier' as UserRole,
      titleFr: 'Particulier / Client',
      titleAr: 'حريف خاص / مالك',
      descFr: 'Estimer mes travaux et trouver des artisans certifiés',
      icon: User,
      color: 'from-blue-500/20 to-blue-600/10 border-blue-500/40 text-blue-400'
    },
    {
      id: 'artisan' as UserRole,
      titleFr: 'Artisan / Entrepreneur',
      titleAr: 'حرفي / مقاول placo & BTP',
      descFr: 'Calculs métrés, gestion chantiers et devis professionnels',
      icon: Briefcase,
      color: 'from-amber-500/20 to-amber-600/10 border-amber-500/40 text-amber-400'
    },
    {
      id: 'fournisseur' as UserRole,
      titleFr: 'Fournisseur / Quincaillerie',
      titleAr: 'مزود مواد بناء / كنكاري',
      descFr: 'Publier catalogues, synchroniser tarifs et gérer stocks',
      icon: Store,
      color: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/40 text-emerald-400'
    },
    {
      id: 'ingenieur' as UserRole,
      titleFr: 'Ingénieur / Bureau d\'études',
      titleAr: 'مهندس معماري / مكتب دراسات',
      descFr: 'Vérification DTU, suivi technique et audits chantiers',
      icon: Compass,
      color: 'from-purple-500/20 to-purple-600/10 border-purple-500/40 text-purple-400'
    }
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    if (mode === 'login') {
      try {
        const profile = await login({ email: email.trim(), password });
        onLogin(profile);
        setSuccessMsg(lang === 'ar' || lang === 'ar' ? 'تم تسجيل الدخول بنجاح!' : 'Connexion réussie !');
        setTimeout(() => {
          setSuccessMsg('');
          onClose();
        }, 700);
      } catch (err: any) {
        setAuthError(err?.message || 'Échec de la connexion. Vérifiez vos identifiants.');
      }
    } else {
      // Register
      try {
        // Client-side validations: password match and minimal policy
        if (password !== confirmPassword) {
          setAuthError("Les mots de passe ne correspondent pas.");
          return;
        }
        if (password.length < 8) {
          setAuthError("Le mot de passe doit contenir au moins 8 caractères.");
          return;
        }

        const profile = await register({
          email: email.trim(),
          password,
          fullName: fullName || email.split('@')[0] || 'Nouveau Professionnel',
          phone: phone || undefined,
          companyName: company || undefined,
          role,
          region,
          matriculeFiscale: taxNumber || undefined,
        });
        onLogin(profile);
        setSuccessMsg(lang === 'ar' || lang === 'ar' ? 'تم إنشاء الحساب بنجاح!' : 'Compte créé avec succès !');
        setTimeout(() => {
          setSuccessMsg('');
          onClose();
        }, 700);
      } catch (err: any) {
        const msg = err?.message || '';
        // Map common backend messages to friendly French messages
        if (msg.includes('An account with this email already exists') || msg.includes('already exists')) {
          setAuthError('Cet e-mail est déjà utilisé.');
        } else if (msg.includes('Password must be at least') || msg.includes('Password must be at least')) {
          setAuthError('Le mot de passe doit contenir au moins 8 caractères.');
        } else if (msg.includes('Invalid email')) {
          setAuthError('Format d\'email invalide.');
        } else {
          setAuthError('Échec de l\'inscription. Problème temporaire, réessayez plus tard.');
        }
      }
    }
  };

  // AUTH PHASE 2A — open the in-modal forgot-password panel (prefilled with
  // the email typed in the login form, if any).
  const openForgot = () => {
    setForgotEmail(email);
    setForgotError('');
    setForgotSent(false);
    setForgotNotice('');
    setShowForgot(true);
  };

  // Submit the forgot-password request to the EXISTING backend endpoint
  // (POST /api/v1/auth/forgot). The answer is generic by design — the UI never
  // reveals whether the account exists.
  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotLoading) return;
    const normalized = forgotEmail.trim();
    setForgotError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setForgotError("Format d'email invalide.");
      return;
    }
    setForgotLoading(true);
    try {
      const notice = await forgotPassword(normalized);
      setForgotNotice(notice);
      setForgotSent(true);
    } catch (err: any) {
      setForgotError(
        err?.status === 400 || err?.status === 422
          ? "Format d'email invalide."
          : 'Une erreur est survenue. Veuillez réessayer.'
      );
    } finally {
      setForgotLoading(false);
    }
  };

  const isUserAdmin = currentUser?.role === 'admin';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-[#0b0f17] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
        
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/40 p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                {isUserAdmin ? 'Espace Administration Général' : currentUser ? 'Espace Professionnel KONSTRIVO' : (mode === 'login' ? 'Connexion Espace BTP' : 'Créer votre compte KONSTRIVO')}
                <span className="px-2 py-0.5 text-[10px] font-black uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full font-mono">
                  Édition 2026
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                {isUserAdmin ? 'Accès au panneau propriétaire et gestion globale' : (mode === 'register' ? 'Choisissez votre profil pour accéder aux fonctionnalités adaptées à votre activité.' : 'Accédez aux calculs métrés, gestion chantiers, tarifs synchronisés et devis certifiés')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6">
          {successMsg && (
            <div className="p-4 bg-emerald-950/60 border border-emerald-500/50 rounded-xl flex items-center gap-3 text-emerald-300">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400" />
              <span className="text-sm font-semibold">{successMsg}</span>
            </div>
          )}

          {authError && (
            <div className="p-4 bg-red-950/60 border border-red-500/50 rounded-xl flex items-center gap-3 text-red-300">
              <Lock className="w-5 h-5 flex-shrink-0 text-red-400" />
              <span className="text-sm font-semibold">{authError}</span>
            </div>
          )}

          {currentUser ? (
            isUserAdmin ? (
              /* ADMIN OWNER SPECIFIC VIEW (SEPARATED FROM ARTISAN PROFILE) */
              <div className="space-y-6">
                <div className="p-6 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950/40 border border-amber-500/40 rounded-2xl space-y-4">
                  <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 font-black text-2xl shadow-lg shadow-amber-500/20 shrink-0">
                        🛡️
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-lg font-black text-white">{currentUser.fullName}</h4>
                          <span className="px-2.5 py-0.5 text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full font-mono flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" /> Owner Admin
                          </span>
                        </div>
                        <p className="text-xs text-amber-400 font-semibold mt-0.5">
                          Compte Administrateur Propriétaire • {currentUser.email}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          Vous êtes connecté en tant qu'administrateur principal de la plateforme KONSTRIVO BTP.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                    <button
                      onClick={() => {
                        onClose();
                        if (onOpenAdminModal) onOpenAdminModal();
                      }}
                      className="w-full sm:flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-amber-500/20 transition-all cursor-pointer flex items-center justify-center gap-2"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>Ouvrir l'Espace Administration Général</span>
                    </button>

                    <button
                      onClick={() => {
                        onLogout();
                        setSuccessMsg('Déconnexion Administrateur effectuée');
                        setTimeout(() => {
                          setSuccessMsg('');
                          onClose();
                        }, 500);
                      }}
                      className="w-full sm:w-auto px-5 py-3 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Déconnexion Admin</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                    <span className="text-[10px] text-slate-400 block uppercase font-bold">Rôle Système</span>
                    <span className="text-xs font-black text-amber-400 font-mono">SUPER_ADMIN</span>
                  </div>
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                    <span className="text-[10px] text-slate-400 block uppercase font-bold">Contrôle Prix</span>
                    <span className="text-xs font-black text-emerald-400 font-mono">Accès Direct</span>
                  </div>
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl col-span-2 sm:col-span-1">
                    <span className="text-[10px] text-slate-400 block uppercase font-bold">Statut Session</span>
                    <span className="text-xs font-black text-sky-400 font-mono">Actif</span>
                  </div>
                </div>
              </div>
            ) : (
              /* STANDARD ARTISAN / USER PROFILE VIEW */
              <div className="space-y-6">
                <div className="p-5 bg-slate-950/70 border border-slate-800 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-slate-950 font-black text-2xl shadow-lg shadow-amber-500/20">
                      {currentUser.fullName.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-lg font-bold text-white">{currentUser.fullName}</h4>
                        {currentUser.isVerified && (
                          <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Certifié 2026
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-amber-400 font-medium capitalize mt-0.5">
                        Rôle: {currentUser.role} • {currentUser.company || 'Indépendant'}
                      </p>
                      <p className="text-xs text-slate-400 mt-1 flex items-center gap-3">
                        <span>📧 {currentUser.email}</span>
                        <span>📞 {currentUser.phone}</span>
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      onLogout();
                      setSuccessMsg('Déconnexion effectuée');
                      setTimeout(() => {
                        setSuccessMsg('');
                        onClose();
                      }, 500);
                    }}
                    className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                  >
                    Se Déconnecter
                  </button>
                </div>

                {/* Quick Profile Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-xl">
                    <span className="text-xs text-slate-400 block">Région active</span>
                    <span className="text-sm font-bold text-white">{currentUser.region}</span>
                  </div>
                  <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-xl">
                    <span className="text-xs text-slate-400 block">Matricule Fiscal</span>
                    <span className="text-sm font-mono text-amber-400">{currentUser.taxNumber || 'Non renseigné'}</span>
                  </div>
                  <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-xl">
                    <span className="text-xs text-slate-400 block">Statut Cloud</span>
                    <span className="text-sm font-bold text-emerald-400">Synchronisé</span>
                  </div>
                  <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-xl">
                    <span className="text-xs text-slate-400 block">Membre depuis</span>
                    <span className="text-sm font-bold text-slate-300">{currentUser.createdAt}</span>
                  </div>
                </div>
              </div>
            )
          ) : (
            /* Login & Register Forms */
            <div>
              {/* Tab Selector */}
              <div className="flex border-b border-slate-800 mb-6">
                <button
                  type="button"
                  onClick={() => { setMode('login'); setShowForgot(false); }}
                  className={`pb-3 px-4 text-sm font-bold border-b-2 transition-all cursor-pointer ${
                    mode === 'login'
                      ? 'border-amber-400 text-amber-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Se Connecter
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('register'); setShowForgot(false); }}
                  className={`pb-3 px-4 text-sm font-bold border-b-2 transition-all cursor-pointer ${
                    mode === 'register'
                      ? 'border-amber-400 text-amber-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Créer un compte
                </button>
              </div>

              {/* Role Selection */}
              {!showForgot && (
              <div className="mb-6">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Choisissez votre Profil Métier
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {rolesConfig.map((r) => {
                    const Icon = r.icon;
                    const isSelected = role === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setRole(r.id)}
                        className={`p-3 text-left rounded-xl border transition-all flex items-start gap-3 cursor-pointer ${
                          isSelected
                            ? `bg-gradient-to-br ${r.color} shadow-lg ring-1 ring-amber-400`
                            : 'bg-slate-950/50 border-slate-800/80 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className={`p-2 rounded-lg ${isSelected ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-xs font-bold block text-white">{r.titleFr}</span>
                          <span className="text-[11px] text-slate-400 leading-tight block mt-0.5">{r.descFr}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              )}

              {/* Form Inputs */}
              {showForgot ? (
                /* AUTH PHASE 2A — Forgot Password panel (asks for the email and
                   calls the existing POST /api/v1/auth/forgot). Reuses the same
                   design language as the login form. */
                <form onSubmit={handleForgotSubmit} noValidate className="space-y-4">
                  <div className="text-center">
                    <h4 className="text-sm font-bold text-white">Mot de passe oublié ?</h4>
                    <p className="text-xs text-slate-400 mt-1">
                      Saisissez votre adresse email et nous vous enverrons un lien de réinitialisation.
                    </p>
                  </div>

                  {forgotError && (
                    <div className="p-4 bg-red-950/60 border border-red-500/50 rounded-xl flex items-center gap-3 text-red-300">
                      <Lock className="w-5 h-5 flex-shrink-0 text-red-400" />
                      <span className="text-sm font-semibold">{forgotError}</span>
                    </div>
                  )}

                  {forgotSent ? (
                    <div className="p-4 bg-emerald-950/60 border border-emerald-500/50 rounded-xl flex items-center gap-3 text-emerald-300">
                      <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400" />
                      <span className="text-sm font-semibold">{forgotNotice}</span>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">Adresse Email</label>
                        <div className="relative">
                          <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                          <input
                            type="email"
                            required
                            value={forgotEmail}
                            onChange={(e) => setForgotEmail(e.target.value)}
                            placeholder="artisan@exemple.tn"
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white focus:border-amber-400 focus:outline-none"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={forgotLoading}
                        aria-busy={forgotLoading}
                        className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <Mail className="w-4 h-4" />
                        {forgotLoading ? 'Envoi en cours…' : 'Envoyer le lien de réinitialisation'}
                      </button>
                    </>
                  )}

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setShowForgot(false)}
                      className="text-xs text-slate-400 hover:text-amber-400 cursor-pointer bg-transparent border-0 p-0"
                    >
                      ← Retour à la connexion
                    </button>
                  </div>
                </form>
              ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'register' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Nom & Prénom</label>
                      <div className="relative">
                        <User className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                        <input
                          type="text"
                          required
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Mohamed Trabelsi"
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white focus:border-amber-400 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Nom Société / Atelier</label>
                      <div className="relative">
                        <Building className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                        <input
                          type="text"
                          value={company}
                          onChange={(e) => setCompany(e.target.value)}
                          placeholder="Placo Déco Carthage"
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white focus:border-amber-400 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Adresse Email</label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="artisan@exemple.tn"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Téléphone / WhatsApp</label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+216 98 000 000"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Mot de passe</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-12 py-2.5 text-sm text-white focus:border-amber-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200"
                      aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {mode === 'login' && (
                    <div className="mt-2 text-right">
                      <button type="button" onClick={openForgot} className="text-xs text-amber-400 hover:text-amber-300 cursor-pointer bg-transparent border-0 p-0">Mot de passe oublié ?</button>
                    </div>
                  )}
                </div>

                {mode === 'register' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Confirmer le mot de passe</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                      <input
                        type={showConfirm ? 'text' : 'password'}
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-12 py-2.5 text-sm text-white focus:border-amber-400 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm(!showConfirm)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200"
                        aria-label={showConfirm ? 'Masquer confirmation' : 'Afficher confirmation'}
                      >
                        {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                {mode === 'register' && (role === 'artisan' || role === 'fournisseur') && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Région Principale</label>
                      <select
                        value={region}
                        onChange={(e) => setRegion(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:border-amber-400 focus:outline-none"
                      >
                        <option value="Grand Tunis">Grand Tunis (Tunis, Ariana, Ben Arous, Manouba)</option>
                        <option value="Sousse / Monastir / Mahdia">Sahel (Sousse, Monastir, Mahdia)</option>
                        <option value="Sfax">Sfax</option>
                        <option value="Nabeul / Cap Bon">Nabeul / Cap Bon</option>
                        <option value="Bizerte">Bizerte</option>
                        <option value="Gabès / Sud">Gabès & Sud Tunisien</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Matricule Fiscal (Optionnel)</label>
                      <input
                        type="text"
                        value={taxNumber}
                        onChange={(e) => setTaxNumber(e.target.value)}
                        placeholder="1234567/A/M/000"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:border-amber-400 focus:outline-none font-mono"
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  {mode === 'login' ? 'Se Connecter' : 'Créer mon compte KONSTRIVO'}
                </button>
              </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
