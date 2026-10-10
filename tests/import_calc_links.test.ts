import { startTestServer, apiRequest } from './setup';
import { strict as assert } from 'assert';
import { getDatabase } from '../server/db/client';
import { eq } from 'drizzle-orm';

async function main() {
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  console.log('\n📥 import_calc_links real DB integration test');
  const server = await startTestServer();
  try {
    // Bootstrap admin from env (same as auth.test): requires ADMIN_EMAIL/PASSWORD in env
    const { bootstrapAdmin } = await import('../server/bootstrap');
    await bootstrapAdmin();
    // Login as admin to obtain token
    const loginRes = await apiRequest(server.baseUrl, 'POST', '/api/v1/auth/login', { body: { email: process.env.ADMIN_EMAIL || 'admin@test.tn', password: process.env.ADMIN_PASSWORD || 'bootstrap-admin-pass-2026' } });
    if (loginRes.status !== 200) throw new Error('admin login failed: ' + JSON.stringify(loginRes.body));
    const adminToken = loginRes.body.token;

    const CSV_HEADER = 'Reference;Nom_Materiau;Categorie;Unite;Prix_TND_HT;Note_Technique;Nom_Arabe';
    // Use a canonical calculator material seeded in calc_rules: plaque-ba13-standard-3m
    const REF = `plaque-ba13-standard-3m`;
    const csv = [CSV_HEADER, `${REF};Plaque BA13 Test;placo;unit;32.5;;`].join('\r\n');

    // Multipart body helper
    const boundary = `----PhaseBoundary${Math.random().toString(36).slice(2)}`;
    const rawBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="import.csv"',
      'Content-Type: text/csv',
      '',
      csv,
      `--${boundary}--`,
    ].join('\r\n');

    const res = await apiRequest(server.baseUrl, 'POST', '/api/v1/catalog/import-csv', { token: adminToken, rawBody, contentType: `multipart/form-data; boundary=${boundary}` });
    assert.equal(res.status, 200, `import-csv failed: ${JSON.stringify(res.body)}`);

    // Find material via API
    const list = await apiRequest(server.baseUrl, 'GET', `/api/v1/materials?search=${encodeURIComponent('Plaque BA13 Test')}&limit=100`);
    assert.equal(list.status, 200);
    const found = (list.body.data || []).find((m: any) => m.code === REF);
    assert.ok(found, 'imported material not found via API');
    const materialId = found.id;

    // Check material_calc_links row in DB
    const db = await getDatabase();
    if (!db) throw new Error('Database not available');
    const { materialCalcLinks } = await import('../server/db/schema/calculator');
    const rows = await db.select().from(materialCalcLinks).where(eq(materialCalcLinks.materialId, materialId));
    assert.ok(rows.length >= 1, 'expected at least one material_calc_links row');
    const link = rows[0];
    assert.ok(link.slotCode === 'placo_board' || !!link.ruleCode, 'expected slotCode or ruleCode present');

    // Re-import same CSV
    const res2 = await apiRequest(server.baseUrl, 'POST', '/api/v1/catalog/import-csv', { token: adminToken, rawBody, contentType: `multipart/form-data; boundary=${boundary}` });
    assert.equal(res2.status, 200, `second import failed: ${JSON.stringify(res2.body)}`);

    // Re-check links count — must be exactly one for this matchKey
    const rowsAfter = await db.select().from(materialCalcLinks).where(eq(materialCalcLinks.materialId, materialId));
    const distinct = new Map(rowsAfter.map((r: any) => [r.matchKey + '|' + r.materialId, r]));
    assert.equal(distinct.size, 1, `expected exactly one distinct material_calc_links row, got ${distinct.size}`);

    console.log('  PASS real DB import → material_calc_links persisted and idempotent');
  } finally {
    await server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });