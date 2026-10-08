import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ResetPasswordPage } from './components/ResetPasswordPage.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Minimal path-based routing (this project intentionally has no router
// library). The password-reset email links to /reset-password?token=... and
// the Express server serves the SPA for every path, so we render the
// standalone Reset Password page for that route instead of the full app.
const isResetPasswordRoute =
  typeof window !== 'undefined' && window.location.pathname === '/reset-password';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Root crash guard: a render exception must never leave a blank page. */}
    <ErrorBoundary sectionName="app">
      {isResetPasswordRoute ? <ResetPasswordPage /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
);
