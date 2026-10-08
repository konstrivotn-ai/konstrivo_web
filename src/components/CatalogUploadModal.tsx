import React, { useState } from 'react';
import { X, Upload, FileText, CheckCircle2, AlertTriangle, RefreshCw, Layers, DollarSign, ArrowRight, ShieldCheck, Download } from 'lucide-react';
import { MaterialRate, Language } from '../types';
import { normalizeRateUnit } from '../utils/priceLookup';

interface CatalogUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  rates: MaterialRate[];
  onApplyCatalog: (updatedRates: MaterialRate[]) => void;
  lang: Language;
}

interface ParsedItem {
  id?: string;
  nameFr: string;
  materialCode?: string;
  category: string;
  trade?: string;
  unit: string;
  newPriceTnd: number;
  oldPriceTnd?: number;
  unitPriceTtc?: number;
  tvaRate: number;
  currency: string;
  matchedRateId?: string;
}

interface ImportRowError {
  row: number;
  reason: string;
}

interface ParseTotals {
  totalRows: number;
  valid: number;
  errors: number;
}

export interface ColumnMapping {
  material_name?: string;
  material_code?: string;
  category?: string;
  trade?: string;
  unit?: string;
  price_ht?: string;
  tva_rate?: string;
  currency?: string;
  source?: string;
}

// ── Smart Mapping: canonical field aliases (accents-insensitive) ─────────────
// SAME alias families + SAME declaration order as the server registry
// (server/services/catalogImport.ts CANONICAL_FIELDS) so the Admin Smart
// Mapping preview (server /preview + /import) and this local CSV flow can
// never disagree. Aliases are matched by EXACT normalized header identity —
// and when several headers of one file are ALL exact aliases of the SAME
// field, the FIRST documented spelling wins (declaration order, never file
// column order): `name` > `name_en`, `supplier` > `brand`,
// `category` > `subcategory`.
// `department` / `product_group` are deliberately NOT mirrored here: on the
// server they are Trade-Registry-gated aliases of the métier (accepted only
// when the column VALUES all match the official trades — a value-profile proof
// this header-only local flow cannot perform). The local `trade` field stays
// the free-text convenience field it has always been.
const FIELD_ALIASES: Record<string, string[]> = {
  // EN/AR designation spellings (`name_en`, `title`, scraper `Materials`…)
  // are documented aliases of the designation — `name_en` is accepted as the
  // material name whenever no clearer designation column exists.
  material_name: ['material_name', 'nom_materiau', 'materiau_nom', 'nom_matiere', 'nom', 'name', 'name_fr', 'nom_fr', 'nom_francais', 'french_name', 'name_french', 'name_en', 'name_eng', 'english_name', 'nom_en', 'nom_anglais', 'nom_anglaise', 'designation_en', 'libelle_en', 'product_name_en', 'item_name_en', 'material_name_en', 'title_en', 'designation', 'designations', 'libelle', 'libeles', 'nom_produit', 'produit_nom', 'produit', 'item_name', 'product_name', 'materials', 'materiaux', 'produits', 'products', 'title', 'titles', 'product_title', 'item_title', 'article_title', 'nom_article', 'titre', 'titre_produit', 'intitule', 'libelle_produit', 'عنوان_المنتج', 'العنوان', 'عنوان', 'description', 'descriptions', 'اسم_المادة', 'اسم_المنتج', 'التعيين', 'الوصف', 'البيان', 'التسمية', 'المادة'],
  // `product_id` / `item_id` / `produit_id` are the common supplier/ERP
  // spelling of the stable material reference — SAME canonical `material_code`
  // as `material_code`/`reference`/`code` (server registry parity).
  material_code: ['material_code', 'materialcode', 'code_materiau', 'materiau_code', 'code_matiere', 'reference', 'references', 'reference_code', 'code_reference', 'code', 'ref', 'sku', 'sku_code', 'item_ref', 'numero_article', 'n_article', 'product_number', 'item_number', 'article', 'code_article', 'article_code', 'code_produit', 'produit_code', 'item_code', 'product_code', 'رمز_المادة', 'كود_المادة', 'المرجع', 'رمز_السلعة', 'الرمز', 'كود', 'product_id', 'produit_id', 'id_produit', 'product_ref', 'reference_produit', 'product_sku', 'item_id', 'id_article'],
  // `subcategory` family is a documented category spelling too — a true
  // `category` column always wins (declared first); a subcategory-only file
  // still maps instead of staying blocked.
  category: ['category', 'categories', 'categorie', 'material_category', 'product_category', 'categorie_produit', 'famille', 'famille_produit', 'category_name', 'subcategory', 'sub_category', 'sous_categorie', 'sous_categorie_produit', 'sub_categorie', 'subcategory_name', 'الصنف', 'الفئة', 'التصنيف', 'صنف_المادة', 'عائلة_المنتج'],
  trade: ['trade_code', 'tradecode', 'trade', 'trades', 'categorie_metier', 'metier', 'metiers', 'trade_name', 'metier_code', 'code_metier', 'المهنة', 'كود_المهنة', 'رمز_المهنة', 'الحرفة', 'التخصص'],
  unit: ['unit', 'units', 'unite', 'unites', 'unite_mesure', 'base_unit', 'mesure', 'uom', 'measure_unit', 'unit_of_measure', 'uom_code', 'unite_vente', 'sales_unit', 'selling_unit', 'purchase_unit', 'الوحدة', 'وحدة_القياس', 'وحدة', 'وحدة_البيع'],
  price_ht: ['price_ht', 'priceht', 'prix_ht', 'prixht', 'prix_tnd_ht', 'prix_ht_tnd', 'prix_tnd', 'prix', 'price', 'price_sar', 'prix_sar', 'price_tnd', 'prices', 'unit_price', 'unitprice', 'prix_unitaire', 'pu_ht', 'puht', 'montant', 'tarif', 'prix_unitaire_ht', 'prix_achat', 'prix_vente', 'cost', 'unit_cost', 'cost_price', 'prix_cout', 'cout', 'current_cost', 'السعر', 'الثمن', 'سعر_الوحدة', 'السعر_دون_اداء', 'السعر_الصافي', 'الثمن_دون_اداء'],
  tva_rate: ['tva_rate', 'tvarate', 'taux_tva', 'tauxtva', 'tva', 'vat', 'tax', 'taxes', 'taux', 'الاداء_على_القيمة_المضافة', 'نسبة_الاداء', 'الضريبة'],
  currency: ['currency', 'currencies', 'devise', 'devises', 'monnaie', 'monnaies', 'currency_code', 'code_devise', 'devise_code', 'العملة', 'رمز_العملة'],
  // `brand`/`marque`/`fabricant` are WHERE the row was read from (source
  // identity) — `supplier`/`fournisseur` stay the clearer spellings and win
  // by declaration order when both columns exist.
  source: ['source', 'source_code', 'data_source', 'source_name', 'supplier_name', 'supplier_source', 'fournisseur', 'supplier', 'marque', 'brand', 'fabricant', 'manufacturer', 'المزود', 'المصدر', 'العلامة']
};

export function normalizeHeader(header: string): string {
  return String(header ?? '')
    .replace(/^[\uFEFF\u200B\u200C\u200D]+/, '') // BOM / zero-width marks
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    // Punctuation-insensitive (same rule as the server normalizer): spaces, dots
    // and dashes all collapse to `_`, so `Product-ID`, `product id` and
    // `PRODUCT_ID` are ONE header identity.
    .replace(/[\s.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ── CSV parsing (comma / semicolon / tab, BOM, quoted commas) ────────────────
function detectDelimiter(line: string): string {
  let tab = 0, semi = 0, comma = 0, inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (inQuotes) continue;
    if (ch === '\t') tab++;
    else if (ch === ';') semi++;
    else if (ch === ',') comma++;
  }
  if (tab >= semi && tab >= comma && tab > 0) return '\t';
  if (semi >= comma && semi > 0) return ';';
  return ',';
}

function stripQuotes(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/""/g, '"').trim();
  }
  return v;
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i += 2; continue; }
      inQuotes = !inQuotes;
      i++;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      values.push(stripQuotes(current));
      current = '';
      i++;
      continue;
    }
    current += char;
    i++;
  }
  values.push(stripQuotes(current));
  return values;
}

export function parseCsvContent(content: string): Array<Record<string, string>> {
  const text = String(content || '').replace(/^\uFEFF/, ''); // strip UTF-8 BOM
  if (text.trim() === '') return [];

  // Physical lines → logical records, keeping quoted newlines together.
  const rawLines = text.split(/\r\n|\r|\n/);
  const records: string[] = [];
  let buffer = '';
  let inQuotes = false;
  for (const raw of rawLines) {
    buffer = buffer === '' ? raw : `${buffer}\n${raw}`;
    let q = inQuotes;
    for (let index = 0; index < raw.length; index++) {
      const c = raw[index];
      if (c === '"') {
        if (q && raw[index + 1] === '"') { index++; continue; }
        q = !q;
      }
    }
    inQuotes = q;
    if (!inQuotes && buffer.trim() !== '') {
      records.push(buffer);
      buffer = '';
    }
  }
  if (buffer.trim() !== '') records.push(buffer);

  if (records.length === 0) return [];
  const delimiter = detectDelimiter(records[0]);
  const headerCells = parseCsvLine(records[0], delimiter);
  const seen = new Map<string, number>();
  const headers = headerCells.map((h) => {
    const key = h === '' ? '(vide)' : h;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    return n === 1 ? key : `${key} #${n}`;
  });

  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < records.length; i++) {
    const cells = parseCsvLine(records[i], delimiter);
    if (!cells.some((c) => c.trim() !== '')) continue; // skip empty rows
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

// ── Smart Mapping: header names → canonical fields ───────────────────────────
export function resolveMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map((h) => ({ original: String(h ?? ''), norm: normalizeHeader(h) }));
  const used = new Set<string>();
  const mapping: ColumnMapping = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    // DECLARATION-ORDER precedence (same rule as the server registry's
    // exactAliasScore): when several headers are ALL exact aliases of the
    // SAME field, the first documented alias spelling wins — a bare `name`
    // is a clearer designation than `name_en`, `supplier` a clearer source
    // than `brand`. Alias order decides, never file column order, so this
    // local flow and the server suggestion can never disagree.
    for (const alias of aliases) {
      const normAlias = normalizeHeader(alias);
      if (normAlias === '') continue;
      const hit = normalized.find(({ original, norm }) => !used.has(original) && norm === normAlias);
      if (hit) {
        mapping[field] = hit.original;
        used.add(hit.original);
        break;
      }
    }
  }
  return mapping;
}
// ── Smart Mapping UI: one canonical value space for appliedMapping / Selects ──
// NOTE: there is NO "Métier (code)" row here — the local import flow's `trade`
// field accepts trade labels (free text), so a plain `trade` column is
// legitimately mapped to « Métier ». Nothing pretends to consume a trade code.
export interface MappingFieldDef {
  key: keyof ColumnMapping;
  label: string;
  required: boolean;
}

export const MAPPING_FIELDS: MappingFieldDef[] = [
  { key: 'material_code', label: 'Référence matériau', required: false },
  { key: 'material_name', label: 'Désignation matériau', required: true },
  { key: 'category', label: 'Catégorie', required: false },
  { key: 'trade', label: 'Métier', required: false },
  { key: 'unit', label: 'Unité', required: true },
  { key: 'price_ht', label: 'Prix HT', required: true },
  { key: 'tva_rate', label: 'Taux TVA', required: false },
  { key: 'currency', label: 'Devise', required: false },
  { key: 'source', label: 'Source / Fournisseur', required: false },
];

export interface MappingOption {
  value: string;
  label: string;
}

/**
 * Select options for the Smart Mapping UI. The option `value` is the EXACT
 * header key used by the parsed row records — the SAME value space as the
 * Select's `value` and the values stored in `appliedMapping` (one shared
 * space, so a detected field can never wrongly display « — Non mappé — »).
 */
export function optionsForField(headers: string[]): MappingOption[] {
  return headers.map((h) => ({ value: h, label: h }));
}

/**
 * Convert any auto-detection value (raw CSV header, possibly BOM-prefixed,
 * differently cased or spaced) into the exact header key present in the parsed
 * row records. Returns '' when no column matches.
 */
export function canonicalHeaderKey(rawHeader: string, headers: string[]): string {
  const raw = String(rawHeader ?? '');
  if (raw === '') return '';
  if (headers.includes(raw)) return raw;
  const norm = normalizeHeader(raw).replace(/^_+|_+$/g, '');
  if (norm === '') return '';
  const exact = headers.find((h) => normalizeHeader(h) === norm);
  if (exact) return exact;
  const loose = norm.replace(/[^a-z0-9]+/g, '_');
  const looseMatch = headers.find((h) => normalizeHeader(h).replace(/[^a-z0-9]+/g, '_') === loose);
  return looseMatch ?? '';
}

/**
 * Final applied mapping shown in the UI and used by buildParsedItems():
 *   - manual user choices win and are NEVER overwritten by auto-detection
 *     ('' = explicit un-mapping; an override pointing at a column that no
 *     longer exists in the current file falls back to auto-detection),
 *   - untouched fields use auto-detection, canonicalized to exact row keys,
 *   - optional fields absent from the file stay '' (→ « — Non mappé — »).
 */
export function buildAppliedMapping(
  headers: string[],
  autoMapping: ColumnMapping,
  userMapping: ColumnMapping
): ColumnMapping {
  const applied: ColumnMapping = {};
  for (const field of MAPPING_FIELDS) {
    const key = field.key;
    const userValue = userMapping[key];
    if (userValue !== undefined) {
      if (userValue === '') { applied[key] = ''; continue; }
      const canonical = canonicalHeaderKey(userValue, headers);
      if (canonical !== '') { applied[key] = canonical; continue; }
    }
    const autoValue = autoMapping[key];
    applied[key] = autoValue ? canonicalHeaderKey(autoValue, headers) : '';
  }
  return applied;
}

export function parseImportPrice(raw: string): number | null {
  const cleaned = String(raw ?? '').trim().replace(/\s/g, '').replace(/,/g, '.');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function parseTvaRate(raw: string): number | null {
  const value = parseImportPrice(raw);
  if (value === null) return null;
  return value >= 0 && value <= 100 ? value : null;
}

// ── Shared: header-keyed rows → validated ParsedItem list ────────────────────
export function buildParsedItems(
  rows: Array<Record<string, string>>,
  mapping: ColumnMapping,
  opts: { taxMode: 'ht' | 'ttc'; tvaRate: number; rates: MaterialRate[] }
): { items: ParsedItem[]; errors: ImportRowError[] } {
  const items: ParsedItem[] = [];
  const errors: ImportRowError[] = [];
  const pick = (row: Record<string, string>, key: keyof ColumnMapping): string => {
    const header = mapping[key];
    if (!header) return '';
    return String(row[header] ?? '').trim();
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // +1 for the header row
    const fail = (reason: string) => errors.push({ row: rowNumber, reason });

    const nameFr = pick(row, 'material_name');
    const unit = pick(row, 'unit');
    const priceRaw = pick(row, 'price_ht');

    if (!nameFr) { fail('Désignation (material_name) manquante.'); continue; }
    if (!unit) { fail('Unité (unit) manquante.'); continue; }

    const priceNum = parseImportPrice(priceRaw);
    if (priceNum === null || priceNum <= 0) {
      fail(`Prix HT invalide (« ${priceRaw || '(vide)'} » doit être un nombre > 0).`);
      continue;
    }

    // TVA: file value when present, otherwise the TVA currently selected in the UI.
    const tvaRaw = pick(row, 'tva_rate');
    let tvaRate = opts.tvaRate;
    if (tvaRaw !== '') {
      const parsed = parseTvaRate(tvaRaw);
      if (parsed === null) {
        fail(`Taux TVA invalide (« ${tvaRaw} » doit être un nombre entre 0 et 100).`);
        continue;
      }
      tvaRate = parsed;
    }

    // Currency: file value when present, otherwise TND.
    const currencyRaw = pick(row, 'currency');
    const currency = currencyRaw !== '' ? currencyRaw : 'TND';

    let priceHt = priceNum;
    let priceTtc = priceNum;
    if (opts.taxMode === 'ttc') {
      priceHt = +(priceNum / (1 + tvaRate / 100)).toFixed(3);
      priceTtc = priceNum;
    } else {
      priceHt = priceNum;
      priceTtc = +(priceNum * (1 + tvaRate / 100)).toFixed(3);
    }

    // Existing matching behavior (unchanged).
    const designation = nameFr;
    const matchedRate = opts.rates.find((r) => {
      const rName = r.nameFr.toLowerCase();
      const dName = designation.toLowerCase();
      return dName.includes(r.id.replace(/_/g, ' ')) ||
             rName.split(' ').some((w) => w.length > 4 && dName.includes(w));
    });

    const category = pick(row, 'category');
    const trade = pick(row, 'trade');
    items.push({
      nameFr: designation,
      materialCode: pick(row, 'material_code'),
      category: category !== '' ? category : (trade !== '' ? trade : ''),
      trade,
      unit,
      newPriceTnd: priceHt,
      unitPriceTtc: priceTtc,
      tvaRate,
      currency,
      matchedRateId: matchedRate?.id,
      oldPriceTnd: matchedRate?.unitPriceTnd
    });
  }

  return { items, errors };
}

// ── Apply: existing rates updated + new articles appended (no duplicates) ────

/**
 * Unit-fidelity fix — the in-browser CSV cache resolves units with the SAME
 * single normalizer as the server price path (`mergeRates` →
 * `normalizeRateUnit`). Previously this file had its own alias table whose
 * `?? 'unit'` fallback silently swallowed the real CSV units `Litre` / `Set`
 * (and `Kg` before lower-casing), so Outils priced them as `1 unit`.
 * One shared table = one behaviour, server path and local path.
 */
export function mapImportedUnit(raw: string): MaterialRate['unit'] {
  return normalizeRateUnit(raw);
}

/** Deterministic, safe id slug (material_code when available, else name+category). */
export function slugifyMaterialId(raw: string): string {
  const base = normalizeHeader(raw)
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return base !== '' ? base : 'article';
}

export interface ApplyCatalogResult {
  updatedRates: MaterialRate[];
  updatedCount: number;
  addedCount: number;
  duplicateSkipped: number;
}

/**
 * Merge imported items into the rates base:
 *   existing rates + updated imported matches + newly added imported materials.
 * Matching order: (a) material_code ↔ existing id (slug-normalized, safe),
 * (b) preview-matched rate id, (c) normalized name (+ category preference).
 * One-to-one enforcement + signature dedup prevent duplicates — re-importing
 * the same file is idempotent. Existing rates are never removed or replaced.
 */
export function applyParsedCatalog(
  rates: MaterialRate[],
  items: ParsedItem[],
  opts: { supplierName?: string; importedOn?: Date } = {}
): ApplyCatalogResult {
  const dateLabel = (opts.importedOn ?? new Date()).toLocaleDateString('fr-TN');
  const supplier = (opts.supplierName ?? '').trim() || 'catalogue fournisseur';
  const updateNote = `Mis à jour via ${supplier} (${dateLabel})`;

  const result: MaterialRate[] = rates.map((r) => ({ ...r }));
  const used = new Set<number>(); // one-to-one: each existing rate updated at most once
  const assignedIds = new Set<string>(rates.map((r) => r.id));
  const seenSignatures = new Set<string>(); // duplicate rows inside the same file
  let updatedCount = 0;
  let addedCount = 0;
  let duplicateSkipped = 0;

  // Indexes for matching (built once; "used" re-checked at lookup time).
  const idxBySlugId = new Map<string, number>(); // (a) slug(material_code) ↔ slug(existing id)
  const idxById = new Map<string, number>();     // (b) preview-matched id
  const idxByName = new Map<string, number[]>(); // (c) normalized nameFr
  result.forEach((rate, idx) => {
    const slug = slugifyMaterialId(rate.id);
    if (!idxBySlugId.has(slug)) idxBySlugId.set(slug, idx);
    if (!idxById.has(rate.id)) idxById.set(rate.id, idx);
    const nameKey = normalizeHeader(rate.nameFr);
    const bucket = idxByName.get(nameKey);
    if (bucket) bucket.push(idx);
    else idxByName.set(nameKey, [idx]);
  });

  for (const item of items) {
    const codeSlug = item.materialCode ? slugifyMaterialId(item.materialCode) : '';
    const nameKey = normalizeHeader(item.nameFr);
    const signature = codeSlug !== '' ? `code:${codeSlug}` : `name:${nameKey}`;

    // 0) Same material twice within one file → skip the extra row.
    if (seenSignatures.has(signature)) { duplicateSkipped++; continue; }
    seenSignatures.add(signature);

    // (a) material_code ↔ existing id (safe slug comparison)
    let target = -1;
    if (codeSlug !== '') {
      const bySlug = idxBySlugId.get(codeSlug);
      if (bySlug !== undefined && !used.has(bySlug)) target = bySlug;
    }
    // (b) preview-matched rate id
    if (target < 0 && item.matchedRateId) {
      const byId = idxById.get(item.matchedRateId);
      if (byId !== undefined && !used.has(byId)) target = byId;
    }
    // (c) normalized name, category preferred when both known
    if (target < 0) {
      const bucket = (idxByName.get(nameKey) ?? []).filter((i) => !used.has(i));
      const withCategory = item.category
        ? bucket.find((i) => result[i].category === item.category)
        : undefined;
      target = withCategory ?? bucket[0] ?? -1;
    }
    // Name known but its match(es) were already consumed this run → duplicate.
    if (target < 0) {
      const bucket = idxByName.get(nameKey) ?? [];
      if (bucket.length > 0 && bucket.every((i) => used.has(i))) { duplicateSkipped++; continue; }
    }

    if (target >= 0) {
      used.add(target);
      result[target] = {
        ...result[target],
        unitPriceTnd: item.newPriceTnd,
        // Unit-fidelity fix — a re-import must ALSO restore the real unit. The
        // previous price-only update kept a legacy/wrong unit (`unit`) on every
        // already-imported row for ever, so re-uploading the corrected CSV could
        // never repair what Outils displayed. Applied only when the file
        // actually provides a unit: an empty cell never overwrites.
        ...(item.unit ? { unit: mapImportedUnit(item.unit) } : {}),
        note: updateNote
      };
      updatedCount++;
      continue;
    }

    // Nouvel article → append a complete MaterialRate (existing rates untouched).
    const category = (item.category || item.trade || '').trim() || 'import';
    const unit = mapImportedUnit(item.unit);
    let id = codeSlug !== '' ? codeSlug : slugifyMaterialId(`${item.nameFr}_${category}`);
    if (assignedIds.has(id)) {
      let n = 2;
      while (assignedIds.has(`${id}_${n}`)) n++;
      id = `${id}_${n}`;
    }
    assignedIds.add(id);
    addedCount++;
    const currencySuffix = item.currency && item.currency !== 'TND' ? ` — prix saisi en ${item.currency}` : '';
    result.push({
      id,
      category,
      // P2 — keep the file's authoritative trade code (when the file has a
      // "Métier" column) so the imported material stays linked to its trade
      // calculator even when `category` is a different supplier family.
      trade: (item.trade || category || '').trim() || undefined,
      nameFr: item.nameFr,
      nameAr: item.nameFr,     // no translation column in the file → fallback to nameFr
      nameEn: null,            // no EN column in the local CSV flow → null (never French-as-English)
      unit,
      unitPriceTnd: item.newPriceTnd,
      defaultPriceTnd: item.newPriceTnd,
      note: `Importé via ${supplier} (${dateLabel})${currencySuffix}`
    });
  }

  return { updatedRates: result, updatedCount, addedCount, duplicateSkipped };
}

// ── Excel (.xlsx / .xls) → same row shape as CSV ─────────────────────────────
async function parseExcelFile(file: File): Promise<Array<Record<string, string>>> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buffer));
  const sheetNames: string[] = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error('Le fichier Excel ne contient aucune feuille de calcul.');
  }
  const worksheet = workbook.Sheets[sheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(
    worksheet,
    { header: 1, raw: false, defval: '' }
  ) as unknown[][];

  // Locate the header row (first non-empty row).
  let headerIdx = -1;
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i] || [];
    if (row.some((c) => String(c ?? '').trim() !== '')) { headerIdx = i; break; }
  }
  if (headerIdx < 0) {
    throw new Error('Le fichier Excel ne contient aucune donnée lisible.');
  }

  const headerCells = (matrix[headerIdx] || []).map((c) => String(c ?? '').trim());
  const seen = new Map<string, number>();
  const headers = headerCells.map((h) => {
    const key = h === '' ? '(vide)' : h;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    return n === 1 ? key : `${key} #${n}`;
  });

  const rows: Array<Record<string, string>> = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i] || [];
    if (!cells.some((c) => String(c ?? '').trim() !== '')) continue; // skip empty rows
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = idx < cells.length ? String(cells[idx] ?? '').trim() : '';
    });
    rows.push(row);
  }
  return rows;
}

