import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Human-readable section name surfaced in logs + the fallback card. */
  sectionName?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Minimal instance surface we rely on. The project compiles against React 19's
 * bundled type declarations (no @types/react installed), whose legacy class
 * typing is incomplete here — so `this.props`/`this.setState` are accessed
 * through these typed views instead of assuming base-class members. At RUNTIME
 * the real React.Component provides both, exactly as always.
 */
interface BoundaryInstance {
  props?: ErrorBoundaryProps;
  setState(state: ErrorBoundaryState): void;
}

/**
 * Root crash guard (Website fix — "blank blue screen").
 *
 * Previously ANY render-time exception inside a tab unmounted the whole React
 * tree (no boundary existed anywhere) and left only the dark background —
 * the reported blank blue screen. This boundary contains the crash to a
 * visible fallback card with a recovery action instead.
 *
 * It changes NO business logic: when children render cleanly they appear
 * exactly as before. Calculator formulas and feature gating are untouched.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const instance = this as unknown as BoundaryInstance;
    // Keep production issues diagnosable (section name + stack).
    console.error(
      `[KONSTRIVO] UI crash in "${instance.props?.sectionName ?? 'app'}":`,
      error,
      info?.componentStack,
    );
  }

  private handleRetry = (): void => {
    (this as unknown as BoundaryInstance).setState({ error: null });
  };

  render(): ReactNode {
    const instance = this as unknown as BoundaryInstance;
    if (!this.state.error) return instance.props?.children ?? null;
    return (
      <div className="min-h-[50vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-slate-900/80 border border-amber-500/30 rounded-2xl p-6 text-center space-y-3">
          <div className="text-3xl">⚠️</div>
          <h2 className="text-amber-400 font-bold text-sm">Section indisponible</h2>
          <p className="text-slate-400 text-xs leading-relaxed">
            Une erreur est survenue dans « {instance.props?.sectionName ?? 'cette section'} ».
            Vos données locales sont intactes — réessayez ou rechargez la page.
          </p>
          <div className="flex gap-2 justify-center pt-1">
            <button
              onClick={this.handleRetry}
              className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 transition-colors cursor-pointer"
            >
              Réessayer
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold border border-slate-700 hover:bg-slate-700 transition-colors cursor-pointer"
            >
              Recharger
            </button>
          </div>
        </div>
      </div>
    );
  }
}
