/**
 * AUTH PHASE 2A — STEP 5 — Reset Password page tests (/reset-password)
 *
 * Uses the existing test harness (tests/run.ts) + react-dom/server for
 * markup-level rendering of the Reset Password view, a stubbed global fetch
 * for API-integration assertions, and source scans for the token-security
 * guarantees. No browser/DOM framework is added (project constraint).
 */
import { test, ok, assertEq, ctx } from './run';

const RESET_MESSAGES = {
  emptyPassword: 'Veuillez saisir un nouveau mot de passe.',
  shortPassword: 'Le mot de passe doit contenir au moins 8 caractères.',
  emptyConfirm: 'Veuillez confirmer le nouveau mot de passe.',
  mismatch: 'Les mots de passe ne correspondent pas.',
  invalidOrExpired: 'Ce lien de réinitialisation est invalide ou a expiré. Veuillez demander un nouveau lien.',
  generic: 'Une erreur est survenue. Veuillez réessayer.',
  success: 'Votre mot de passe a été réinitialisé avec succès.',
  invalidLinkTitle: 'Lien de réinitialisation invalide',
  requestNewLink: 'Demander un nouveau lien',
  formTitle: 'Réinitialiser votre mot de passe',
  labelPassword: 'Nouveau mot de passe',
  labelConfirm: 'Confirmer le nouveau mot de passe',
  loginCta: 'Se connecter',
};

