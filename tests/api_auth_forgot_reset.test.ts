import { test, ok, assertEq, ctx } from './run';

export async function runApiAuthForgotResetTests() {
  console.log('\n🔔 API Auth Forgot/Reset Tests\n');
  const { passwordResetService } = await import('../server/services/passwordResetService');
  const { userRepository } = await import('../server/repositories/userRepository');
  const { passwordResetRepository } = await import('../server/repositories/passwordResetRepository');

  await test('forgot: existing user -> generic success', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevPub = process.env.PUBLIC_APP_URL;
    // Email util records in-memory only when NODE_ENV==='test'. The suite
    // runner's ambient env can be mutated by earlier imports (Vite sets
    // NODE_ENV='development' when server.ts is imported), so opt into
    // test-mode capture explicitly rather than relying on the ambient value.
    process.env.NODE_ENV = 'test';
    delete process.env.PUBLIC_APP_URL;
    try {
      const u = await userRepository.create({ email: 'api_forgot1@test', passwordHash: 'scrypt$1$1$1$a$b', fullName: 'AF1', phone: '', role: 'artisan', tier: 'FREE', status: 'active' });
      const { clearSentEmails, getSentEmails } = await import('../server/utils/email');
      clearSentEmails();
      const res = await (await import('./setup')).apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/forgot', { body: { email: u.email } });
      assertEq(res.status, 200);
      ok(res.body && res.body.ok);
      ok(!('token' in res.body), 'no raw token in response');
      const sent = getSentEmails();
      ok(sent.length >= 1 && sent[sent.length-1].to === u.email, 'reset email captured in test env');
    } finally {
      if (prevPub !== undefined) process.env.PUBLIC_APP_URL = prevPub; else delete process.env.PUBLIC_APP_URL;
      process.env.NODE_ENV = prevNode || 'test';
    }
  });

  await test('forgot: unknown user -> generic success', async () => {
    const res = await (await import('./setup')).apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/forgot', { body: { email: 'no-such-user@example.test' } });
    assertEq(res.status, 200);
    ok(res.body && res.body.ok);
    const { getSentEmails } = await import('../server/utils/email');
    const sent = getSentEmails();
    // No new email should be sent for unknown user (only previous emails may exist)
    // Ensure last email is NOT to this unknown address
    if (sent.length > 0) ok(sent[sent.length-1].to !== 'no-such-user@example.test');
  });

  await test('reset: valid token + valid password -> success', async () => {
    const u = await userRepository.create({ email: 'api_reset1@test', passwordHash: 'scrypt$1$1$1$a$b', fullName: 'AR1', phone: '', role: 'artisan', tier: 'FREE', status: 'active' });
    // create token via service test helper
    const r = await passwordResetService.requestPasswordReset(u.email, { returnRawTokenToCaller: true }) as any;
    const raw = r.token as string;
    const res = await (await import('./setup')).apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/reset', { body: { token: raw, password: 'newpassword1' } });
    assertEq(res.status, 200);
    ok(res.body && res.body.ok);
    const updated = await userRepository.findById(u.id);
    const { comparePassword } = await import('../server/utils/crypto');
    ok(updated && comparePassword('newpassword1', updated.passwordHash));
    const rec = await passwordResetRepository.findByTokenHash((await import('../server/utils/crypto')).sha256Hex(raw));
    ok(rec && rec.usedAt, 'token should be marked used');
  });

  await test('forgot: production missing PUBLIC_APP_URL -> no email sent', async () => {
    // Simulate production config missing PUBLIC_APP_URL
    const prevNode = process.env.NODE_ENV;
    const prevPub = process.env.PUBLIC_APP_URL;
    process.env.NODE_ENV = 'production';
    delete process.env.PUBLIC_APP_URL;
    try {
      const u = await userRepository.create({ email: 'api_forgot_prod@test', passwordHash: 'scrypt$1$1$1$a$b', fullName: 'P1', phone: '', role: 'artisan', tier: 'FREE', status: 'active' });
      const { clearSentEmails, getSentEmails } = await import('../server/utils/email');
      clearSentEmails();
      const res = await (await import('./setup')).apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/forgot', { body: { email: u.email } });
      assertEq(res.status, 200);
      ok(res.body && res.body.ok);
      const sent = getSentEmails();
      // No email should be sent when PUBLIC_APP_URL is missing in production
      if (sent.length > 0) ok(sent[sent.length-1].to !== u.email);
      // The generic response must not leak config details, localhost, or a URL.
      const bodyStr = JSON.stringify(res.body);
      ok(!bodyStr.includes('PUBLIC_APP_URL'), 'must not leak config variable name');
      ok(!bodyStr.includes('reset-password'), 'must not leak a reset URL');
      ok(!bodyStr.includes('localhost'), 'must not leak a localhost link');
    } finally {
      if (prevPub !== undefined) process.env.PUBLIC_APP_URL = prevPub; else delete process.env.PUBLIC_APP_URL;
      process.env.NODE_ENV = prevNode;
    }
  });

  await test('forgot: invalid PUBLIC_APP_URL -> no email sent', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevPub = process.env.PUBLIC_APP_URL;
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_APP_URL = 'not-a-valid-url';
    try {
      const u = await userRepository.create({ email: 'api_forgot_badurl@test', passwordHash: 'scrypt$1$1$1$a$b', fullName: 'P2', phone: '', role: 'artisan', tier: 'FREE', status: 'active' });
      const { clearSentEmails, getSentEmails } = await import('../server/utils/email');
      clearSentEmails();
      const res = await (await import('./setup')).apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/forgot', { body: { email: u.email } });
      assertEq(res.status, 200);
      ok(res.body && res.body.ok);
      const sent = getSentEmails();
      if (sent.length > 0) ok(sent[sent.length-1].to !== u.email);
      // Invalid config must be handled safely: generic response, no details.
      const bodyStr = JSON.stringify(res.body);
      ok(!bodyStr.includes('PUBLIC_APP_URL'), 'must not leak config variable name');
      ok(!bodyStr.includes('reset-password'), 'must not leak a reset URL');
      ok(!bodyStr.includes('localhost'), 'must not leak a localhost link');
    } finally {
      if (prevPub !== undefined) process.env.PUBLIC_APP_URL = prevPub; else delete process.env.PUBLIC_APP_URL;
      process.env.NODE_ENV = prevNode;
    }
  });

  await test('forgot: valid PUBLIC_APP_URL -> email sent with correct host', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevPub = process.env.PUBLIC_APP_URL;
    // The email util records sent emails in-memory ONLY when NODE_ENV==='test'.
    // Production-required / loopback-rejection behaviour is covered by the
    // dedicated production tests above/below; here we verify that a valid
    // PUBLIC_APP_URL is used to build the reset link and the email captures it.
    process.env.NODE_ENV = 'test';
    process.env.PUBLIC_APP_URL = 'https://app.example.test';
    try {
      const u = await userRepository.create({ email: 'api_forgot_ok@test', passwordHash: 'scrypt$1$1$1$a$b', fullName: 'P3', phone: '', role: 'artisan', tier: 'FREE', status: 'active' });
      const { clearSentEmails, getSentEmails } = await import('../server/utils/email');
      clearSentEmails();
      const res = await (await import('./setup')).apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/forgot', { body: { email: u.email } });
      assertEq(res.status, 200);
      ok(res.body && res.body.ok);
      ok(!('token' in res.body), 'no raw token in response');
      const sent = getSentEmails();
      ok(sent.length >= 1 && sent[sent.length-1].to === u.email);
      // The reset URL in the email should contain the configured host
      const content = (sent[sent.length-1].html || sent[sent.length-1].text);
      ok(content.includes('https://app.example.test/reset-password?token='), 'reset URL uses configured host');
      ok(!content.toLowerCase().includes('localhost'), 'no localhost in reset email');
    } finally {
      if (prevPub !== undefined) process.env.PUBLIC_APP_URL = prevPub; else delete process.env.PUBLIC_APP_URL;
      process.env.NODE_ENV = prevNode;
    }
  });

  await test('forgot: production + localhost PUBLIC_APP_URL -> no localhost link sent', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevPub = process.env.PUBLIC_APP_URL;
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_APP_URL = 'http://localhost:5173';
    try {
      const u = await userRepository.create({ email: 'api_forgot_localhost@test', passwordHash: 'scrypt$1$1$1$a$b', fullName: 'PLH', phone: '', role: 'artisan', tier: 'FREE', status: 'active' });
      const { clearSentEmails, getSentEmails } = await import('../server/utils/email');
      clearSentEmails();
      const res = await (await import('./setup')).apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/forgot', { body: { email: u.email } });
      assertEq(res.status, 200);
      ok(res.body && res.body.ok);
      const sent = getSentEmails();
      // Production must never send a localhost reset link.
      ok(sent.length === 0 || sent[sent.length-1].to !== u.email, 'no localhost link sent in production');
    } finally {
      if (prevPub !== undefined) process.env.PUBLIC_APP_URL = prevPub; else delete process.env.PUBLIC_APP_URL;
      process.env.NODE_ENV = prevNode;
    }
  });

  await test('forgot: raw token server option cannot be controlled via HTTP input', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevPub = process.env.PUBLIC_APP_URL;
    // Opt into test-mode email capture explicitly (see first test comment).
    process.env.NODE_ENV = 'test';
    delete process.env.PUBLIC_APP_URL;
    try {
      const u = await userRepository.create({ email: 'api_forgot_httpctrl@test', passwordHash: 'scrypt$1$1$1$a$b', fullName: 'AFctrl', phone: '', role: 'artisan', tier: 'FREE', status: 'active' });
      const { clearSentEmails, getSentEmails } = await import('../server/utils/email');
      clearSentEmails();
      // Attack surface: client tries to toggle the server-only raw-token option
      // via body, query string and header. None of these may have any effect.
      const res = await (await import('./setup')).apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/forgot?returnRawTokenToCaller=true', {
        body: { email: u.email, returnRawTokenToCaller: true },
        headers: { 'x-return-raw-token': 'true' },
      });
      assertEq(res.status, 200);
      ok(res.body && res.body.ok);
      const bodyStr = JSON.stringify(res.body);
      ok(!('token' in res.body), 'raw token must never appear in the JSON response');
      ok(!bodyStr.includes('reset-password'), 'reset URL must never be returned in the response');
      // Request still completes normally; token only lands inside the emailed link.
      const sent = getSentEmails();
      ok(sent.length >= 1 && sent[sent.length-1].to === u.email, 'email sent normally');
    } finally {
      if (prevPub !== undefined) process.env.PUBLIC_APP_URL = prevPub; else delete process.env.PUBLIC_APP_URL;
      process.env.NODE_ENV = prevNode || 'test';
    }
  });

  await test('forgot: email capture contains reset URL, raw token only inside the link', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevPub = process.env.PUBLIC_APP_URL;
    // Test-env capture: emails are recorded in-memory only when NODE_ENV==='test'.
    process.env.NODE_ENV = 'test';
    process.env.PUBLIC_APP_URL = 'https://app.example.test';
    try {
      const u = await userRepository.create({ email: 'api_forgot_email@test', passwordHash: 'scrypt$1$1$1$a$b', fullName: 'P4', phone: '', role: 'artisan', tier: 'FREE', status: 'active' });
      const { clearSentEmails, getSentEmails } = await import('../server/utils/email');
      clearSentEmails();
      const res = await (await import('./setup')).apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/forgot', { body: { email: u.email } });
      assertEq(res.status, 200);
      ok(res.body && res.body.ok);
      const sent = getSentEmails();
      ok(sent.length >= 1 && sent[sent.length-1].to === u.email, 'email sent with server-side recipient');
      const content = (sent[sent.length-1].html || sent[sent.length-1].text);
      ok(content.includes('https://app.example.test/reset-password?token='), 'reset URL uses the configured public host');
      const m = content.match(/token=([A-Za-z0-9_-]+)/);
      ok(m && m[1], 'raw token embedded inside the reset URL');
      const token = m![1];
      const occurrences = content.split(token).length - 1;
      ok(occurrences === 1, `raw token appears exactly once (inside the link only), got ${occurrences}`);
    } finally {
      if (prevPub !== undefined) process.env.PUBLIC_APP_URL = prevPub; else delete process.env.PUBLIC_APP_URL;
      process.env.NODE_ENV = prevNode;
    }
  });

  await test('reset: invalid token -> generic error', async () => {
    const res = await (await import('./setup')).apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/reset', { body: { token: 'nope', password: 'newpassword1' } });
    assertEq(res.status, 400);
  });

  await test('reset: password too short -> validation error', async () => {
    const res = await (await import('./setup')).apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/reset', { body: { token: 'x', password: 'short' } });
    assertEq(res.status, 422);
  });
}
