import React, { useState } from 'react';
import { Shield, Lock, Eye, EyeOff, CheckCircle2, AlertTriangle, KeyRound, ArrowRight } from 'lucide-react';
import { resetPassword } from '../lib/api';

/**
 * AUTH PHASE 2A — STEP 5 — Reset Password page (/reset-password?token=...)
 *
 * Security posture:
 *  - The one-time reset token is read ONCE from the URL query string and kept
 *    in React state (module memory) only. It is NEVER written to
 *    localStorage / sessionStorage / cookies, never logged, never rendered in
 *    the UI, never included in an error message and never sent anywhere except
 *    POST /api/v1/auth/reset.
 *  - After a successful reset the token is stripped from the address bar
 *    (history.replaceState) and cleared from memory.
 *  - All API failures are mapped to fixed French messages — raw payloads,
 *    request URLs and stack traces are never surfaced.
 */

// ── Pure helpers (exported for the test suite) ─────────────────────────────

/** Extract the one-time reset token from a URL query string ('' when absent). */
export function extractResetToken(search: string): string {
  try {
    const params = new URLSearchParams(search || '');
    return (params.get('token') || '').trim();
  } catch {
    return '';
  }
}

/**
 * Client-side validation mirroring the AuthModal rules and the backend policy
 * (minimum 8 characters + matching confirmation). Returns a French error
 * message, or null when the form is valid. No request is sent when invalid.
 */