export async function runResetPasswordPageTests() {
  console.log('🖥️ Reset Password Page Tests\n');

  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const page = await import('../src/components/ResetPasswordPage');
  const { extractResetToken, validateResetPassword, mapResetError, ResetPasswordView } = page;

  /** Render the presentational view with the given prop overrides. */
  const renderView = (props: Record<string, any> = {}): string =>
    renderToStaticMarkup(React.createElement(ResetPasswordView, props));

  await test('Test 1: /reset-password?token=test-token -> page appears with the form', async () => {
    // The standalone test server exposes only the /api/v1 API; the SPA itself
    // is served by server.ts (Vite dev middleware / express.static + the
    // app.get('*') index.html fallback). Verify that serving contract and that
    // main.tsx mounts the Reset Password page on the route.
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const serverSrc = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
    ok(serverSrc.includes("app.get('*'"), 'SPA fallback route present in server.ts');
    ok(serverSrc.includes('index.html'), 'SPA fallback serves index.html');
    const mainSrc = readFileSync(join(process.cwd(), 'src', 'main.tsx'), 'utf8');
    ok(mainSrc.includes("'/reset-password'"), 'main.tsx mounts the page for /reset-password');
    ok(mainSrc.includes('ResetPasswordPage'), 'main.tsx renders ResetPasswordPage');

    // The component renders the reset form when a token is present.
    const markup = renderView({ hasToken: true });
    ok(markup.includes(RESET_MESSAGES.formTitle), 'form title present');
    ok(markup.includes(RESET_MESSAGES.labelPassword), 'password field present');
    ok(markup.includes(RESET_MESSAGES.labelConfirm), 'confirm field present');
    ok(markup.includes('type="submit"'), 'submit button present (Enter submits)');
  });

  await test('Test 2: /reset-password without token -> invalid link view, no API call', async () => {
    // Token extraction must yield nothing for missing/blank tokens.
    assertEq(extractResetToken(''), '');
    assertEq(extractResetToken('?other=1'), '');
    assertEq(extractResetToken('?token='), '');

    // No fetch may happen while rendering the no-token view.
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => { fetchCalls++; return new Response('{}', { status: 200 }); };
    try {
      const markup = renderView({ hasToken: false });
      ok(markup.includes(RESET_MESSAGES.invalidLinkTitle), 'invalid link title shown');
      ok(markup.includes(RESET_MESSAGES.requestNewLink), 'request new link CTA shown');
      ok(!markup.includes(RESET_MESSAGES.labelPassword), 'no password form without token');
      assertEq(fetchCalls, 0, 'reset API must NOT be called without token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await test('Test 3: empty / too-short password -> validation error (no request)', async () => {
    assertEq(validateResetPassword('', ''), RESET_MESSAGES.emptyPassword);
    assertEq(validateResetPassword('abc123', 'abc123'), RESET_MESSAGES.shortPassword);
    assertEq(validateResetPassword('valid-password', ''), RESET_MESSAGES.emptyConfirm);

    // The field error is rendered and linked to the inputs for a11y.
    const markup = renderView({ hasToken: true, fieldError: RESET_MESSAGES.shortPassword });
    ok(markup.includes(RESET_MESSAGES.shortPassword), 'short-password error rendered');
    ok(markup.includes('aria-invalid="true"'), 'inputs flagged aria-invalid');
    ok(markup.includes('aria-describedby="reset-field-error"'), 'error linked via aria-describedby');
  });

  await test('Test 4: mismatched passwords -> validation error', async () => {
    assertEq(validateResetPassword('valid-password', 'different-pass'), RESET_MESSAGES.mismatch);
    // Valid input passes validation (null = no error).
    assertEq(validateResetPassword('valid-password', 'valid-password'), null);
  });

  await test('Test 5: API receives {token, password} only — confirmation never sent', async () => {
    const calls: Array<{ input: string; init: any }> = [];
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (input: any, init: any) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      const api = await import('../src/lib/api');
      await api.resetPassword('test-token', 'valid-password');

      assertEq(calls.length, 1, 'exactly one request');
      assertEq(calls[0].input, '/api/v1/auth/reset', 'calls the existing reset endpoint');
      assertEq(calls[0].init.method, 'POST', 'POST method');
      const body = JSON.parse(calls[0].init.body);
      ok(body.token === 'test-token', 'token sent');
      ok(body.password === 'valid-password', 'password sent');
      ok(!('confirmPassword' in body) && !('confirm' in body) && !('passwordConfirm' in body), 'confirmation never sent');
      assertEq(Object.keys(body).length, 2, 'exactly token + password in the payload');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await test('Test 6: API success -> success message + login CTA', async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    try {
      const api = await import('../src/lib/api');
      // A 200 response resolves without throwing (success path).
      let threw = false;
      try { await api.resetPassword('test-token', 'valid-password'); } catch { threw = true; }
      ok(!threw, 'success response resolves');
    } finally {
      globalThis.fetch = originalFetch;
    }

    // The success view shows the French message + a CTA to the existing login.
    const markup = renderView({ hasToken: true, success: true });
    ok(markup.includes(RESET_MESSAGES.success), 'success message shown');
    ok(markup.includes(RESET_MESSAGES.loginCta), 'login CTA shown');
    ok(markup.includes('role="status"'), 'success announced via role=status');
    // The app auto-opens the EXISTING AuthModal after ?connexion=1.
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const appSrc = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
    ok(appSrc.includes("'connexion'") && appSrc.includes('setShowAuthModal(true)'), 'App opens existing login modal');
  });

  await test('Test 7: expired/invalid token -> appropriate message (400 contract)', async () => {
    // Frontend mapping: the backend returns ONE generic 400 for invalid /
    // expired / used tokens (no token enumeration by design).
    assertEq(mapResetError(400), RESET_MESSAGES.invalidOrExpired);
    assertEq(mapResetError(422), RESET_MESSAGES.shortPassword);

    // Backend contract the UI relies on: bogus token -> 400 generic error.
    const { apiRequest } = await import('./setup');
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/reset', {
      body: { token: 'bogus-expired-token-xyz', password: 'valid-password' },
    });
    assertEq(res.status, 400);
    ok(!(JSON.stringify(res.body) || '').includes('bogus-expired-token-xyz'), 'token never echoed by the API');
  });

  await test('Test 8: network/server error -> generic message without sensitive details', async () => {
    assertEq(mapResetError(500), RESET_MESSAGES.generic);
    assertEq(mapResetError(503), RESET_MESSAGES.generic);
    assertEq(mapResetError(undefined), RESET_MESSAGES.generic);

    // A network failure rejects; the UI maps it to the generic French message.
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => { throw new Error('network down'); };
    try {
      const api = await import('../src/lib/api');
      let threw = false;
      try { await api.resetPassword('test-token', 'valid-password'); } catch { threw = true; }
      ok(threw, 'network failure rejects the promise');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await test('Test 9: double submit prevented -> single request', async () => {
    // While submitting, the submit button is disabled (and aria-busy) so the
    // user cannot fire a second request from the same form.
    const submitting = renderView({ hasToken: true, submitting: true });
    ok(submitting.includes('disabled=""'), 'submit button disabled while submitting');
    ok(submitting.includes('aria-busy="true"'), 'aria-busy set while submitting');
    ok(submitting.includes('Réinitialisation en cours'), 'loading state shown');

    const idle = renderView({ hasToken: true, submitting: false });
    ok(!idle.includes('disabled=""'), 'submit button enabled when idle');

    // The form uses a type="submit" button so Enter submits exactly once
    // through the guarded onSubmit handler.
    ok(idle.includes('type="submit"'), 'submit button present');
  });

  await test('Test 10: security — token never logged, stored, shown, or sent elsewhere', async () => {
    const SECRET = 'secret-e2e-reset-token-9f3a1c';

    // a) The view never renders the token, even if a token prop is passed.
    const uiMarkup = renderView({ hasToken: true, token: SECRET });
    ok(!uiMarkup.includes(SECRET), 'token not rendered in the UI');

    // b) Capture every console output + every fetch during a full API flow.
    const logs: string[] = [];
    const calls: string[] = [];
    const origLog = console.log, origWarn = console.warn, origError = console.error, origInfo = console.info;
    const spy = (...a: any[]) => logs.push(a.map(String).join(' '));
    (console as any).log = spy; (console as any).warn = spy; (console as any).error = spy; (console as any).info = spy;
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (input: any, init: any) => {
      calls.push(String(input) + ' ' + String(init?.body || ''));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      const api = await import('../src/lib/api');
      await api.resetPassword(SECRET, 'valid-password');
      renderView({ hasToken: true });
    } finally {
      console.log = origLog; console.warn = origWarn; console.error = origError; console.info = origInfo;
      globalThis.fetch = originalFetch;
    }
    ok(!logs.some((l) => l.includes(SECRET)), 'token never written to the console');
    ok(calls.length === 1 && calls[0].includes('/api/v1/auth/reset'), 'token sent ONLY to /api/v1/auth/reset');

    // c) Source scan: the new frontend code never touches web storage,
    //    cookies, analytics or logs anything via console.
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const pageSrc = readFileSync(join(process.cwd(), 'src', 'components', 'ResetPasswordPage.tsx'), 'utf8');
    const apiSrc = readFileSync(join(process.cwd(), 'src', 'lib', 'api.ts'), 'utf8');
    const mainSrc = readFileSync(join(process.cwd(), 'src', 'main.tsx'), 'utf8');
    const forbidden = [
      /\blocalStorage\s*\./, /\bsessionStorage\s*\./, /document\.cookie/,
      /console\.(log|info|debug)\s*\(/, /gtag\s*\(|dataLayer|sendBeacon\s*\(/,
    ];
    for (const [name, src] of [['ResetPasswordPage.tsx', pageSrc], ['main.tsx', mainSrc]] as const) {
      for (const pattern of forbidden) {
        ok(!pattern.test(src), `${name} must not contain ${String(pattern)}`);
      }
    }
    // api.ts: no web-storage / cookie access (the reset flow keeps the token
    // in memory and the payload only).
    ok(!/\blocalStorage\s*\./.test(apiSrc), 'api.ts must not use localStorage');
    ok(!/\bsessionStorage\s*\./.test(apiSrc), 'api.ts must not use sessionStorage');
    ok(!/document\.cookie/.test(apiSrc), 'api.ts must not read/write cookies directly');
  });
}