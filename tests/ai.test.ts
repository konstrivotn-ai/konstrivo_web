import { test, ok, assertEq, ctx } from './run';
import { apiRequest, lastAiRequest, resetLastAiRequest, getLastAiRequest } from './setup';

export async function runAiTests() {
  console.log('\n🔎 AI Endpoint Tests\n');

  await test('ai-estimator requires auth -> 401', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/ai-estimator', { body: { prompt: 'Calculate a small ceiling 2x3m' } });
    assertEq(res.status, 401);
  });

  await test('authenticated request reaches handler -> 200', async () => {
    const token = ctx.freeToken!;
    resetLastAiRequest();
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'TEST_KEY';
    try {
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/ai-estimator', { token, body: { prompt: 'Hello estimator' } });
      assertEq(res.status, 200);
    } finally {
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev; else delete process.env.GEMINI_API_KEY;
    }
    ok(getLastAiRequest(), 'AI request was captured');
  });

  await test('sanitization: PII removed, numeric fields forwarded', async () => {
    const token = ctx.freeToken!;
    const currentDevis = {
      clientName: 'John Doe',
      clientPhone: '+21699999999',
      clientAddress: 'Secret Street 1',
      notes: 'Confidential',
      id: 'devis-123',
      createdByUserId: 'user-abc',
      projectTitle: 'Maison X',
      country: 'TN',
      currency: 'TND',
      items: [ { trade: 'placo', title: 'Plaque', quantity: 10, unit: 'm2', unitPrice: 5 } ],
      subtotalMaterials: 50,
      subtotalLabor: 100,
      total: 160,
      tvaPercent: 19
    };

    resetLastAiRequest();
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'TEST_KEY';
    try {
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/ai-estimator', { token, body: { prompt: 'Estimate', currentDevis } });
      assertEq(res.status, 200);

      const captured = getLastAiRequest();
      ok(captured, 'captured');
      // sanitizedDevis is embedded inside the systemInstruction string in production handler
      const systemInstruction: string = captured.config?.systemInstruction || '';
      let s: any = null;
      const marker = 'Context Devis: ';
      const idx = systemInstruction.indexOf(marker);
      if (idx !== -1) {
        const tail = systemInstruction.substring(idx + marker.length).trim();
        if (tail !== 'Aucun') {
          try { s = JSON.parse(tail); } catch { s = null; }
        }
      }
      ok(s, 'sanitizedDevis parsed');
      // PII should be removed
      assertEq(s.clientName, undefined);
      assertEq(s.clientPhone, undefined);
      assertEq(s.clientAddress, undefined);
      assertEq(s.notes, undefined);
      assertEq(s.id, undefined);
      assertEq(s.createdByUserId, undefined);
      // Numeric fields should be present
      assertEq(s.subtotalMaterials, 50);
      assertEq(s.subtotalLabor, 100);
      assertEq(s.total, 160);
      assertEq(s.tvaPercent, 19);
      ok(Array.isArray(s.items) && s.items.length === 1, 'items forwarded');
    } finally {
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev; else delete process.env.GEMINI_API_KEY;
    }
  });

  await test('empty prompt -> 400', async () => {
    const token = ctx.freeToken!;
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/ai-estimator', { token, body: { prompt: '' } });
    assertEq(res.status, 400);
  });

  await test('too long prompt -> 400', async () => {
    const token = ctx.freeToken!;
    const long = 'a'.repeat(2001);
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/ai-estimator', { token, body: { prompt: long } });
    assertEq(res.status, 400);
  });

  await test('missing GEMINI_API_KEY -> 503', async () => {
    // call the prod-check route (no injected client) to assert 503 when GEMINI_API_KEY missing
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/ai-estimator-prod-check', { body: { prompt: 'X' } });
      assertEq(res.status, 503);
    } finally {
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    }
  });

  await test('logs do not contain PII / secrets', async () => {
    const token = ctx.freeToken!;
    const currentDevis = { clientName: 'PII_NAME', projectTitle: 'P' };
    const prevApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'TEST_KEY_ABC';

    const logs: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args: any[]) => { logs.push(args.join(' ')); };
    console.error = (...args: any[]) => { logs.push(args.join(' ')); };

    try {
      resetLastAiRequest();
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/ai-estimator', { token, body: { prompt: 'X', currentDevis } });
      assertEq(res.status, 200);
      // ensure logs don't include sensitive strings
      const joined = logs.join('\n');
      ok(!joined.includes('PII_NAME'));
      ok(!joined.includes('TEST_KEY_ABC'));
      ok(!joined.includes(token));
    } finally {
      console.log = origLog;
      console.error = origErr;
      if (prevApiKey !== undefined) process.env.GEMINI_API_KEY = prevApiKey;
    }
  });
}