export function validateResetPassword(password: string, confirmPassword: string): string | null {
  if (!password) return 'Veuillez saisir un nouveau mot de passe.';
  if (password.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.';
  if (!confirmPassword) return 'Veuillez confirmer le nouveau mot de passe.';
  if (password !== confirmPassword) return 'Les mots de passe ne correspondent pas.';
  return null;
}

/**
 * Map an API failure to a safe, fixed French message. The backend returns a
 * single generic 400 for invalid / expired / already-used tokens (by design —
 * no token enumeration), so one message covers those cases. Raw API payloads
 * are NEVER echoed: they could contain sensitive data, and the request URL
 * contains the one-time token.
 */
export function mapResetError(status: number | undefined, _apiMessage?: string): string {
  if (status === 400) return 'Ce lien de réinitialisation est invalide ou a expiré. Veuillez demander un nouveau lien.';
  if (status === 422) return 'Le mot de passe doit contenir au moins 8 caractères.';
  return 'Une erreur est survenue. Veuillez réessayer.';
}

// ── Presentational view (SSR-testable, no window access) ───────────────────

export interface ResetPasswordViewProps {
  hasToken?: boolean;
  password?: string;
  confirmPassword?: string;
  showPassword?: boolean;
  showConfirm?: boolean;
  submitting?: boolean;
  fieldError?: string;
  apiError?: string;
  success?: boolean;
  onPasswordChange?: (value: string) => void;
  onConfirmChange?: (value: string) => void;
  onTogglePassword?: () => void;
  onToggleConfirm?: () => void;
  onSubmit?: (e: React.FormEvent) => void;
  onGoToLogin?: () => void;
  onGoHome?: () => void;
}

export const ResetPasswordView: React.FC<ResetPasswordViewProps> = ({
  hasToken = true,
  password = '',
  confirmPassword = '',
  showPassword = false,
  showConfirm = false,
  submitting = false,
  fieldError = '',
  apiError = '',
  success = false,
  onPasswordChange = (_value: string) => {},
  onConfirmChange = (_value: string) => {},
  onTogglePassword = () => {},
  onToggleConfirm = () => {},
  onSubmit = () => {},
  onGoToLogin = () => {},
  onGoHome = () => {},
}) => {
  // ── Case 1: no token in the URL → invalid link, never call the API ────────
  if (!hasToken) {
    return (
      <div className="min-h-screen w-full bg-[#0b0f17] text-slate-100 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-[#0b0f17] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/40 p-5 border-b border-slate-800 flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">KONSTRIVO — Espace Sécurisé</h3>
              <p className="text-xs text-slate-400">Réinitialisation du mot de passe</p>
            </div>
          </div>
          <div className="p-6 space-y-5">
            <div className="p-4 bg-red-950/60 border border-red-500/50 rounded-xl flex items-start gap-3 text-red-300" role="alert">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-400 mt-0.5" />
              <div>
                <span className="text-sm font-semibold block">Lien de réinitialisation invalide</span>
                <span className="text-xs text-red-300/80">
                  Ce lien est incomplet. Veuillez demander un nouveau lien de réinitialisation.
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-400">
              Le lien de réinitialisation doit être ouvert depuis l'e-mail qui vous a été envoyé. Si vous n'avez
              rien reçu, vous pouvez demander un nouveau lien depuis la page de connexion.
            </p>
            <button
              type="button"
              onClick={onGoHome}
              className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              Demander un nouveau lien
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Case 2: success → message + redirect to the existing login ────────────
  if (success) {
    return (
      <div className="min-h-screen w-full bg-[#0b0f17] text-slate-100 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-[#0b0f17] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/40 p-5 border-b border-slate-800 flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">KONSTRIVO — Espace Sécurisé</h3>
              <p className="text-xs text-slate-400">Réinitialisation du mot de passe</p>
            </div>
          </div>
          <div className="p-6 space-y-5">
            <div className="p-4 bg-emerald-950/60 border border-emerald-500/50 rounded-xl flex items-start gap-3 text-emerald-300" role="status">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400 mt-0.5" />
              <span className="text-sm font-semibold">
                Votre mot de passe a été réinitialisé avec succès.
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Vous pouvez dès à présent vous connecter avec votre nouveau mot de passe.
            </p>
            <button
              type="button"
              onClick={onGoToLogin}
              className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              Se connecter
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Case 3: reset form ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-full bg-[#0b0f17] text-slate-100 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-[#0b0f17] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/40 p-5 border-b border-slate-800 flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Réinitialiser votre mot de passe</h3>
            <p className="text-xs text-slate-400">
              Choisissez un nouveau mot de passe pour sécuriser votre compte KONSTRIVO.
            </p>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {apiError && (
            <div className="p-4 bg-red-950/60 border border-red-500/50 rounded-xl flex items-start gap-3 text-red-300" role="alert">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-400 mt-0.5" />
              <span className="text-sm font-semibold">{apiError}</span>
            </div>
          )}

          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <div>
              <label htmlFor="reset-new-password" className="block text-xs font-medium text-slate-300 mb-1">
                Nouveau mot de passe
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  id="reset-new-password"
                  name="new-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoFocus
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => onPasswordChange(e.target.value)}
                  placeholder="••••••••••••"
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? 'reset-field-error' : undefined}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-12 py-2.5 text-sm text-white focus:border-amber-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={onTogglePassword}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200"
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="reset-confirm-password" className="block text-xs font-medium text-slate-300 mb-1">
                Confirmer le nouveau mot de passe
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  id="reset-confirm-password"
                  name="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => onConfirmChange(e.target.value)}
                  placeholder="••••••••••••"
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? 'reset-field-error' : undefined}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-12 py-2.5 text-sm text-white focus:border-amber-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={onToggleConfirm}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200"
                  aria-label={showConfirm ? 'Masquer la confirmation' : 'Afficher la confirmation'}
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {fieldError && (
                <p id="reset-field-error" role="alert" className="text-xs text-red-400 mt-1.5">
                  {fieldError}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
              className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:from-amber-500 disabled:hover:to-amber-600"
            >
              <KeyRound className="w-4 h-4" />
              {submitting ? 'Réinitialisation en cours…' : 'Réinitialiser le mot de passe'}
            </button>
          </form>

          <p className="text-[11px] text-slate-500 text-center">
            Ce lien est valable pendant 1 heure et ne peut être utilisé qu'une seule fois.
          </p>
        </div>
      </div>
    </div>
  );
};

// ── Stateful page (token lives here, in memory only) ────────────────────────

export const ResetPasswordPage: React.FC = () => {
  // The one-time token is read ONCE from the URL into React state. It is never
  // persisted (no localStorage / sessionStorage / cookies), never logged and
  // never rendered — it is only sent to POST /api/v1/auth/reset.
  const [token, setToken] = useState<string>(() => extractResetToken(
    typeof window !== 'undefined' ? window.location.search : '',
  ));
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [apiError, setApiError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleGoToLogin = () => {
    // Back to the app home; App opens the EXISTING login modal (AuthModal)
    // when ?connexion=1 is present. The token is never part of any URL.
    try { window.location.replace('/?connexion=1'); } catch { window.location.href = '/?connexion=1'; }
  };

  const handleGoHome = () => {
    try { window.location.replace('/'); } catch { window.location.href = '/'; }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Double-submit guard + never call the API without a token.
    if (submitting || !token) return;

    setApiError('');
    const validationError = validateResetPassword(password, confirmPassword);
    if (validationError) {
      // No request is sent when client-side validation fails.
      setFieldError(validationError);
      return;
    }
    setFieldError('');

    setSubmitting(true);
    try {
      await resetPassword(token, password);
      setSuccess(true);
      // Strip the one-time token from the address bar AFTER a successful reset
      // (history-only rewrite — no reload, nothing sent anywhere).
      try { window.history.replaceState(null, '', '/reset-password'); } catch { /* ignore */ }
      setToken(''); // the token has been consumed — clear it from memory
    } catch (err: any) {
      // Only fixed, safe French messages are shown — never raw payloads,
      // request URLs (which contain the token) or stack traces.
      setApiError(mapResetError(err?.status, err?.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ResetPasswordView
      hasToken={Boolean(token)}
      password={password}
      confirmPassword={confirmPassword}
      showPassword={showPassword}
      showConfirm={showConfirm}
      submitting={submitting}
      fieldError={fieldError}
      apiError={apiError}
      success={success}
      onPasswordChange={setPassword}
      onConfirmChange={setConfirmPassword}
      onTogglePassword={() => setShowPassword(!showPassword)}
      onToggleConfirm={() => setShowConfirm(!showConfirm)}
      onSubmit={handleSubmit}
      onGoToLogin={handleGoToLogin}
      onGoHome={handleGoHome}
    />
  );
};