export const CatalogUploadModal: React.FC<CatalogUploadModalProps> = ({
  isOpen,
  onClose,
  rates,
  onApplyCatalog,
  lang
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [supplierName, setSupplierName] = useState('Comptoir BTP Tunisie 2026');
  const [taxMode, setTaxMode] = useState<'ht' | 'ttc'>('ht');
  const [tvaRate, setTvaRate] = useState<number>(19); // 19% standard Tunisia
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [rowErrors, setRowErrors] = useState<ImportRowError[]>([]);
  const [parsedTotals, setParsedTotals] = useState<ParseTotals>({ totalRows: 0, valid: 0, errors: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // Smart Mapping state — parsedRows/parsedHeaders feed both the mapping
  // Selects and buildParsedItems(); appliedMapping is THE mapping used
  // everywhere (Selects values, options and the confirm/apply step).
  const [parsedRows, setParsedRows] = useState<Array<Record<string, string>>>([]);
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [appliedMapping, setAppliedMapping] = useState<ColumnMapping>({});
  const [userMapping, setUserMapping] = useState<ColumnMapping>({});

  if (!isOpen) return null;

  // Sample CSV Catalog generator for instant testing
  // Sample Master CSV (same column names as the official Master CSV export)
  const sampleCatalogCSV = `material_code,material_name,category,unit,price_ht,tva_rate,currency,source,effective_from,effective_to,observed_at,status
PLA-BA13-STD,Plaque de plâtre BA13 Standard 1.2x2.5m,placo,unit,31.500,19,TND,Comptoir BTP,2026-01-01,,2026-01-01,active
PLA-BA13-HYD,Plaque de plâtre BA13 Hydrofuge Verte 1.2x2.5m,placo,unit,47.800,19,TND,Comptoir BTP,2026-01-01,,2026-01-01,active
OSS-RAIL48,Rail R48 galvanisé ép. 0.6mm - Longueur 3m,placo,unit,7.800,19,TND,Comptoir BTP,2026-01-01,,2026-01-01,active
ISOL-VERRE50,Laine de verre avec kraft 50mm (Rouleau 15m²),isolation,rouleau,78.000,19,TND,Comptoir BTP,2026-01-01,,2026-01-01,active
DAL-VINYL60,Dalle de plafond démontable vinyle 60x60cm,placo,unit,5.800,19,TND,Comptoir BTP,2026-01-01,,2026-01-01,active`;

  const handleDownloadSample = () => {
    const blob = new Blob([sampleCatalogCSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Catalogue_Fournisseur_Modele_2026.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // A NEW FILE is always analyzed FROM SCRATCH: the previous file's manual
  // mapping deltas are cleared, so results never depend on the last upload
  // (a corrected re-upload of the same file is re-detected 100% fresh).
  const processRows = (rows: Array<Record<string, string>>, freshUpload = false) => {
    const userMap = freshUpload ? {} : userMapping;
    if (freshUpload) setUserMapping({});
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const autoMapping = resolveMapping(headers);
    // appliedMapping = auto-detection (canonicalized to exact row-record keys)
    // merged with the user's manual choices, which are never overwritten.
    const applied = buildAppliedMapping(headers, autoMapping, userMap);

    setParsedRows(rows);
    setParsedHeaders(headers);
    setAppliedMapping(applied);

    const { items, errors } = buildParsedItems(rows, applied, {
      taxMode,
      tvaRate,
      rates
    });

    setParsedItems(items);
    setRowErrors(errors);
    setParsedTotals({ totalRows: rows.length, valid: items.length, errors: errors.length });

    if (!applied.price_ht) {
      setStatusMessage(
        `Aucune colonne de prix reconnue automatiquement (colonnes détectées : ${headers.join(', ') || 'aucune'}). ` +
        `Sélectionnez manuellement la colonne « Prix HT » dans le Smart Mapping ci-dessous (price_ht, prix_ht, prix_ht_tnd, price, prix…)`
      );
      return;
    }

    if (items.length === 0 && errors.length > 0) {
      setStatusMessage(`Fichier analysé : ${rows.length} ligne(s) lue(s), 0 ligne à importer — consultez les erreurs ci-dessous.`);
    } else if (errors.length > 0) {
      setStatusMessage(`Catalogue analysé : ${items.length} ligne(s) à importer · ${errors.length} ligne(s) rejetée(s).`);
    } else {
      setStatusMessage(`Catalogue analysé avec succès : ${items.length} ligne(s) à importer.`);
    }
  };

  /** Re-run the exact pipeline (buildParsedItems) with a given applied mapping. */
  const reparseWithMapping = (mapping: ColumnMapping) => {
    if (parsedRows.length === 0) return;
    const { items, errors } = buildParsedItems(parsedRows, mapping, {
      taxMode,
      tvaRate,
      rates
    });
    setParsedItems(items);
    setRowErrors(errors);
    setParsedTotals({ totalRows: parsedRows.length, valid: items.length, errors: errors.length });
    if (items.length === 0 && errors.length > 0) {
      setStatusMessage(`Mapping appliqué : ${parsedRows.length} ligne(s) lue(s), 0 ligne à importer — consultez les erreurs ci-dessous.`);
    } else if (errors.length > 0) {
      setStatusMessage(`Mapping appliqué : ${items.length} ligne(s) à importer · ${errors.length} ligne(s) rejetée(s).`);
    } else {
      setStatusMessage(`Mapping appliqué : ${items.length} ligne(s) à importer.`);
    }
  };

  /** Manual mapping change: user choice wins and is never auto-overwritten. */
  const handleMappingChange = (fieldKey: keyof ColumnMapping, headerValue: string) => {
    const nextUser: ColumnMapping = { ...userMapping };
    nextUser[fieldKey] = headerValue; // '' = explicit un-mapping
    setUserMapping(nextUser);
    const applied = buildAppliedMapping(parsedHeaders, resolveMapping(parsedHeaders), nextUser);
    setAppliedMapping(applied);
    reparseWithMapping(applied);
  };

  const parseFileContent = (content: string, freshUpload = false) => {
    setIsProcessing(true);
    try {
      const rows = parseCsvContent(content);
      if (rows.length === 0) {
        throw new Error('Fichier vide ou format non reconnu');
      }
      processRows(rows, freshUpload);
    } catch (err: any) {
      setParsedItems([]);
      setRowErrors([]);
      setParsedTotals({ totalRows: 0, valid: 0, errors: 0 });
      setStatusMessage(`Erreur d'analyse : ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setSelectedFile(file);
    setIsProcessing(true);
    try {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (ext === 'xlsx' || ext === 'xls') {
        const rows = await parseExcelFile(file);
        processRows(rows, true);
      } else {
        const text = await file.text();
        parseFileContent(text, true);
      }
    } catch (err: any) {
      setParsedItems([]);
      setRowErrors([]);
      setParsedTotals({ totalRows: 0, valid: 0, errors: 0 });
      setStatusMessage(`Erreur de lecture du fichier : ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleApply = () => {
    if (parsedRows.length === 0) return;

    // Confirm parses with EXACTLY the mapping displayed in the Smart Mapping
    // UI (appliedMapping) — never a stale or different mapping.
    const { items } = buildParsedItems(parsedRows, appliedMapping, {
      taxMode,
      tvaRate,
      rates
    });
    if (items.length === 0) return;

    // Existing rates + updated matches + newly added articles (no duplicates).
    const { updatedRates, updatedCount, addedCount, duplicateSkipped } = applyParsedCatalog(
      rates,
      items,
      { supplierName }
    );

    onApplyCatalog(updatedRates);

    const parts: string[] = [];
    if (updatedCount > 0) parts.push(`${updatedCount} article(s) existant(s) mis à jour`);
    if (addedCount > 0) parts.push(`${addedCount} nouvel(s) article(s) ajouté(s)`);
    if (duplicateSkipped > 0) parts.push(`${duplicateSkipped} doublon(s) ignoré(s)`);
    setStatusMessage(
      parts.length > 0
        ? `Base de calcul mise à jour : ${parts.join(' · ')}.`
        : 'Aucun changement appliqué.'
    );
    setTimeout(() => {
      onClose();
    }, addedCount > 0 ? 1400 : 900);
  };

  const handleLoadSampleNow = () => {
    setSupplierName('Comptoir BTP Tunisie (Catalogue Certifié 2026)');
    parseFileContent(sampleCatalogCSV, true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
        
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/40 p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
              <Upload className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Importation Catalogue Fournisseur
                <span className="px-2 py-0.5 text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full">
                  Légal & Certifié 2026
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Mise à jour directe de la base de prix avec barèmes fournisseurs officiels (CSV, Excel, JSON)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6">
          
          {/* Supplier Info & Tax Config */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Nom du Fournisseur / Quincaillerie</label>
              <input
                type="text"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="Ex: Comptoir Matériaux Tunis"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Base des Prix Importés</label>
              <div className="grid grid-cols-2 gap-1 bg-slate-900 p-1 rounded-lg border border-slate-700">
                <button
                  type="button"
                  onClick={() => setTaxMode('ht')}
                  className={`py-1.5 text-xs font-bold rounded-md transition-all ${
                    taxMode === 'ht' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Hors Taxes (HT)
                </button>
                <button
                  type="button"
                  onClick={() => setTaxMode('ttc')}
                  className={`py-1.5 text-xs font-bold rounded-md transition-all ${
                    taxMode === 'ttc' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  TTC (TVA Incluse)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Taux TVA Applicable (%)</label>
              <select
                value={tvaRate}
                onChange={(e) => setTvaRate(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
              >
                <option value={19}>19% (Taux normal BTP Tunisie 2026)</option>
                <option value={13}>13% (Taux réduit matériaux)</option>
                <option value={7}>7% (Prestations spécifiques)</option>
                <option value={0}>0% (Régime suspensif / Export)</option>
              </select>
            </div>
          </div>

          {/* Drag and Drop Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all ${
              dragActive
                ? 'border-amber-400 bg-amber-500/10'
                : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
            }`}
          >
            <Upload className="w-10 h-10 text-amber-400 mx-auto mb-3" />
            <h4 className="text-sm font-bold text-white mb-1">
              Glissez-déposez le fichier du catalogue fournisseur
            </h4>
            <p className="text-xs text-slate-400 mb-4 max-w-md mx-auto">
              Formats supportés : CSV, TXT, TSV, Excel (.xlsx / .xls). Séparateurs auto-détectés (virgule, point-virgule, tabulation) ; Smart Mapping par noms de colonnes (Référence, Désignation, Prix HT, TVA…).
            </p>

            <div className="flex items-center justify-center gap-3 flex-wrap">
              <label className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs cursor-pointer shadow-lg shadow-amber-500/20 transition-all">
                <span>Parcourir mes fichiers</span>
                <input
                  type="file"
                  accept=".csv,.txt,.tsv,.xlsx,.xls"
                  onChange={(e) => e.target.files && e.target.files[0] && handleFileUpload(e.target.files[0])}
                  className="hidden"
                />
              </label>

              <button
                type="button"
                onClick={handleLoadSampleNow}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
                Charger Catalogue Démo 2026
              </button>

              <button
                type="button"
                onClick={handleDownloadSample}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 rounded-xl text-xs transition-all flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Modèle CSV
              </button>
            </div>
          </div>

          {/* Status Message */}
          {statusMessage && (
            <div className={`p-3 rounded-xl flex items-center gap-2.5 text-xs ${
              parsedItems.length === 0 && (rowErrors.length > 0 || parsedTotals.totalRows > 0)
                ? 'bg-red-500/10 border border-red-500/30 text-red-300'
                : 'bg-slate-950 border border-slate-800 text-slate-300'
            }`}>
              {parsedItems.length === 0 && (rowErrors.length > 0 || parsedTotals.totalRows > 0) ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              )}
              <span>{statusMessage}</span>
            </div>
          )}

          {/* Smart Mapping — visible column ↔ field mapping (single value space:
              appliedMapping[key] === select value === option value === row key) */}
          {parsedHeaders.length > 0 && (
            <div className="space-y-2 bg-slate-950/60 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-400" />
                  Smart Mapping — Correspondance des colonnes
                </h4>
                <span className="text-[10px] text-slate-500">{parsedHeaders.length} colonne(s) détectée(s)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {MAPPING_FIELDS.map((field) => {
                  const current = appliedMapping[field.key] ?? '';
                  return (
                    <div key={field.key} className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5">
                      <span className={`text-[11px] font-bold w-40 shrink-0 ${field.required ? 'text-emerald-300' : 'text-slate-400'}`}>
                        {field.label}{field.required ? ' *' : ''}
                        {current !== '' && (
                          <span className="text-emerald-400" title={`« ${current} » → ${field.label}`}> ✓</span>
                        )}
                      </span>
                      <select
                        value={current}
                        onChange={(e) => handleMappingChange(field.key, e.target.value)}
                        className="flex-1 bg-slate-900 text-slate-100 text-[11px] font-mono border border-slate-700 rounded-lg px-1.5 py-1 outline-none cursor-pointer"
                      >
                        <option value="">— Non mappé —</option>
                        {optionsForField(parsedHeaders).map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-500">
                La correspondance détectée automatiquement est présélectionnée ; vos choix manuels sont conservés et utilisés tels quels lors de l'application.
              </p>
            </div>
          )}

          {/* Parsed Items Preview Table */}
          {parsedItems.length > 0 && (
            <div className="space-y-3">
              {/* Preview summary */}
              <div className="grid grid-cols-3 gap-3 bg-slate-950 rounded-xl border border-slate-800 p-3">
                <div className="text-center">
                  <div className="text-lg font-black text-slate-100">{parsedTotals.totalRows}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Lignes lues</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-black text-emerald-400">{parsedTotals.valid}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Articles valides</div>
                </div>
                <div className="text-center">
                  <div className={`text-lg font-black ${parsedTotals.errors > 0 ? 'text-red-400' : 'text-slate-100'}`}>{parsedTotals.errors}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Lignes en erreur</div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-400" />
                  Aperçu des Prix Détectés ({parsedItems.length} articles)
                </h4>
                <span className="text-xs text-amber-400 font-medium">
                  {taxMode === 'ht' ? 'Prix HT saisis' : `Prix HT calculés (TVA ${tvaRate}%)`}
                </span>
              </div>

              <div className="max-h-60 overflow-y-auto border border-slate-800 rounded-xl bg-slate-950">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/90 text-slate-400 font-semibold sticky top-0 border-b border-slate-800">
                    <tr>
                      <th className="p-2.5">Désignation</th>
                      <th className="p-2.5">Unité</th>
                      <th className="p-2.5 text-right">TVA</th>
                      <th className="p-2.5 text-right">Ancien Prix HT</th>
                      <th className="p-2.5 text-right text-amber-400">Nouveau Prix HT</th>
                      <th className="p-2.5 text-right text-emerald-400">Prix TTC</th>
                      <th className="p-2.5 text-center">Correspondance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {parsedItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-900/50">
                        <td className="p-2.5 font-medium text-white max-w-xs truncate">{item.nameFr}</td>
                        <td className="p-2.5 text-slate-400">{item.unit}</td>
                        <td className="p-2.5 text-right text-slate-400 font-mono">{item.tvaRate}%</td>
                        <td className="p-2.5 text-right text-slate-400 font-mono">
                          {item.oldPriceTnd !== undefined ? `${item.oldPriceTnd.toFixed(3)} TND` : '-'}
                        </td>
                        <td className="p-2.5 text-right font-bold text-amber-400 font-mono">
                          {item.newPriceTnd.toFixed(3)} TND
                        </td>
                        <td className="p-2.5 text-right font-semibold text-emerald-400 font-mono">
                          {item.unitPriceTtc ? `${item.unitPriceTtc.toFixed(3)} TND` : '-'}
                        </td>
                        <td className="p-2.5 text-center">
                          {item.matchedRateId ? (
                            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full text-[10px] font-bold">
                              ✓ Lié ({item.matchedRateId})
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded-full text-[10px]">
                              Nouvel article
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Row errors */}
              {rowErrors.length > 0 && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                  <div className="flex items-center gap-2 text-xs font-bold text-red-300 mb-1.5">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span>{rowErrors.length} ligne(s) ignorée(s) — non importées :</span>
                  </div>
                  <ul className="text-[11px] text-red-300/90 space-y-1 max-h-32 overflow-y-auto">
                    {rowErrors.slice(0, 10).map((err, idx) => (
                      <li key={idx}>Ligne {err.row} : {err.reason}</li>
                    ))}
                    {rowErrors.length > 10 && (
                      <li className="text-slate-400">… et {rowErrors.length - 10} autre(s) erreur(s).</li>
                    )}
                  </ul>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Validation automatique DTU 25.41 & Conformité fiscale 2026</span>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={handleApply}
                    className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-bold rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {`Importer les lignes valides (${parsedItems.length}) — Mettre à Jour le Calculateur`}
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
