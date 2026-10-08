/**
 * PHASE 1 — pure tests for the API-first country/currency registry merge.
 * No infra/env needed: only local fallback tables + exported functions of
 * src/data/countryConfig.ts. Run: npx tsx tests/countryReference.test.ts
 */
import { strict as assert } from 'node:assert';
import {
  COUNTRIES_CONFIG,
  applyCountryReference,
  getCountryConfig,
  findCountryConfig,
  getCurrencyMeta,
  getExchangeRateFromTnd,
  convertFromTnd,
  formatPrice,
  listCountryOptions,
  subscribeCountryRegistry,
  getCountryRegistryVersion,
} from '../src/data/countryConfig';

// ── 1. Fallback integrity: registry starts EXACTLY as COUNTRIES_CONFIG ────────
assert.equal(getCountryConfig('TN').nameFr, COUNTRIES_CONFIG.TN.nameFr, 'TN fallback preserved');
assert.equal(getCountryConfig('ZZ').code, 'TN', 'unknown country falls back to TN (legacy || TN semantics)');
assert.equal(findCountryConfig('ZZ'), undefined, 'find* stays undefined for unknown (strict consumers)');
assert.equal(listCountryOptions().length, Object.keys(COUNTRIES_CONFIG).length, 'list = union, starts as fallback set');
assert.equal(getCurrencyMeta('TND').decimals, 3, 'TND keeps 3 decimals');
assert.equal(getExchangeRateFromTnd('TND'), 1.0, 'TND pinned to 1.0');
assert.equal(convertFromTnd(100, 'TND'), 100, 'convert TND→TND identity');
assert.equal(formatPrice(100, 'TND'), '100.000 DT', 'TN format byte-identical to legacy (toFixed + symbol)');
assert.equal(formatPrice(100, 'EUR'), '100.00 €', 'EUR format byte-identical to legacy');
assert.equal(getExchangeRateFromTnd('EUR'), 0.295, 'EUR local fallback rate before any API data');
assert.equal(getExchangeRateFromTnd('USD'), 0.322, 'USD local fallback rate before any API data');

// ── 2. New country added post-launch purely via API rows (no code change) ─────
const before = getCountryRegistryVersion();
let notified = 0;
const unsub = subscribeCountryRegistry(() => { notified += 1; });

const changed = applyCountryReference({
  countries: [{
    code: 'MA',
    nameFr: 'Maroc',
    nameAr: 'المغرب',
    flag: '🇲🇦',
    defaultCurrency: 'MAD',
    supportedCurrencies: ['MAD', 'EUR'],
    defaultVatRate: 20,
    unitSystem: 'metric',
    isActive: true,
  }],
  taxRules: [
    { countryCode: 'MA', taxType: 'VAT', rate: 20, labelFr: 'TVA 20%', isDefault: true },
    { countryCode: 'MA', taxType: 'TIMBRE', rate: 1, labelFr: 'Timbre fiscal 1 MAD' },
    { countryCode: 'MA', taxType: 'RETENUE', rate: 5, labelFr: 'Retenue garantie 5%' },
  ],
  currencies: [{ code: 'MAD', label: 'Dirham marocain', symbol: 'DH', decimals: 2 }],
  fxRates: [{ baseCurrency: 'TND', quoteCurrency: 'MAD', rate: 1.11, source: 'DB' }],
});
assert.equal(changed, true, 'merge reports change');
assert.equal(notified, 1, 'subscribers notified');
assert.ok(getCountryRegistryVersion() > before, 'version bumped');
const ma = getCountryConfig('MA');
assert.equal(ma.code, 'MA', 'new country registered');
assert.equal(ma.nameFr, 'Maroc', 'new country name from API');
assert.equal(ma.flag, '🇲🇦', 'new country flag from API');
assert.equal(ma.defaultCurrency, 'MAD', 'default currency from API row');
assert.equal(ma.defaultVatRate, 20, 'defaultVatRate built from isDefault tax_rules row');
assert.equal(ma.vatRates[0].rate, 20, 'vatRates list built from tax_rules');
assert.equal(ma.timbreFiscalDefault, 1, 'timbre from TIMBRE tax rule');
assert.equal(ma.standardRetenueRate, 5, 'retenue from RETENUE tax rule');
assert.equal(listCountryOptions().length, Object.keys(COUNTRIES_CONFIG).length + 1, 'country list = union (API row appended)');
assert.equal(getCurrencyMeta('MAD').symbol, 'DH', 'new currency meta registered');
assert.equal(getExchangeRateFromTnd('MAD'), 1.11, 'new FX rate registered');
assert.ok(Math.abs(convertFromTnd(200, 'MAD') - 222) < 1e-9, 'convert via new registry rate');

// ── 3. Fiscal fields of fallback countries are FROZEN (local-first safety) ────
const tnFiscalSnapshot = () => JSON.stringify({
  defaultVatRate: getCountryConfig('TN').defaultVatRate,
  vatRates: getCountryConfig('TN').vatRates,
  timbreFiscalDefault: getCountryConfig('TN').timbreFiscalDefault,
  timbreLabel: getCountryConfig('TN').timbreLabel,
  standardRetenueRate: getCountryConfig('TN').standardRetenueRate,
});
const tnBefore = tnFiscalSnapshot();
applyCountryReference({
  countries: [{ ...COUNTRIES_CONFIG.TN, nameFr: 'Tunisie (spoof)' }],
  taxRules: [{ countryCode: 'TN', taxType: 'VAT', rate: 99, labelFr: 'Spoof TVA 99%', isDefault: true }],
});
const tn = getCountryConfig('TN');
assert.equal(tn.defaultVatRate, COUNTRIES_CONFIG.TN.defaultVatRate, 'TN defaultVatRate NOT overridden by API');
assert.equal(tn.timbreFiscalDefault, COUNTRIES_CONFIG.TN.timbreFiscalDefault, 'TN timbre NOT overridden by API');
assert.equal(tn.standardRetenueRate, COUNTRIES_CONFIG.TN.standardRetenueRate, 'TN retenue NOT overridden by API');
assert.equal(tnFiscalSnapshot(), tnBefore, 'TN fiscal block byte-identical');
assert.equal(tn.nameFr, 'Tunisie (spoof)', 'descriptive fields DO refresh (API-first info)');

// ── 4. Currency local-first: TND decimals never clobbered by API ──────────────
applyCountryReference({ currencies: [{ code: 'TND', symbol: 'X', label: 'spoof', decimals: 0 }] });
assert.equal(getCurrencyMeta('TND').decimals, 3, 'TND decimals stay 3 (local-first)');
assert.equal(getCurrencyMeta('TND').symbol, 'DT', 'TND symbol stays fallback (local-first)');

// ── 5. FX junk filtered, TND pinned ───────────────────────────────────────────
applyCountryReference({
  fxRates: [
    { baseCurrency: 'TND', quoteCurrency: 'EUR', rate: -5 },  // negative → ignored
    { baseCurrency: 'USD', quoteCurrency: 'EUR', rate: 0.9 }, // non-TND base → ignored
    { baseCurrency: 'TND', quoteCurrency: 'USD', rate: 0 },   // zero → ignored
    { baseCurrency: 'TND', quoteCurrency: 'GBP', rate: 0.26 },// valid → applied
  ],
});
assert.equal(getExchangeRateFromTnd('EUR'), 0.295, 'negative EUR rate rejected (local fallback kept)');
assert.equal(getExchangeRateFromTnd('USD'), 0.322, 'zero USD rate rejected (local fallback kept)');
assert.equal(getExchangeRateFromTnd('GBP'), 0.26, 'valid GBP rate applied');
assert.equal(getExchangeRateFromTnd('TND'), 1.0, 'TND still pinned after merge');

// ── 6. Null payload leaves that domain untouched (per-endpoint failure) ───────
const ok = applyCountryReference({ countries: null, currencies: null, fxRates: undefined });
assert.equal(ok, false, 'null endpoints → no change, no notify');
assert.equal(notified, 3, 'notified only by real changes (sections 2, 3, 5)');
assert.equal(getCountryConfig('MA').code, 'MA', 'previous MA merge intact');

unsub();
console.log('countryReference.test.ts: ALL ASSERTIONS PASSED');
