/**
 * Phase C — Shared Smart-Mapping Catalog Import Pipeline
 *
 * ONE pipeline used by ALL catalog import entry points:
 *
 *   CSV (.csv)  ─┐
 *   XLSX (.xlsx) ─┤→ Parser → Column Detection → Smart Mapping →
 *                 │   Canonical Normalization → Validation →
 *                 └─ Existing catalog commit (trades + materials + prices)
 *
 * - Extracted from the Phase A `POST /catalog/import-csv` route so the CSV
 *   endpoint, the Phase C preview and the Phase C import all run the SAME
 *   business logic (no duplication).
 * - The external HTTP contract of the Phase A endpoint is UNCHANGED: the
 *   alias table below is a SUPERSET of the Phase A aliases and the row
 *   validation messages are byte-identical.
 * - Mapping is GENERIC: header suggestions come from a canonical field
 *   registry (aliases + keywords), never from a hardcoded supplier list.
 * - Canonical internal fields (Phase C):
 *     material_code*, material_name*, trade_code*, price_ht*,
 *     trade_name, unit, tva_rate, currency, market, source
 *   (* = required). `source` is always OFFICIAL_DEFAULT in this pipeline.
 *   `currency` / `market` are PER-ROW values: when a row's own cell carries a
 *   valid ISO currency / country code it is PRESERVED verbatim (the row is
 *   never coerced nor rejected for it); the file-level selection made in the
 *   Admin UI is only a FALLBACK used when the row (or the whole column) has no
 *   value. No currency is ever silently converted (see `ValidImportRow`).
 */
import { getDatabase } from '../db/client';
import { roundMoney } from '../utils/validation';
import { upsertTradeByCode, OFFICIAL_TRADES } from '../repositories/tradeRepository';
import { upsertMaterialByCode, findOfficialMaterialByCode } from '../repositories/drizzleMaterialRepository';
import { calcRepository } from '../repositories/calcRepository';
import { upsertOfficialPrice } from '../repositories/drizzlePriceRepository';
import { catalogContentHash, normalizeCountryCode } from './countryCatalogService';
import { tradeMetreElements, calcRules, materialCalcLinks } from '../db/schema';
import { findTradeByCode } from '../repositories/drizzleTradeRepository';
import { upsertTradeMetreElement } from '../repositories/drizzleTradeMetreElementRepository';
import { isValidMetreElementShape } from '../../src/data/metreElements';
import * as crypto from 'crypto';

// ── Limits ───────────────────────────────────────────────────────────────────
export const IMPORT_MAX_ROWS = 1000;

// ── P1 — Explicit default trade (files with no trade column) ────────────────
// Excluded from the 2-3 character material/market code validation: trade codes
// may be any non-empty slug (e.g. 'hvac', 'Installation Chauffroie') — only
// empty values are refused.
export function extractDefaultTrade(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw).trim();
  return value === '' ? undefined : value;
}

// ── Review sentinel (rows with NO trusted métier) ───────────────────────────
// Stored VERBATIM on the row (`ValidImportRow.trade` + the review note) so an
// unreviewed row stays identifiable, but it is NEVER registered as a métier:
// `commitValidRows` reuses an existing `trades` row for it when one exists and
// never creates a new one, and such a row never receives a `trade_id`.
export const UNMAPPED_REVIEW_TRADE = 'unmapped_review';

// ── Canonical field registry ────────────────────────────────────────────────
// `aliases` are exact matches on the NORMALIZED header (accents stripped,
// lowercase, spaces→underscores). `keywords` drive the generic suggestion
// fallback for supplier files whose headers are not known aliases.
//
// The registry is the ONLY place a new semantic field is declared. `/preview`
// publishes it to the Admin UI and the pipeline maps/validates it — adding a
// new file shape NEVER requires a second list to be updated (and never an
// `if (file === ...)` branch).
//
// Two GENERIC safeguards make the detection follow the MEANING OF THE DATA and
// not only the column spelling:
//  • `excludeTokens` — a keyword-scored candidate is refused when its header
//    says the values are something else (`prix_ttc` / `date_prix` / `url_prix`
//    are NEVER the HT price, even though they contain the token `prix`).
//    EXACT aliases are unaffected: they are explicit, documented spellings.
//  • `valueKind` + the file VALUE PROFILES (below) — a column whose sampled
//    values are all links can never be auto-mapped to a text/numeric field.
//    Both rules only ever REFUSE an auto-suggestion; an explicit Admin mapping
//    always wins, and nothing is ever invented in place of a refused value.
export interface CanonicalFieldDef {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
  keywords: string[];
  /** Header tokens that mean "this column is NOT this field" (keyword path only). */
  excludeTokens?: string[];
  /** Shape the VALUES must have. Default `text`. */
  valueKind?: 'text' | 'numeric' | 'url' | 'date';
  /** For `valueKind: 'url'`: header tokens marking a MEDIA link (never the source page). */
  mediaTokens?: string[];
  /**
   * Exact aliases accepted ONLY when the column's sampled values ALL match the
   * Trade Registry (`isTradeReliableColumn`). Used for generic ERP headers
   * (`department`, `product_group`) that name a métier only when the DATA
   * proves it; documented spellings (`trade`, `metier`…) never need the proof.
   */
  registryGatedAliases?: string[];
  /** Fixed value that cannot be mapped from a column (e.g. source). */
  fixedValue?: string;
}

export const CANONICAL_FIELDS: CanonicalFieldDef[] = [
  {
    key: 'material_code',
    label: 'Référence matériau (code stable)',
    required: true,
    aliases: [
      'material_code', 'materialcode', 'code_materiau', 'materiau_code', 'code_matiere',
      'reference', 'references', 'reference_code', 'code_reference', 'code', 'ref', 'sku', 'sku_code',
      'item_ref', 'numero_article', 'n_article', 'product_number', 'item_number',
      'article', 'code_article', 'article_code', 'code_produit', 'produit_code', 'item_code',
      'product_code', 'رمز_المادة', 'كود_المادة', 'المرجع', 'رمز_السلعة', 'الرمز', 'كود',
      // ── Supplier/ERP identity spelling (EN / FR / AR) ─────────────────────
      // A very common export names the stable material reference `product_id`
      // (or `item_id` / `produit_id`). Without these EXACT aliases the greedy
      // pass scored `product_id` by keyword only (token `product` = 2 points),
      // which tied with `product_name`/`product_price` for the same field →
      // correctly refused as ambiguous → the Admin preview showed
      // « material_code — Non mappé » and the file could not be imported
      // properly. Exact aliases are score 1000 and can never be ambiguous.
      // `normalizeHeader` folds case/accents/BOM/whitespace/punctuation, so
      // `Product-ID`, `product id`, `PRODUCT_ID` all resolve here.
      'product_id', 'productid', 'produit_id', 'id_produit', 'product_ref', 'productref',
      'reference_produit', 'ref_produit', 'product_sku', 'sku_produit', 'item_id', 'itemid',
      'id_article', 'article_id', 'no_produit', 'numero_produit', 'code_fournisseur',
      'معرف_المنتج', 'رقم_المنتج', 'رمز_المنتج', 'كود_المنتج', 'مرجع_المنتج',
      // ── Global Catalog v2 identity spelling (2026-10-02) ──────────────────
      // `identifier_value` is the stable identifier a Global Catalog v2 export
      // carries (alongside `identifier_type`). As an EXACT alias (score 1000)
      // it can never be ambiguous, and it removes the false block « material_code
      // non mappé » for such files. The VALUE is never invented: when the cells
      // are empty the existing contract applies unchanged
      // (`generateMaterialCode` + « Generated material_code from material name »).
      'identifier_value'
    ],
    // `id` is a KEYWORD (generic score 2), never an exact alias: a bare `id`
    // column is accepted as the reference ONLY when the file has no real
    // reference column (`reference`, `product_id`, `sku`, … score 1000), so it
    // can never steal the field from a documented spelling.
    keywords: ['reference', 'code', 'ref', 'sku', 'article', 'produit', 'product', 'item', 'id', 'رمز', 'مرجع', 'كود'],
  },
  {
    key: 'material_name',
    label: 'Désignation matériau',
    required: true,
    aliases: [
      'material_name', 'materialname', 'nom_materiau', 'materiau_nom', 'nom_matiere', 'nom',
      'name', 'name_fr',
      // `nom_fr` and its family are the FRENCH designation spellings (the
      // mirror of the `name_en`/`nom_anglais` EN family). Declared BEFORE
      // `name_en`: a file carrying both columns keeps the French name as the
      // primary designation, and the per-row fallback chain (see
      // `nameFallbackHeaders`) serves the other column row by row.
      'nom_fr', 'nom_francais', 'french_name', 'name_french',
      'name_en', 'name_eng', 'english_name', 'nom_en', 'nom_anglais',
      'nom_anglaise', 'designation_en', 'libelle_en', 'product_name_en', 'item_name_en',
      'material_name_en', 'title_en',
      'designation', 'designations', 'libelle', 'libeles',
      'nom_produit', 'produit_nom', 'produit', 'item_name', 'product_name',
      // Plurals actually found in supplier bulletins (e.g. the Hong Kong Census
      // export uses a `Materials` header for the designation column). Exact
      // aliases only — they can never create ambiguity.
      'materials', 'materiaux', 'produits', 'products',
      // `title` / `titre` and their supplier spellings are the designation of
      // the product in scraper and e-commerce exports (documented spelling,
      // NOT a guess — the same requirement `product_name` answers for ERPs).
      // Declaration order keeps a scraped `title` ABOVE a `description`
      // column: the title IS the product's name, the description is text
      // about it (both present → the title wins, whatever the column order).
      'title', 'titles', 'product_title', 'item_title', 'article_title', 'nom_article',
      'titre', 'titre_produit', 'intitule', 'libelle_produit',
      'عنوان_المنتج', 'العنوان', 'عنوان',
      'description', 'descriptions',
      'اسم_المادة', 'اسم_المنتج', 'التعيين', 'الوصف', 'البيان', 'التسمية', 'المادة'
    ],
    keywords: ['designation', 'nom', 'name', 'libelle', 'label', 'description', 'materiau', 'material', 'produit', 'title', 'titre', 'اسم', 'تعيين', 'وصف', 'بيان', 'عنوان'],
    // A link, a picture, a phone number, a date or a price is never a name.
    excludeTokens: ['url', 'uri', 'link', 'lien', 'href', 'image', 'img', 'photo', 'logo', 'date', 'heure', 'time', 'email', 'telephone', 'phone', 'tel', 'prix', 'price', 'tarif'],
  },
  {
    key: 'trade_code',
    label: 'Métier (code)',
    required: true,
    aliases: [
      'trade_code', 'tradecode', 'trade', 'trades', 'categorie_metier', 'metier', 'metiers',
      'trade_name', 'metier_code', 'code_metier', 'المهنة', 'كود_المهنة', 'رمز_المهنة', 'الحرفة', 'التخصص',
      // `department` is a GATED alias (see `registryGatedAliases`): the header
      // alone is never enough — EVERY sampled value of the column must resolve
      // to a Trade Registry identity, otherwise the column stays unmapped (a
      // trade is NEVER invented from a grouping name such as
      // 'Building Materials'). `product_group` is deliberately NOT an alias at
      // all (not even a gated one): a product grouping ('Cement & Binders'…)
      // may never be used as a métier, whatever its values look like.
      'department'
    ],
    keywords: ['categorie', 'category', 'trade', 'metier', 'famille', 'rayon', 'groupe', 'activite', 'مهنة', 'حرفة', 'تخصص'],
    registryGatedAliases: ['department'],
  },
  {
    key: 'price_ht',
    label: 'Prix HT',
    required: true,
    valueKind: 'numeric',
    aliases: [
      'price_ht', 'priceht', 'prix_ht', 'prixht', 'prix_tnd_ht', 'prix_ht_tnd', 'prix_tnd',
      'prix', 'price', 'price_sar', 'prix_sar', 'price_tnd', 'prices', 'unit_price', 'unitprice', 'prix_unitaire',
      'pu_ht', 'puht', 'montant', 'tarif', 'prix_unitaire_ht', 'prix_achat', 'prix_vente',
      'cost', 'unit_cost', 'cost_price', 'prix_cout', 'cout',
      // ERP/e-commerce "current" cost spelling (same cost family): a
      // `current_cost` column IS the purchase price of the row.
      'current_cost',
      'hk$', '$', '€', '£', 'hkd', 'السعر', 'الثمن', 'سعر_الوحدة', 'السعر_دون_اداء', 'السعر_الصافي', 'الثمن_دون_اداء'
    ],
    keywords: ['prix', 'price', 'ht', 'unitaire', 'montant', 'tarif', 'سعر', 'ثمن'],
    // A header that NAMES another meaning is never grabbed as the HT price,
    // even when it also contains `prix`/`price`: TTC ≠ HT, a date, a link, a
    // quantity, a coefficient, a discount or a reference are NOT prices.
    excludeTokens: [
      'ttc', 'taxe', 'tva', 'htva', 'url', 'uri', 'link', 'lien', 'href', 'image', 'img',
      'photo', 'date', 'heure', 'time', 'quantite', 'qte', 'qty', 'nombre', 'coef',
      'coefficient', 'remise', 'discount', 'total', 'id', 'code', 'reference', 'statut',
      'status', 'note', 'commentaire', 'description', 'عنوان', 'رابط', 'تاريخ', 'كمية',
      'حالة', 'ضريبة', 'وصف',
    ],
  },
  // ── DYNAMIC MÉTRÉ — OPTIONAL element metadata (Phase 1, data-driven) ──────
  // NEVER required: a catalogue WITHOUT these columns imports exactly as
  // before and its métier falls back to the `METRE_ELEMENTS` config registry.
  // Declared right after the 4 required fields (before every optional price
  // field) and scored ONLY against the token `metre`, so greedy auto-mapping
  // can never steal a legacy header (no `metre` token in old catalogues).
  // `method` / `qty_unit` are read as-is — NEVER inferred from `unit` or
  // `category` (see normalizeAndValidateRows).
  { key: 'metre_element_id', label: 'Code élément de métré — optionnel', required: false, aliases: ['metre_element_id', 'metrelementid', 'metre_element_code', 'metrelementcode', 'element_code', 'code_element', 'metre_code', 'رمز_عنصر_المتراج', 'عنصر_المتراج'], keywords: ['metre'] },
  { key: 'metre_element_label_fr', label: 'Libellé élément (FR) — optionnel', required: false, aliases: ['metre_element_fr', 'metrelementfr', 'metre_element_label_fr', 'element_label_fr', 'metre_label_fr'], keywords: ['metre'] },
  { key: 'metre_element_label_ar', label: 'Libellé élément (AR) — optionnel', required: false, aliases: ['metre_element_ar', 'metrelementar', 'metre_element_label_ar', 'element_label_ar', 'metre_label_ar', 'اسم_عنصر_المتراج', 'بيان_عنصر_المتراج'], keywords: ['metre'] },
  { key: 'metre_method', label: 'Méthode de métré — optionnel', required: false, aliases: ['metre_methode', 'metremethode', 'metre_method', 'metremethod', 'methode_metre', 'طريقة_المتراج', 'طريقة_القياس'], keywords: ['metre'] },
  { key: 'metre_dims', label: 'Dimensions (JSON) — optionnel', required: false, aliases: ['metre_dims', 'metredims', 'metre_dimensions', 'metre_dimension', 'ابعاد_المتراج', 'ابعاد'], keywords: ['metre'] },
  { key: 'metre_calc', label: 'Calcul de quantité (JSON) — optionnel', required: false, aliases: ['metre_calcul', 'metrecalcul', 'metre_calc', 'metrecalc', 'حساب_المتراج', 'معادلة_المتراج'], keywords: ['metre'] },
  { key: 'metre_qty_unit', label: 'Unité de quantité — optionnel', required: false, aliases: ['metre_qty_unit', 'metrequantityunit', 'metre_unite_quantite', 'qty_unit', 'وحدة_كمية_المتراج', 'وحدة_المتراج'], keywords: ['metre'] },
  // ── P1 — ENRICHED MÉTRÉ METADATA (optional) ────────────────────────────────
  // Read ONLY when the file EXPLICITLY carries the column — NEVER inferred
  // from trade / category / unit / material / price. An invalid value never
  // enters `metre` (dropped + review note; never repaired, never invented).
  // Exact aliases are explicit statements of the column's role; the keyword
  // tokens are deliberately narrow so a legacy header is never stolen (a file
  // without these columns imports exactly as before).
  { key: 'waste_percent', label: 'Taux de perte (%) — optionnel', required: false, aliases: ['waste_percent', 'waste_pct', 'wastepct', 'taux_perte', 'perte_pct', 'pourcentage_perte', 'نسبة_الهدر', 'نسبة_الفقد'], keywords: ['waste', 'perte', 'dechet'], valueKind: 'numeric' },
  { key: 'layers', label: 'Nombre de couches — optionnel', required: false, aliases: ['layers', 'nombre_couches', 'nb_couches', 'num_couches', 'couches', 'عدد_الطبقات', 'الطبقات'], keywords: ['layers', 'couches'], valueKind: 'numeric' },
  { key: 'coverage_per_product_unit', label: 'Couverture par unité produit (JSON) — optionnel', required: false, aliases: ['coverage_per_product_unit', 'coverageperproductunit', 'coverage_unit', 'couverture_par_unite', 'couverture_unite'], keywords: ['coverage', 'couverture'] },
  { key: 'yield_per_unit', label: 'Rendement par unité (JSON) — optionnel', required: false, aliases: ['yield_per_unit', 'yieldperunit', 'rendement_par_unite', 'rendement_unite'], keywords: ['yield', 'rendement'] },
  { key: 'openings', label: 'Ouvertures (JSON) — optionnel', required: false, aliases: ['openings', 'opening', 'ouvertures', 'ouverture'], keywords: ['openings', 'ouverture'] },
  { key: 'deductions', label: 'Déductions (JSON) — optionnel', required: false, aliases: ['deductions', 'deduction', 'deduites', 'deductions_metre'], keywords: ['deductions', 'deduction'] },
  { key: 'material_bindings', label: 'Liaisons matériaux (JSON) — optionnel', required: false, aliases: ['material_bindings', 'materialbindings', 'liaisons_materiau', 'liaisons_materiaux', 'liens_materiau'], keywords: ['bindings'] },
  { key: 'service_bindings', label: 'Liaisons services (JSON) — optionnel', required: false, aliases: ['service_bindings', 'servicebindings', 'liaisons_service', 'liens_service'], keywords: ['bindings'] },
  { key: 'linked_slot_code', label: 'Code de slot lié — optionnel', required: false, aliases: ['linked_slot_code', 'linkedslotcode', 'slot_code', 'code_slot', 'linked_slot'], keywords: ['slot'] },
  {
    key: 'trade_name',
    label: 'Métier (libellé) — optionnel',
    required: false,
    aliases: ['trade_name', 'nom_metier', 'libelle_metier', 'metier_libelle', 'trade_label', 'اسم_المهنة', 'تسمية_المهنة', 'عنوان_المهنة'],
    // NO bare `nom`/`label` keyword here: a column named `Nom_Arabe`,
    // `Nom produit` or `Label` is a NAME, not the label of a métier. The trade
    // label must carry a métier word (metier / trade / libellé + métier …).
    keywords: ['metier', 'trade', 'libelle_metier', 'مهنة'],
    excludeTokens: ['arabe', 'arabic', 'ar', 'materiau', 'material', 'produit', 'product', 'item', 'article', 'sku', 'prix', 'price', 'عربي', 'مادة', 'منتج'],
  },
  {
    key: 'category',
    label: 'Catégorie matériau — optionnel',
    required: false,
    // `subcategory` family (`subcategory`/`sous_categorie`…): a documented
    // category spelling too — a true `category` column always wins (declared
    // first, exact-alias declaration order); a subcategory-only file still
    // maps instead of staying blocked.
    aliases: ['category', 'categories', 'categorie', 'material_category', 'product_category', 'categorie_produit', 'famille', 'famille_produit', 'category_name', 'subcategory', 'sub_category', 'sous_categorie', 'sous_categorie_produit', 'sub_categorie', 'subcategory_name', 'الصنف', 'الفئة', 'التصنيف', 'صنف_المادة', 'عائلة_المنتج'],
    keywords: ['category', 'categorie', 'famille', 'صنف', 'فئة', 'تصنيف', 'عائلة'],
  },
  {
    key: 'unit',
    label: 'Unité — optionnel',
    required: false,
    aliases: ['unit', 'units', 'unite', 'unites', 'unite_mesure', 'base_unit', 'mesure', 'uom',
      'measure_unit', 'unit_of_measure', 'uom_code', 'unite_vente', 'sales_unit', 'selling_unit',
      'purchase_unit',
      'الوحدة', 'وحدة_القياس', 'وحدة', 'وحدة_البيع'],
    keywords: ['unite', 'unit', 'mesure', 'uom', 'وحدة', 'قياس'],
  },
  {
    key: 'tva_rate',
    label: 'Taux TVA — optionnel',
    required: false,
    aliases: ['tva_rate', 'tvarate', 'taux_tva', 'tauxtva', 'tva', 'vat', 'tax', 'taxes', 'taux', 'الاداء_على_القيمة_المضافة', 'نسبة_الاداء', 'الضريبة'],
    keywords: ['tva', 'vat', 'tax', 'taux', 'ضريبة', 'اداء'],
  },
  {
    key: 'currency',
    label: 'Devise — optionnel',
    required: false,
    aliases: ['currency', 'currencies', 'devise', 'devises', 'monnaie', 'monnaies', 'currency_code', 'code_devise', 'devise_code', 'العملة', 'رمز_العملة'],
    keywords: ['currency', 'devise', 'monnaie', 'عملة'],
  },
  {
    key: 'market',
    label: 'Marché (pays) — optionnel',
    required: false,
    aliases: ['market', 'markets', 'marche', 'marches', 'pays', 'country', 'country_code', 'code_pays', 'pays_code', 'البلد', 'الدولة', 'السوق'],
    keywords: ['market', 'marche', 'pays', 'country', 'بلد', 'دولة', 'سوق'],
  },
  {
    key: 'name_ar',
    label: 'Nom (AR) — optionnel',
    required: false,
    aliases: ['name_ar', 'nom_arabe', 'arabe', 'arabic_name', 'nom_ar', 'ar_name', 'name_arabe',
      'product_name_ar', 'item_name_ar', 'material_name_ar', 'designation_arabe', 'libelle_arabe',
      'designation_ar', 'الاسم_بالعربية', 'الاسم_عربي', 'الاسم_بالعربي'],
    keywords: ['arabe', 'arabic', 'ar', 'عربي'],
  },
  {
    key: 'name_en',
    label: 'Nom (EN) — optionnel',
    required: false,
    aliases: ['name_en', 'name_eng', 'english_name', 'nom_en', 'nom_anglais',
      'nom_anglaise', 'designation_en', 'libelle_en', 'product_name_en', 'item_name_en',
      'material_name_en', 'title_en', 'name_english', 'english', 'anglais'],
    keywords: ['anglais', 'english', 'en'],
  },
  {
    key: 'note',
    label: 'Note technique — optionnel',
    required: false,
    aliases: ['note_technique', 'note', 'notes', 'technical_specs', 'specs', 'specification', 'ملاحظة', 'المواصفات_الفنية', 'ملاحظات'],
    keywords: ['note', 'spec', 'technique', 'description_detail', 'ملاحظة', 'مواصفات'],
  },
  // A supplier/brand column names WHERE the row was read from. Slugified by
  // the pipeline and auto-provisioned in `price_sources`, so any scraper or
  // supplier value is storable without a code change (`if (source === ...)`).
  { key: 'source', label: 'Source — optionnel', required: false, aliases: ['source', 'source_code', 'data_source', 'source_name', 'supplier_name', 'supplier_source', 'fournisseur', 'supplier', 'marque', 'brand', 'fabricant', 'manufacturer', 'المزود', 'المصدر', 'العلامة'], keywords: ['source', 'supplier', 'fournisseur', 'marque', 'brand', 'مزود', 'مصدر'] },
  // ── SOURCE URL — the link a row was read from (scraper / supplier sheet) ──
  // Declared AFTER `source` and given the `url` value kind: a link column is a
  // SOURCE LINK, never a name, a code, a price or a date (see the generic
  // link-column rule in `scoreHeaderForField`). Media links (image/photo/PDF…)
  // are excluded by `mediaTokens` — they are not the page the row came from.
  {
    key: 'source_url',
    label: 'URL source (lien de la fiche) — optionnel',
    required: false,
    valueKind: 'url',
    aliases: [
      'source_url', 'sourceurl', 'url', 'urls', 'link', 'lien', 'href', 'page_url',
      'product_url', 'product_link', 'item_url', 'article_url', 'reference_url',
      'fiche_url', 'fiche_produit', 'product_page', 'official_url', 'site_url', 'website',
      'web_url', 'external_url', 'source_link', 'url_source', 'lien_source',
      'الرابط', 'رابط_المنتج', 'رابط_المرجع', 'رابط_المصدر', 'رابط_الصفحة', 'العنوان_الرابط'
    ],
    keywords: ['url', 'uri', 'href', 'link', 'lien', 'رابط'],
    mediaTokens: ['image', 'img', 'photo', 'picture', 'logo', 'thumb', 'thumbnail', 'miniature', 'avatar', 'capture', 'video', 'icon', 'attach', 'attachment', 'fichier', 'file', 'doc', 'pdf', 'download', 'telechargement'],
  },
  { key: 'effective_from', label: 'Date de début — optionnel', required: false, aliases: ['effective_from', 'date_debut', 'valid_from', 'start_date', 'تاريخ_البدء', 'بداية_الصلاحية'], keywords: ['effective', 'debut', 'start', 'from', 'بدء', 'بداية'] },
  { key: 'effective_to', label: 'Date de fin — optionnel', required: false, aliases: ['effective_to', 'date_fin', 'valid_to', 'end_date', 'تاريخ_الانتهاء', 'نهاية_الصلاحية'], keywords: ['effective', 'fin', 'end', 'to', 'انتهاء', 'نهاية'] },
  { key: 'observed_at', label: 'Date observée — optionnel', required: false, aliases: ['observed_at', 'observed', 'date_observation', 'imported_at', 'تاريخ_الملاحظة'], keywords: ['observed', 'observation', 'importe'] },
  {
    key: 'status',
    label: 'Statut — optionnel',
    required: false,
    aliases: ['status', 'statut', 'state', 'etat', 'الحالة', 'الوضعية'],
    keywords: ['status', 'statut', 'etat', 'حالة'],
    // A PRICE-TAX header (`price_tax_status` = TTC/HT) is never a row status:
    // auto-mapping it stored « ttc » into the status field (wrong meaning).
    // This veto only REFUSES the suggestion — the column stays « read but not
    // used » and an explicit Admin mapping still wins. NO price value is ever
    // converted, recomputed or touched by this rule.
    excludeTokens: ['price', 'prix', 'tax', 'ttc'],
  },
];

export const REQUIRED_FIELD_KEYS = CANONICAL_FIELDS.filter((f) => f.required).map((f) => f.key);
/** `source` is fixed by the official-price pipeline — never file-mapped. */
export const FIXED_SOURCE = 'OFFICIAL_DEFAULT';
/**
 * The Admin Smart-Mapping field list, derived FROM THE REGISTRY (never a second
 * hardcoded copy): a field declared above automatically appears in the Admin
 * mapping panel, so a new file shape is supported by ONE declaration only.
 */
export const PREVIEW_FIELDS = CANONICAL_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required }));

export function normalizeHeader(header: string): string {
  return String(header ?? '')
    .replace(/^[\uFEFF\u200B\u200C\u200D\u200E\u200F]+/, '')
    // camelCase / PascalCase exports (API + scraper JSON→CSV, ERPs): fold the
    // word boundaries into the same separator BEFORE the case is dropped, so
    // `observedAt`, `observed_at` and `Observed At` are ONE identical spelling.
    // Only DIRECT adjacency counts, so `Prix_HT`, `Product-ID` and accented
    // text keep their previous normalized form byte-for-byte.
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove latin diacritics
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove arabic tashkeel / harakat
    .replace(/[\u0622\u0623\u0625]/g, '\u0627') // normalize arabic alef variants to bare alef
    .replace(/\u0629/g, '\u0647') // normalize teh marbuta to heh
    .replace(/\u0649/g, '\u064A') // normalize alef maksura to yeh
    .toLowerCase()
    .trim()
    .replace(/[\s.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Accepts "31,5" / "31.5" / "1 500,25" — returns null when not numeric. */
export function parseImportPrice(raw: string): number | null {
  const cleaned = String(raw ?? '').trim().replace(/\s/g, '').replace(/,/g, '.');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Accepts "19" / "19,0" / "7" — returns null when not a valid rate (0..100). */
function parseTvaRate(raw: string): number | null {
  const value = parseImportPrice(raw);
  if (value === null) return null;
  if (value < 0 || value > 100) return null;
  return value;
}

function slugifyIdentity(s: string): string {
  return String(s ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function generateMaterialCode(nameFr: string, nameAr?: string, note?: string): string {
  const base = slugifyIdentity(nameFr || nameAr || note || 'material');
  const safeBase = base || 'material';
  const hash = crypto.createHash('sha1').update(`${nameFr || ''}|${nameAr || ''}|${note || ''}`).digest('hex').slice(0, 8);
  let code = `${safeBase}_${hash}`;
  if (code.length > 100) code = code.slice(0, 100);
  return code;
}

// ── Smart Mapping: detection + suggestion + resolution ──────────────────────

export interface DetectedColumn {
  source: string;
  sample: string;
}

/**
 * Per SOURCE column of the uploaded file: the canonical field it actually
 * feeds (or `null`) and the ROLE it plays in the import. Published to the
 * Admin UI so EVERY detected column is visibly accounted for — a header used
 * as a designation FALLBACK (`name_en`), or deliberately refused as a métier
 * (a grouping column such as `product_group`), is never left looking like an
 * unexplained « — Non mappé — ».
 */
export interface ColumnAssignment {
  /** Raw header text as found in the file. */
  source: string;
  /** Canonical field this column feeds, or null when it feeds none. */
  key: string | null;
  /** `field` = primary column of a canonical field; `name_fallback` = an
   *  ordered secondary designation column; `unmapped` = read but not used. */
  role: 'field' | 'name_fallback' | 'unmapped';
}

export interface MappingResolution {
  /** Detected columns with one sample value (for the Admin UI). */
  detectedColumns: DetectedColumn[];
  /** Generic suggestion (canonical key → source header). */
  suggestedMapping: Record<string, string>;
  /** Final mapping actually applied (suggestion + Admin overrides). */
  appliedMapping: Record<string, string>;
  /** Errors in the Admin-provided mapping (unknown header/field). */
  mappingErrors: string[];
  /** Required canonical fields without any mapped column. */
  unmappedRequired: string[];
  /**
   * CATALOG-ONLY FILE — TRUE when the file contains NO price-candidate column
   * at all (no header is a documented `price_ht` alias and none scores as the
   * price field) and no Admin override mapped `price_ht`. This is exactly the
   * « Master Catalog without prices » shape: for THIS file `price_ht` is
   * OPTIONAL — rows import as MATERIAL-ONLY (no `material_prices` write, no
   * price invented, never `0`). Any file that DOES carry a price column keeps
   * the exact previous contract: `catalogOnly` is false, `price_ht` stays a
   * blocking required field and every price cell is validated as before.
   */
  catalogOnly: boolean;
  /**
   * UNIVERSAL PER-ROW NAME FALLBACK — ordered designation columns present in
   * the file but NOT chosen as the primary `material_name` (the other
   * exact-alias designation headers, registry declaration order), followed by
   * the mapped `name_ar` column. Consumed PER ROW by
   * `normalizeAndValidateRows` only when the primary designation cell is
   * empty; empty when the file has a single designation column.
   */
  nameFallbackHeaders: string[];
  /**
   * Per SOURCE column: the canonical field it feeds + its role (see
   * `ColumnAssignment`). Purely additive display metadata — the import itself
   * runs off `appliedMapping` / `nameFallbackHeaders` only.
   */
  columnAssignments: ColumnAssignment[];
}

/** Split a normalized header into tokens ("prix_unitaire_ht" → [prix, unitaire, ht]). */
function headerTokens(normalizedHeader: string): string[] {
  // Unicode-aware split: Arabic (and any other script) tokens are kept, so the
  // documented Arabic keyword aliases are matched too. For Latin/ASCII headers
  // the result is IDENTICAL to the previous ASCII-only split (normalizeHeader
  // has already folded accents away).
  return normalizedHeader.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * ORDERED normalized alias index (memoized).
 *
 * Aliases are declared in human spelling (`Référence`, `وحدة`, `Prix HT`) while
 * the header being matched has already been passed through `normalizeHeader`.
 * Comparing the two WITHOUT normalizing the alias side silently disabled every
 * alias containing an accent, a space/dash/dot, or an Arabic letter the
 * normalizer rewrites (teh marbuta, alef variants, tashkeel) — e.g. the Arabic
 * « الوحدة » alias could never match the normalized header « الوحده », so an
 * Arabic unit column stayed « — Non mappé — ». Normalizing BOTH sides fixes that
 * and only ADDS matches (no existing alias changes identity).
 *
 * The index is kept as an ORDERED, de-duplicated list (first documented
 * spelling first). When several headers of one file are ALL exact aliases of
 * the SAME field (e.g. `name` + `name_en`, or `supplier` + `brand`), the
 * declaration order — not the file column order — decides which one the field
 * takes: a bare `name` is a clearer designation than `name_en`, and `supplier`
 * is a clearer source identity than `brand`. Implemented as a score bonus on
 * top of the exact-alias base (1000), so any exact alias still beats any
 * keyword candidate and two exact candidates can never tie (never ambiguous).
 */
let orderedAliasIndex: Map<string, string[]> | null = null;
function orderedAliasesFor(field: CanonicalFieldDef): string[] {
  if (!orderedAliasIndex) orderedAliasIndex = new Map();
  let list = orderedAliasIndex.get(field.key);
  if (!list) {
    const seen = new Set<string>();
    list = [];
    for (const alias of field.aliases) {
      const norm = normalizeHeader(alias);
      if (norm !== '' && !seen.has(norm)) {
        seen.add(norm);
        list.push(norm);
      }
    }
    orderedAliasIndex.set(field.key, list);
  }
  return list;
}

// ── VALUE PROFILES — detect by the MEANING OF THE DATA, not only the name ──
// A column name can lie, its VALUES cannot. For every column the pipeline
// samples the real file values and records how many of them are LINKS, so a
// column of URLs can never be auto-suggested as a price, a name, a code or a
// date — whatever its header says (and the reverse: a `Prix` header holding
// only links is refused and reported, never turned into a price).
export interface ColumnProfile {
  /** Number of sampled non-empty values. */
  nonEmpty: number;
  /** Number of sampled non-empty values that are links. */
  linkCount: number;
  /** Number of sampled non-empty values that parse as a number (price syntax). */
  numericCount: number;
  /** Number of sampled non-empty values matching a Trade Registry identity. */
  tradeLikeCount: number;
}

export const EMPTY_COLUMN_PROFILE: ColumnProfile = { nonEmpty: 0, linkCount: 0, numericCount: 0, tradeLikeCount: 0 };

// ── TRADE REGISTRY — the canonical métier identities of the platform ────────
// `OFFICIAL_TRADES` codes + their FR/AR/Derja labels, plus the documented
// dynamic métier `aluminium`. A GENERIC ERP header (`department`,
// `product_group`…) is trusted as a métier column only when its sampled
// VALUES all speak the registry's language; otherwise the column stays
// unmapped and the explicit admin `defaultTrade` (or the per-row review
// sentinel) applies — a trade is never invented from a grouping name.
const TRADE_REGISTRY_KEYS: ReadonlySet<string> = (() => {
  const keys = new Set<string>(['aluminium']);
  for (const trade of OFFICIAL_TRADES) {
    for (const value of [trade.code, trade.labelFr, trade.labelAr, trade.labelDerja]) {
      const norm = normalizeHeader(value ?? '');
      if (norm !== '') keys.add(norm);
    }
  }
  return keys;
})();

/** True when the value normalizes to a known Trade Registry identity. */
export function isTradeRegistryValue(raw: unknown): boolean {
  return TRADE_REGISTRY_KEYS.has(normalizeHeader(String(raw ?? '')));
}

/** A column whose sampled values ALL match the Trade Registry (at least one). */
export function isTradeReliableColumn(profile: ColumnProfile): boolean {
  return profile.nonEmpty > 0 && profile.tradeLikeCount === profile.nonEmpty;
}

/**
 * Header tokens that UNAMBIGUOUSLY name a LINK column. Deliberately short:
 * `site`/`page` are excluded because in French `site` means the construction
 * site — those spellings are handled as explicit `source_url` aliases instead
 * of being allowed to veto other fields.
 */
const LINK_HEADER_TOKENS = ['url', 'urls', 'uri', 'href', 'link', 'lien', 'رابط'];

/**
 * Conservative link test. A value counts as a link ONLY when it is explicitly
 * address-shaped, so `4.1/m2`, `BA13.STD`, `2026/01/05`, `1 500,25` or `m²`
 * are never mistaken for links:
 *   `scheme://…` (http, https, ftp…), `www.host.tld[/…]`, `host.tld/…`
 * A bare `host.tld` without a path is deliberately NOT treated as a link (it is
 * indistinguishable from a dotted code) — such a column is still caught by its
 * header tokens.
 */
export function isUrlLikeValue(raw: unknown): boolean {
  const text = String(raw ?? '').trim();
  if (!text || /\s/.test(text)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return true;
  if (/^www\.[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(text)) return true;
  return /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*\.[a-z]{2,}\/\S*$/i.test(text);
}

/** Profile every column from the sampled rows (pure, no I/O). */
function buildColumnProfiles(
  headers: string[],
  sampleRows: Array<Record<string, string>>,
  maxRows = 50
): Map<string, ColumnProfile> {
  const profiles = new Map<string, ColumnProfile>();
  for (const header of headers) {
    const profile: ColumnProfile = { nonEmpty: 0, linkCount: 0, numericCount: 0, tradeLikeCount: 0 };
    for (const row of sampleRows.slice(0, maxRows)) {
      const value = String(row?.[header] ?? '').trim();
      if (value === '') continue;
      profile.nonEmpty += 1;
      if (isUrlLikeValue(value)) profile.linkCount += 1;
      if (parseImportPrice(value) !== null) profile.numericCount += 1;
      if (isTradeRegistryValue(value)) profile.tradeLikeCount += 1;
    }
    profiles.set(header, profile);
  }
  return profiles;
}

/** A column whose sampled values are ALL links (at least one value). */
export function isLinkColumn(profile: ColumnProfile): boolean {
  return profile.nonEmpty > 0 && profile.linkCount === profile.nonEmpty;
}

/**
 * Keyword / exclusion / media token lists, normalized ONCE (memoized).
 *
 * Same reasoning as the alias index above: header tokens come out of
 * `normalizeHeader`, so a declared keyword written with an accent, a space or an
 * Arabic letter the normalizer rewrites (`ضريبة`, `وحدة`, `Matériel`) would never
 * match and would silently disable the rule. Normalizing the declaration side
 * only ADDS matches — Latin keywords are already in normalized form.
 */
const normalizedTokenCache = new Map<string, string[]>();
function normalizedTokenList(
  field: CanonicalFieldDef,
  kind: 'keywords' | 'excludeTokens' | 'mediaTokens' | 'registryGatedAliases'
): string[] {
  const cacheKey = `${kind}:${field.key}`;
  let cached = normalizedTokenCache.get(cacheKey);
  if (!cached) {
    cached = (field[kind] ?? []).map((t) => normalizeHeader(t)).filter((t) => t !== '');
    normalizedTokenCache.set(cacheKey, cached);
  }
  return cached;
}

/**
 * Exact-alias score with DECLARATION-ORDER precedence: the first documented
 * spelling of a field beats a later one (`name` > `name_en`, `supplier` >
 * `brand`), independent of the file column order. Returns 0 when the header
 * is not an exact alias. The 1000 base keeps every exact alias above every
 * keyword candidate; the position bonus makes two exact candidates score
 * differently so they can never be reported as ambiguous.
 */
function exactAliasScore(field: CanonicalFieldDef, normalizedHeader: string): number {
  const aliases = orderedAliasesFor(field);
  const index = aliases.indexOf(normalizedHeader);
  return index < 0 ? 0 : 1000 + (aliases.length - index);
}

/**
 * Generic keyword scoring: exact alias match beats keywords; keyword matches
 * are deterministic (field registry order breaks ties). This is NOT a
 * supplier-specific table — it works for any external file.
 *
 * The GENERIC VETOES below keep the detection honest about the MEANING of the
 * column. They can only ever REFUSE an auto-suggestion (the field then stays
 * « Non mappé » for the Admin to decide) — they never invent a value and they
 * never override an explicit Admin mapping (applied downstream in
 * `resolveMapping`), so a legitimately unusual file remains importable.
 */
function scoreHeaderForField(
  field: CanonicalFieldDef,
  normalizedHeader: string,
  profile: ColumnProfile = EMPTY_COLUMN_PROFILE
): number {
  const tokens = headerTokens(normalizedHeader);
  const saysLink = tokens.some((t) => LINK_HEADER_TOKENS.includes(t));
  const saysMedia = normalizedTokenList(field, 'mediaTokens').some((t) => tokens.includes(t));
  // `valueKind: 'url'` fields are the ONLY ones a link column may satisfy, and
  // a MEDIA link (image / photo / PDF) is never the source page of a row.
  if (field.valueKind === 'url') {
    if (saysMedia) return 0;
    const aliasScore = exactAliasScore(field, normalizedHeader);
    if (aliasScore > 0) return aliasScore;
  } else {
    // A LINK column is never a name, a code, a price or a date — whatever the
    // header spelling; and a header that NAMES a link is never a text field.
    if (saysLink || isLinkColumn(profile)) return 0;
    // ── EXACT ALIASES FIRST ─────────────────────────────────────────────────
    // A documented spelling of the field (`Prix_TND_HT`, `price`, `prix`,
    // `current_cost`…) is an EXPLICIT statement of the column's ROLE, so no
    // value-shape heuristic may hide it: when a price column's cells are all
    // non-numeric, the FILE is correct and the CELLS are wrong. The normalizer
    // then rejects those ROWS individually with
    // `Invalid price '<v>' (colonne « … »).` instead of the file being
    // reported as missing the price column (a misleading schema error).
    // Nothing is invented either way: the value is never coerced and a
    // rejected row is never written.
    const aliasScore = exactAliasScore(field, normalizedHeader);
    if (aliasScore > 0) {
      // TRADE-REGISTRY GATE — a gated alias (`department`)
      // only scores when EVERY sampled value of the column matches the Trade
      // Registry; documented métier spellings stay unconditional. Like the
      // other generic vetoes, the gate can only REFUSE an auto-suggestion —
      // it never invents a value and never blocks an explicit Admin mapping.
      if (
        normalizedTokenList(field, 'registryGatedAliases').includes(normalizedHeader) &&
        !isTradeReliableColumn(profile)
      ) return 0;
      return aliasScore;
    }
    // ── KEYWORD / HEURISTIC PATH ONLY — NUMERIC FIELDS READ NUMBERS ─────────
    // Guessing that a merely price-SOUNDING column (keyword score, NO
    // documented alias) IS the price column stays allowed ONLY when its
    // sampled values really read as numbers. Otherwise the field stays
    // « Non mappé » for the Admin to decide — nothing is guessed, nothing is
    // coerced, and no value is invented.
    if (field.valueKind === 'numeric' && profile.nonEmpty > 0 && profile.numericCount === 0) return 0;
  }
  const joined = tokens.join('_');
  let score = 0;
  for (const kw of normalizedTokenList(field, 'keywords')) {
    if (tokens.includes(kw)) score += 2;
    else if (joined.includes(kw)) score += 1;
  }
  if (score === 0) return 0;
  // A header that NAMES another meaning is not this field (`prix_ttc`,
  // `date_prix`, `url_prix`…). EXACT tokens only, so `validite_prix` is never
  // vetoed by the `id` exclusion.
  if (normalizedTokenList(field, 'excludeTokens').some((t) => tokens.includes(t))) return 0;
  return score;
}

/**
 * Detect columns, build the generic suggestion and apply (optional) Admin
 * overrides. Pure function — no database, no I/O.
 *
 * @param headers         raw header texts, in file order
 * @param sampleRow       first data row (for samples), may be undefined
 * @param mappingOverride Admin mapping: canonical key → source header text
 * @param sampleRows      real file rows (up to 50 are read). Used for TWO
 *                        things: (1) displaying a REAL, non-empty value per
 *                        detected column — the first data row is often empty
 *                        for optional columns; (2) the column VALUE PROFILES
 *                        (links vs values) that make the detection follow the
 *                        MEANING of the data. Only ever used to REFUSE an
 *                        auto-suggestion, never to invent one.
 *
 * NOTE ON AMBIGUITY: when two headers legitimately compete for the SAME field
 * (e.g. `valeur_prix` and `prix_fournisseur`) the field is deliberately left
 * unmapped and the Admin maps it in the Smart Mapping step. Confirmed semantic
 * matches (aliases like `product_id`, `product_name`, FR/AR spellings) are
 * resolved by the exact-alias table above — never by a guess.
 */
export function resolveMapping(
  headers: string[],
  sampleRow: Record<string, string> | undefined,
  mappingOverride?: Record<string, string> | null,
  sampleRows?: Array<Record<string, string>> | null
): MappingResolution {
  // Real sample values of the FILE (never a fixed example): the first non-empty
  // value found in the first rows of the uploaded file for that column.
  const sampleSource: Array<Record<string, string>> =
    sampleRows && sampleRows.length > 0 ? sampleRows : (sampleRow ? [sampleRow] : []);
  const detectedColumns: DetectedColumn[] = headers.map((h) => {
    let sample = '';
    for (const row of sampleSource.slice(0, 25)) {
      const value = String(row?.[h] ?? '').trim();
      if (value !== '') { sample = value; break; }
    }
    return { source: h, sample: sample.slice(0, 60) };
  });

  // ── VALUE PROFILES: the real sampled values of each column, used to score it
  // (detection follows the MEANING of the data, not only the header spelling).
  const profiles = buildColumnProfiles(headers, sampleSource);

  // ── Suggestion: best-scoring header per canonical field (each header used once)
  // SAFETY: Ambiguous matches (two fields scoring the same top score for one header,
  // or a header scoring equal top points for multiple fields without exact alias)
  // are rejected from silent guessing to avoid silent corruption.
  const used = new Set<string>();
  const suggestedMapping: Record<string, string> = {};
  for (const field of CANONICAL_FIELDS) {
    let best: { header: string; score: number } | null = null;
    let ambiguous = false;
    for (const header of headers) {
      if (used.has(header)) continue;
      const score = scoreHeaderForField(field, normalizeHeader(header), profiles.get(header) ?? EMPTY_COLUMN_PROFILE);
      if (score > 0) {
        if (!best || score > best.score) {
          best = { header, score };
          ambiguous = false;
        } else if (best && score === best.score && score < 1000) {
          // Multiple non-exact matches with the same score: ambiguous!
          ambiguous = true;
        }
      }
    }
    // Only map if non-ambiguous and confident (score >= 2 or exact alias = 1000)
    if (best && !ambiguous && (best.score >= 2 || best.score === 1000)) {
      suggestedMapping[field.key] = best.header;
      used.add(best.header);
    }
  }

  // ── Apply the Admin override (validate it, fall back to the suggestion) ──
  // Manual mapping is a DELTA merged over the auto-suggestion (never a full
  // replacement): absent keys keep the suggestion, '' = explicit "Non mappé"
  // (required → mappingError, optional → delete). Values are matched
  // BOM/whitespace/case/diacritics-insensitively like auto-detection so a
  // visible column choice can never 404 on its own displayed name.
  const appliedMapping: Record<string, string> = { ...suggestedMapping };
  const mappingErrors: string[] = [];
  const knownKeys = new Set(CANONICAL_FIELDS.map((f) => f.key));
  const headerByNormalized = new Map<string, string>();
  for (const h of headers) {
    const norm = normalizeHeader(h);
    if (!headerByNormalized.has(norm)) headerByNormalized.set(norm, h);
  }

  if (mappingOverride && typeof mappingOverride === 'object') {
    for (const [canonicalKey, sourceHeader] of Object.entries(mappingOverride)) {
      if (!knownKeys.has(canonicalKey)) {
        mappingErrors.push(`Unknown field in mapping: '${canonicalKey}'`);
        continue;
      }
      if (sourceHeader === '' || sourceHeader === null || sourceHeader === undefined) {
        // Explicit un-mapping of an optional field is allowed.
        if (CANONICAL_FIELDS.find((f) => f.key === canonicalKey)?.required) {
          mappingErrors.push(`Required field '${canonicalKey}' cannot be un-mapped`);
          continue;
        }
        delete appliedMapping[canonicalKey];
        continue;
      }
      // Normalized match against the REAL header (same normalizer as
      // auto-detection) so BOM/case/accent/space variants always resolve.
      const resolved = headerByNormalized.get(normalizeHeader(String(sourceHeader)));
      if (!resolved) {
        mappingErrors.push(`Mapping for '${canonicalKey}' points to a column that does not exist: '${sourceHeader}'`);
        continue;
      }
      appliedMapping[canonicalKey] = resolved;
    }
  }

  const unmappedRequired = REQUIRED_FIELD_KEYS.filter((key) => !appliedMapping[key]);

  // ── CATALOG-ONLY DETECTION (Master Catalog sans colonne de prix) ──────────
  // `price_ht` becomes optional ONLY when the FILE cannot carry prices: no
  // header is a documented price alias and none scores as the price field, and
  // the Admin did not map `price_ht` manually. A merely price-SOUNDING column
  // still counts as a candidate, so an ambiguous/unmapped price column keeps
  // blocking exactly as before — nothing is guessed, nothing is relaxed for a
  // file that HAS prices. Purely derived from the headers + profiles above.
  const priceFieldDef = CANONICAL_FIELDS.find((f) => f.key === 'price_ht');
  const priceCandidatePresent =
    !!appliedMapping.price_ht ||
    (priceFieldDef !== undefined &&
      headers.some((h) =>
        scoreHeaderForField(priceFieldDef, normalizeHeader(h), profiles.get(h) ?? EMPTY_COLUMN_PROFILE) > 0
      ));
  const catalogOnly = !priceCandidatePresent;

  // ── UNIVERSAL PER-ROW NAME FALLBACK CHAIN ────────────────────────────────
  // One file can carry SEVERAL designation columns (`nom_fr`, `name_en`,
  // `name_ar`…). The exact-alias registry picks ONE primary column; the other
  // designation-family headers present in the file (registry declaration
  // order) plus the mapped `name_ar` column form the ordered fallback chain
  // consumed PER ROW by `normalizeAndValidateRows` when the primary cell is
  // empty. The mapping itself stays 1 column ↔ 1 field.
  const nameFieldDef = CANONICAL_FIELDS.find((f) => f.key === 'material_name');
  const nameFamilyAliases = nameFieldDef ? orderedAliasesFor(nameFieldDef) : [];
  const primaryNameHeader = appliedMapping.material_name;
  const primaryNameNorm = primaryNameHeader ? normalizeHeader(primaryNameHeader) : '';
  const nameFallbackHeaders: string[] = [];
  for (const alias of nameFamilyAliases) {
    if (alias === primaryNameNorm) continue;
    const raw = headerByNormalized.get(alias);
    if (raw && raw !== primaryNameHeader && !nameFallbackHeaders.includes(raw)) {
      nameFallbackHeaders.push(raw);
    }
  }
  const nameArHeader = appliedMapping.name_ar;
  if (nameArHeader && nameArHeader !== primaryNameHeader && !nameFallbackHeaders.includes(nameArHeader)) {
    nameFallbackHeaders.push(nameArHeader);
  }

  // ── PER-SOURCE-COLUMN ASSIGNMENT (display honesty) ───────────────────────
  // Every detected column is accounted for: the canonical field it feeds, or
  // its role as an ordered designation FALLBACK, or "read but not used". The
  // Admin panel lists these so a column the engine deliberately refuses (a
  // grouping column such as `product_group`) is explained instead of looking
  // like a broken mapping.
  const fieldBySource = new Map<string, string>();
  for (const [canonicalKey, header] of Object.entries(appliedMapping)) {
    if (header && !fieldBySource.has(header)) fieldBySource.set(header, canonicalKey);
  }
  const columnAssignments: ColumnAssignment[] = headers.map((header) => {
    const key = fieldBySource.get(header);
    if (key) return { source: header, key, role: 'field' as const };
    if (nameFallbackHeaders.includes(header)) return { source: header, key: null, role: 'name_fallback' as const };
    return { source: header, key: null, role: 'unmapped' as const };
  });

  return { detectedColumns, suggestedMapping, appliedMapping, mappingErrors, unmappedRequired, catalogOnly, nameFallbackHeaders, columnAssignments };
}

// ── Row normalization + validation (before ANY database write) ──────────────

export interface ValidImportRow {
  row: number;
  reference: string;
  nameFr: string;
  trade: string;
  tradeLabel?: string;
  /**
   * CATALOG-ONLY rows (file without any price column) carry NO price:
   * `undefined` is a first-class state — `0` is never invented and no
   * `material_prices` row is written for the row (see `commitValidRows`).
   * Every file that carries a price column still produces a validated number.
   */
  price?: number;
  unit: string;
  nameAr?: string;
  nameEn?: string;
  note?: string;
  tvaRate?: number;
  category?: string;
  source?: string;
  /**
   * Link the row was read from (scraper / supplier sheet), kept VERBATIM from
   * the file and only when the cell really is an address. Persisted in the
   * existing price `notes` metadata — no schema change, no invented value.
   */
  sourceUrl?: string;
  /**
   * PER-ROW MARKET / CURRENCY — the row's OWN valid file values, preserved
   * verbatim so an import never silently converts a currency or moves a price
   * to another market. Absent when the file (column or cell) provided no value,
   * in which case `commitValidRows` falls back to the file-level selection.
   */
  currencyCode?: string;
  countryCode?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  observedAt?: string;
  sourceStatus?: string;
  review?: string[];
  /**
   * DYNAMIC MÉTRÉ — optional engine-safe element metadata (Phase 1).
   * Present ONLY when the file provides a complete, valid element (shared
   * `isValidMetreElementShape` contract); NEVER inferred from unit/category.
   * Persisted by `commitValidRows` into `trade_metre_elements`.
   */
  metre?: {
    elementCode: string;
    labelFr: string;
    labelAr: string;
    method: string;
    dims: unknown;
    calc: unknown;
    qtyUnit: string;
    // ── P1 — ENRICHED MÉTRÉ METADATA (optional) ───────────────────────────────
    // Read ONLY from the file's own explicit columns (never inferred from
    // trade/category/unit/material/price) and attached only to an explicit
    // `metre_element_id` element. An invalid value never enters this row
    // (dropped with a review note — nothing is repaired or invented).
    wastePercent?: number;
    layers?: number;
    coveragePerProductUnit?: unknown;
    yieldPerUnit?: unknown;
    openings?: unknown;
    deductions?: unknown;
    materialBindings?: unknown;
    serviceBindings?: unknown;
    /** Carried on the row ONLY — NOT persisted in P1 (`TradeMetreElementInput` declares no such field). */
    linkedSlotCode?: string;
  };
}

export interface FailedRow {
  row: number;
  reference: string;
  reason: string;
}

export interface NormalizationResult {
  valid: ValidImportRow[];
  failed: FailedRow[];
}

/**
 * Normalize raw file rows (keyed by RAW header text) using the applied
 * mapping and validate EVERY row. Mirrors the Phase A validation messages
 * exactly; adds TVA/currency/market checks for the newly mapped fields.
 */
export function normalizeAndValidateRows(
  rows: Array<Record<string, string>>,
  mapping: Record<string, string>,
  fileParams: { countryCode: string; currencyCode: string },
  defaultTrade?: string,
  /** Ordered fallback designation headers (see `resolveMapping`). */
  nameFallbackHeaders?: string[],
  /**
   * CATALOG-ONLY mode (see `MappingResolution.catalogOnly`) — OPT-IN: when the
   * flag is absent the legacy contract applies byte-identically (an unmapped
   * `price_ht` still rejects every row), so every existing direct caller keeps
   * its behaviour. The real pipeline passes the flag resolved by
   * `resolveMapping` for the SAME file, so /preview, /import and Phase A stay
   * deterministic with each other.
   */
  opts?: { catalogOnly?: boolean }
): NormalizationResult {
  const valid: ValidImportRow[] = [];
  const failed: FailedRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // 1-based data rows, +1 for the header line
    const pick = (key: string): string => {
      const header = mapping[key];
      if (!header) return '';
      return String(row[header] ?? '').trim();
    };
    let reference = pick('material_code');
    let nameFr = pick('material_name');
    const tradeRaw = pick('trade_code');
    const priceRaw = pick('price_ht');
    const unitRaw = pick('unit');
    let nameAr = pick('name_ar');
    const nameEnRaw = pick('name_en');
    const nameEn = nameEnRaw === '' ? undefined : nameEnRaw;
    const note = pick('note');
    const tradeLabelRaw = pick('trade_name');
    const tvaRaw = pick('tva_rate');
    const currencyRaw = pick('currency');
    const marketRaw = pick('market');
    const categoryRaw = pick('category');
    const sourceRaw = pick('source');
    const sourceUrlRaw = pick('source_url');
    const effectiveFromRaw = pick('effective_from');
    const effectiveToRaw = pick('effective_to');
    const observedAtRaw = pick('observed_at');
    const statusRaw = pick('status');
    // DYNAMIC MÉTRÉ — optional element metadata columns (Phase 1). Empty
    // strings when the file has no such column (legacy catalogues unchanged).
    const metreCodeRaw = pick('metre_element_id');
    // ── P1 — ENRICHED MÉTRÉ METADATA columns (optional) ──────────────────────
    // Read ONLY when the file EXPLICITLY carries the column (missing column or
    // empty cell = "not provided"); NEVER inferred from trade / category /
    // unit / material / price.
    const wastePercentRaw = pick('waste_percent');
    const layersRaw = pick('layers');
    const coveragePerProductUnitRaw = pick('coverage_per_product_unit');
    const yieldPerUnitRaw = pick('yield_per_unit');
    const openingsRaw = pick('openings');
    const deductionsRaw = pick('deductions');
    const materialBindingsRaw = pick('material_bindings');
    const serviceBindingsRaw = pick('service_bindings');
    const linkedSlotCodeRaw = pick('linked_slot_code');
    /** A P1 cell is really present on THIS row (drives the "ignored" disclosure). */
    const p1CellPresent = [
      wastePercentRaw, layersRaw, coveragePerProductUnitRaw, yieldPerUnitRaw,
      openingsRaw, deductionsRaw, materialBindingsRaw, serviceBindingsRaw, linkedSlotCodeRaw,
    ].some((v) => v !== '');
    const fail = (reason: string) => failed.push({ row: rowNumber, reference, reason });
    const rowReview: string[] = [];

    // ── UNIVERSAL PER-ROW NAME FALLBACK ─────────────────────────────────────
    // A file may carry several designation columns (nom_fr / name_en /
    // name_ar…). Smart Mapping picks ONE primary column, but every row is
    // judged on ITS OWN values: when the primary cell is empty, the first
    // non-empty column of the fallback chain supplies the designation. The
    // column actually used is disclosed below; nothing is invented.
    if (nameFr === '' && nameFallbackHeaders && nameFallbackHeaders.length > 0) {
      for (const fallbackHeader of nameFallbackHeaders) {
        if (fallbackHeader === mapping.material_name) continue;
        const candidate = String(row[fallbackHeader] ?? '').trim();
        if (candidate === '') continue;
        nameFr = candidate;
        rowReview.push(`Nom repris de la colonne « ${fallbackHeader} » (colonne de désignation « ${mapping.material_name} » vide).`);
        // When the ARABIC name column is the fallback, it IS the designation —
        // the same value is never stored twice (as nameFr AND nameAr).
        if (fallbackHeader === mapping.name_ar) nameAr = '';
        break;
      }
    }

    // If the file did not provide a stable `material_code`, generate a
    // deterministic, stable internal code from the normalized material identity
    // (name + optional Arabic name / note) to keep imports idempotent.
    let generatedCode = false;
    if (!reference) {
      if (nameFr) {
        reference = generateMaterialCode(nameFr, nameAr, note);
        generatedCode = true;
      } else {
        // No name to derive a code from — remain a hard failure.
        fail('Missing Reference (stable material code).'); continue;
      }
    }
    if (reference.length > 100) { fail(`Reference too long (${reference.length} > 100 characters).`); continue; }
    if (!nameFr) { fail('Missing Nom_Materiau (material name).'); continue; }
    let trade = String(tradeRaw || '').toLowerCase();
    if (!trade && defaultTrade) {
      // P1 — explicit "Métier par défaut" chosen by the Admin in the Smart
      // Mapping step: every row without a trade column value resolves to the
      // SAME admin-confirmed default (deterministic /preview == /import). This
      // is a DELIBERATE admin decision, NOT a sentinel: the row carries an
      // informational review note only (it never matches the blocking
      // 'Missing Categorie' filter in the import route).
      trade = defaultTrade.toLowerCase();
      rowReview.push(`Métier par défaut '${trade}' appliqué (aucune colonne de métier dans le fichier).`);
    } else if (!trade) {
      // NO trade column value on this row AND no admin "Métier par défaut":
      // the engine refuses to INVENT a métier (a grouping such as
      // 'Building Materials' or 'Cement & Binders' is never a trade). The row
      // is NOT rejected for that reason alone — it is imported under the
      // explicit review sentinel, so a file whose only grouping columns are
      // not métiers stays importable; the review note keeps the missing métier
      // visible to the Admin. Same rule for /preview and /import.
      trade = UNMAPPED_REVIEW_TRADE;
      rowReview.push('Missing Categorie (trade) — requires review.');
    }
    // Clear, actionable rejection reasons: the Admin must see WHICH column the
    // value came from (and why the row is refused) instead of a bare
    // `Invalid price ''`. No value is ever invented for a row.
    //
    // CATALOG-ONLY (Master Catalog file WITHOUT any price column): for THIS
    // file `price_ht` is optional — the row stays valid WITHOUT a price and is
    // imported as material-only. No default price (NEVER `0`) is invented and
    // `commitValidRows` writes no `material_prices` row for it. A file that
    // HAS a price column (mapped or not) keeps the exact previous contract.
    if (!mapping.price_ht && !opts?.catalogOnly) {
      fail('Prix HT non mappé — aucune colonne de prix reconnue dans le fichier (aucun prix inventé).'); continue;
    }
    let price: number | undefined;
    if (mapping.price_ht) {
      // LINKS ARE NEVER PRICES — the generic rule (no supplier-specific branch):
      // when the mapped price cell holds an address, say so explicitly instead of
      // a bare `Invalid price`, and refuse the row (the value is never coerced,
      // truncated to its digits, nor replaced by an invented one).
      if (priceRaw !== '' && isUrlLikeValue(priceRaw)) {
        fail(`La colonne de prix « ${mapping.price_ht} » contient un lien et non un prix HT (${priceRaw.slice(0, 80)}) — ligne rejetée, aucun prix inventé. Vérifiez le mapping de la colonne (un lien doit être mappé comme « URL source »).`);
        continue;
      }
      const parsedPrice = parseImportPrice(priceRaw);
      if (parsedPrice === null) {
        fail(priceRaw.trim() === ''
          ? `Prix vide dans la colonne « ${mapping.price_ht} » (ligne rejetée, aucune valeur inventée).`
          : `Invalid price '${priceRaw}' (colonne « ${mapping.price_ht} »).`);
        continue;
      }
      if (parsedPrice < 0) { fail(`Price must be >= 0 (got ${parsedPrice}).`); continue; }
      price = parsedPrice;
    }
    const unit = unitRaw || 'unit';
    if (unit.length > 20) { fail(`Unit too long (${unit.length} > 20 characters).`); continue; }

    // ── Phase C — optional mapped fields ────────────────────────────────────
    let tvaRate: number | undefined;
    if (mapping.tva_rate && tvaRaw !== '') {
      const tva = parseTvaRate(tvaRaw);
      if (tva === null) { fail(`Invalid TVA rate '${tvaRaw}' (must be a number between 0 and 100).`); continue; }
      tvaRate = tva;
    }
    // ── PER-ROW CURRENCY / MARKET (preserved, never converted) ──────────────
    // A VALID code carried by the row itself is KEPT: the import stores that
    // price under the row's own currency and market. The Admin's file-level
    // selection is a FALLBACK only (used when the cell/column is empty), which
    // is why a row whose currency/market differ from the selection is NEVER
    // rejected nor coerced. Malformed values are refused individually (no
    // value is invented). The divergence is disclosed in the row review.
    let rowCurrency: string | undefined;
    if (mapping.currency && currencyRaw !== '') {
      const cur = currencyRaw.toUpperCase();
      if (!/^[A-Z]{3}$/.test(cur)) { fail(`Invalid currency '${currencyRaw}' (expected a 3-letter ISO code).`); continue; }
      rowCurrency = cur;
      if (cur !== fileParams.currencyCode.toUpperCase()) {
        rowReview.push(`Devise du fichier '${cur}' conservée (sélection d'import ${fileParams.currencyCode.toUpperCase()} non appliquée, aucune conversion).`);
      }
    }
    let rowMarket: string | undefined;
    if (mapping.market && marketRaw !== '') {
      const mk = marketRaw.toUpperCase();
      if (!/^[A-Z]{2,3}$/.test(mk)) { fail(`Invalid market '${marketRaw}' (expected a country code).`); continue; }
      rowMarket = mk;
      if (mk !== fileParams.countryCode.toUpperCase()) {
        rowReview.push(`Marché du fichier '${mk}' conservé (sélection d'import ${fileParams.countryCode.toUpperCase()} non appliquée).`);
      }
    }

    const isoDate = (raw: string, label: string): string | undefined => {
      if (!raw) return undefined;
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        fail(`Invalid ${label} '${raw}' (expected an ISO date).`);
        return '__INVALID__';
      }
      return parsed.toISOString().slice(0, 10);
    };
    const effectiveFrom = isoDate(effectiveFromRaw, 'effective_from');
    const effectiveTo = isoDate(effectiveToRaw, 'effective_to');
    const observedAt = isoDate(observedAtRaw, 'observed_at');
    if ([effectiveFrom, effectiveTo, observedAt].includes('__INVALID__')) continue;
    if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
      fail(`effective_to '${effectiveToRaw}' is before effective_from '${effectiveFromRaw}'.`); continue;
    }
    const source = (sourceRaw || 'OFFICIAL_DEFAULT').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').slice(0, 50) || 'OFFICIAL_DEFAULT';
    const sourceStatus = (statusRaw || 'active').trim().toLowerCase().slice(0, 30);
    // SOURCE URL — kept verbatim ONLY when the cell really is a link. A
    // non-link value under this mapping is dropped with an informational note
    // (never repaired, never prefixed with a made-up `https://`).
    let sourceUrl: string | undefined;
    if (mapping.source_url && sourceUrlRaw !== '') {
      if (isUrlLikeValue(sourceUrlRaw) && sourceUrlRaw.length <= 500) {
        sourceUrl = sourceUrlRaw;
      } else {
        rowReview.push(`Valeur non-URL ignorée pour source_url ('${sourceUrlRaw.slice(0, 60)}') — la ligne reste importée.`);
      }
    }

    // ── DYNAMIC MÉTRÉ — optional element metadata (Phase 1, data-driven) ───
    // Kept ONLY when the row forms a complete, engine-safe element (the SAME
    // `isValidMetreElementShape` contract the client loader applies). An
    // incomplete/invalid block degrades to "no metadata" + an informational
    // review note — the row still imports and the métier keeps its config
    // fallback. `method` / `qty_unit` are NEVER inferred from `unit` or
    // `category` (requirement of the data-driven contract).
    let metre: ValidImportRow['metre'];
    if (metreCodeRaw) {
      const readJson = (raw: string): { ok: boolean; value: unknown } => {
        const text = String(raw ?? '').trim();
        if (!text) return { ok: false, value: undefined };
        try { return { ok: true, value: JSON.parse(text) }; }
        catch { return { ok: false, value: undefined }; }
      };
      const dims = readJson(pick('metre_dims'));
      const calc = readJson(pick('metre_calc'));
      const candidate = {
        elementCode: metreCodeRaw,
        labelFr: pick('metre_element_label_fr') || metreCodeRaw,
        labelAr: pick('metre_element_label_ar') || '',
        method: pick('metre_method'),
        dims: dims.value,
        calc: calc.value,
        qtyUnit: pick('metre_qty_unit'),
      };
      const tooLong = metreCodeRaw.length > 100 || candidate.labelFr.length > 150 || candidate.labelAr.length > 150;
      if (!tooLong && dims.ok && calc.ok && isValidMetreElementShape(candidate)) {
        // ── P1 — ENRICHED MÉTRÉ METADATA (optional) ───────────────────────────
        // Attached ONLY to this EXPLICIT element (`metre_element_id`) and ONLY
        // from the file's own columns: every value below was either rule-checked
        // (`waste_percent` finite 0–100, `layers` finite integer > 0) or read as
        // EXPLICIT JSON from the source — invalid input is dropped with a review
        // note and nothing is repaired, guessed or substituted.
        const p1: {
          wastePercent?: number;
          layers?: number;
          coveragePerProductUnit?: unknown;
          yieldPerUnit?: unknown;
          openings?: unknown;
          deductions?: unknown;
          materialBindings?: unknown;
          serviceBindings?: unknown;
          linkedSlotCode?: string;
        } = {};
        if (wastePercentRaw !== '') {
          const v = parseImportPrice(wastePercentRaw);
          if (v !== null && Number.isFinite(v) && v >= 0 && v <= 100) p1.wastePercent = v;
          else rowReview.push(`Champ « waste_percent » invalide ('${wastePercentRaw}') — ignoré : un nombre entre 0 et 100 est attendu (aucune valeur inventée).`);
        }
        if (layersRaw !== '') {
          const v = parseImportPrice(layersRaw);
          if (v !== null && Number.isFinite(v) && Number.isInteger(v) && v > 0) p1.layers = v;
          else rowReview.push(`Champ « layers » invalide ('${layersRaw}') — ignoré : un entier strictement positif est attendu (aucune valeur inventée).`);
        }
        /** EXPLICIT JSON cell — never repaired, never guessed; invalid → dropped + review note. */
        const readP1Json = (key: string, raw: string): { present: boolean; value?: unknown } => {
          if (raw === '') return { present: false };
          try { return { present: true, value: JSON.parse(raw) }; }
          catch {
            rowReview.push(`Colonne « ${key} » : JSON invalide — valeur ignorée (ni corrigée ni remplacée).`);
            return { present: false };
          }
        };
        // Every parsed block is re-checked against the ONE shared contract
        // (`isValidMetreElementShape`): a JSON value that parses but violates it
        // would make the client loader (`mapMetreElementRow`) reject the WHOLE
        // element at load time — so it is dropped HERE, with a clear review
        // note (never repaired, never replaced).
        const attachP1 = (label: string, patch: Partial<typeof p1>): void => {
          const merged = { ...candidate, ...p1, ...patch };
          if (isValidMetreElementShape(merged)) Object.assign(p1, patch);
          else rowReview.push(`Colonne « ${label} » : JSON conforme au format mais refusé par le contrat moteur — valeur ignorée.`);
        };
        const openingsCell = readP1Json('openings', openingsRaw);
        if (openingsCell.present) attachP1('openings', { openings: openingsCell.value });
        const deductionsCell = readP1Json('deductions', deductionsRaw);
        if (deductionsCell.present) attachP1('deductions', { deductions: deductionsCell.value });
        const coverageCell = readP1Json('coverage_per_product_unit', coveragePerProductUnitRaw);
        if (coverageCell.present) attachP1('coverage_per_product_unit', { coveragePerProductUnit: coverageCell.value });
        const yieldCell = readP1Json('yield_per_unit', yieldPerUnitRaw);
        if (yieldCell.present) attachP1('yield_per_unit', { yieldPerUnit: yieldCell.value });
        const materialBindingsCell = readP1Json('material_bindings', materialBindingsRaw);
        if (materialBindingsCell.present) attachP1('material_bindings', { materialBindings: materialBindingsCell.value });
        const serviceBindingsCell = readP1Json('service_bindings', serviceBindingsRaw);
        if (serviceBindingsCell.present) attachP1('service_bindings', { serviceBindings: serviceBindingsCell.value });
        // `linked_slot_code` stays on `ValidImportRow.metre` ONLY — the current
        // `TradeMetreElementInput` declares no such field, so it is NEVER sent
        // to the repository / DB in P1.
        if (linkedSlotCodeRaw !== '') p1.linkedSlotCode = linkedSlotCodeRaw;
        metre = { ...candidate, ...p1 };
      } else {
        rowReview.push('Métier métré metadata incomplete/invalid — ignored (config fallback applies).');
        // P1 metadata is NEVER created on its own: it must belong to a complete,
        // engine-safe element the file names explicitly.
        if (p1CellPresent) rowReview.push('Champs métré enrichis (P1) ignorés — l\'élément métré de la ligne est incomplet ou invalide.');
      }
    } else if (p1CellPresent) {
      rowReview.push('Champs métré enrichis (P1) ignorés — aucun élément métré explicite (`metre_element_id`) sur cette ligne.');
    }

    const validRow: ValidImportRow = {
      row: rowNumber,
      reference,
      nameFr,
      trade,
      tradeLabel: tradeLabelRaw || undefined,
      price,
      unit,
      nameAr: nameAr || undefined,
      nameEn,
      note: note || undefined,
      tvaRate,
      category: categoryRaw || trade,
      source,
      sourceUrl,
      currencyCode: rowCurrency,
      countryCode: rowMarket,
      effectiveFrom,
      effectiveTo,
      observedAt,
      sourceStatus,
    };
    if (rowReview.length > 0 || generatedCode) {
      validRow.review = [];
      if (generatedCode) validRow.review.push('Generated material_code from material name');
      if (rowReview.length > 0) validRow.review.push(...rowReview);
    }
    if (metre) validRow.metre = metre;
    valid.push(validRow);
  }

  return { valid, failed };
}

// ── Commit (Phase A transactional flow, shared by CSV + XLSX import) ────────

export interface CommitSuccess {
  ok: true;
  imported: number;
  updated: number;
  results: Array<{ row: number; reference: string; status: 'imported' | 'updated' }>;
  /** PHASE 1 — version identity of the committed (or replayed) catalog. */
  catalog?: { id: string | null; version: number; countryCode: string; idempotentReplay: boolean };
  deactivated?: number;
}

export interface CommitFailure {
  ok: false;
  message: string;
  /** Rows to report in the `data.failed` array of the HTTP response. */
  failedRows: FailedRow[];
}

/**
 * Persist validated rows EXACTLY like the Phase A import:
 *   1. Ensure all trades exist (Phase B — dynamic, is_official=false).
 *   2. ONE transaction: material + official price upserts commit or roll
 *      back together.
 * Never called for rows that failed validation — all-or-nothing is enforced
 * by the caller BEFORE this function runs.
 */
export async function commitValidRows(
  valid: ValidImportRow[],
  fileParams: { countryCode: string; currencyCode: string },
  opts?: { fileName?: string; sourceRef?: string; actorUserId?: string }
): Promise<CommitSuccess | CommitFailure> {
  // ── 1) Ensure all trades exist (Phase B — dynamic trade creation) ────────
  // EXCEPT the review sentinel: rows with no trusted métier keep
  // `UNMAPPED_REVIEW_TRADE` ON THE ROW (data honesty + review note) but they
  // never REGISTER that code as a métier — no `trades` row is created for it
  // and no `trade_id` is attached, so the catalog can never present the
  // sentinel as a real métier. An EXISTING sentinel row (created by an older
  // import) is reused as-is: nothing is created, nothing is deleted.
  const uniqueTrades = [...new Set(valid.map((item) => item.trade))];
  const tradeIdByCode = new Map<string, string>();
  for (const tradeCode of uniqueTrades) {
    try {
      if (tradeCode === UNMAPPED_REVIEW_TRADE) {
        const existingSentinel = await findTradeByCode(UNMAPPED_REVIEW_TRADE);
        if (existingSentinel?.id) tradeIdByCode.set(tradeCode, existingSentinel.id);
        continue;
      }
      const trade = await upsertTradeByCode(tradeCode, valid.find((i) => i.trade === tradeCode)?.tradeLabel);
      if (trade?.id) tradeIdByCode.set(tradeCode, trade.id);
    } catch (tradeErr: any) {
      return {
        ok: false,
        message: `Failed to create trade '${tradeCode}': ${tradeErr?.message || tradeErr}`,
        failedRows: [],
      };
    }
  }

  // ── 2) ONE transaction: every material/price write commits or rolls back ─
  const db = await getDatabase();
  if (!db) {
    return { ok: false, message: 'Database not available', failedRows: [] };
  }

  // ── DYNAMIC MÉTRÉ — optional metadata table probe (Phase 1) ───────────────
  // ONLY files carrying metre metadata ever reach this branch: a legacy
  // catalogue without those columns imports byte-identically to before. The
  // existence probe runs OUTSIDE the transaction on purpose — a SELECT against
  // a missing table (migration 0015 not applied yet) would ABORT the
  // PostgreSQL transaction even when caught in JS (the 0009 calc_rules trap).
  // Table absent ⇒ metadata skipped, materials/prices unaffected.
  const withMetre = valid.some((v) => v.metre);
  let metreTableReady = false;
  if (withMetre) {
    try {
      await db.select({ id: tradeMetreElements.id }).from(tradeMetreElements).limit(1);
      metreTableReady = true;
    } catch {
      // eslint-disable-next-line no-console
      console.warn('[catalogImport] trade_metre_elements unavailable — metre metadata skipped (apply migration 0015).');
    }
  }

  // ── PHASE 1 — Country Catalog versioning: availability probe ──────────────
  // SAME trap as migration 0015 above: a statement against a missing table (or a
  // missing column) raises a PostgreSQL error that ABORTS the enclosing
  // transaction even when the error is caught in JavaScript. Silently swallowing
  // it INSIDE the transaction therefore made the import fail later with a
  // misleading 500 ("Failed query: select … from materials"). Probe the version
  // tables OUTSIDE the transaction: unavailable ⇒ versioning skipped and the
  // material/price batch still commits atomically; available ⇒ the snapshot runs
  // inside the SAME transaction and any real failure aborts loudly.
  let countryCatalogReady = false;
  try {
    const ccProbe = await import('../db/schema/countryCatalog');
    const ciProbe = await import('../db/schema/countryCatalogItems');
    // FULL-row probes (not `select({ id })`): a table that exists but whose
    // COLUMNS drifted (a migration partially applied) raises exactly the same
    // transaction-abort trap on the INSERT below.
    await db.select().from(ccProbe.countryCatalogs).limit(1);
    await db.select().from(ciProbe.countryCatalogItems).limit(1);
    countryCatalogReady = true;
  } catch (probeErr: any) {
    // eslint-disable-next-line no-console
    console.warn('[catalogImport] country_catalogs/country_catalog_items unavailable — catalog versioning skipped (apply the catalog migrations):', probeErr?.message || probeErr);
  }

  // ── Phase 2 — calculator-link availability probe (OUTSIDE the transaction) ─
  // SAME trap as the two optional blocks around it: the per-row block below
  // reads `calc_rules` and writes `material_calc_links` (migration 0009)
  // THROUGH the import transaction. A statement against a missing table (or a
  // missing column) raises a PostgreSQL error that ABORTS the enclosing
  // transaction even when the JavaScript `catch` swallows it — every following
  // statement of the batch then failed with an unrelated 25P02 and the whole
  // import was reported as « Import failed and was fully rolled back », while
  // /preview (no database access) stayed perfectly healthy. This is the first
  // failure point of the import write path; probing it OUTSIDE the transaction
  // removes it: calculator linking is an ADDITIVE enrichment, so when its
  // tables are unavailable it is skipped with ONE explicit warning (the true
  // error is logged) and the catalog batch still commits atomically. When the
  // tables ARE available nothing changes and a genuine error still fails loudly.
  let calcLinkReady = false;
  try {
    await db.select().from(calcRules).limit(1);
    await db.select().from(materialCalcLinks).limit(1);
    calcLinkReady = true;
  } catch (calcProbeErr: any) {
    calcLinkReady = false;
    // eslint-disable-next-line no-console
    console.error(
      '[catalogImport] calc_rules/material_calc_links unavailable — calculator linking skipped for this import (apply the calculator migration 0009):',
      calcProbeErr?.message || calcProbeErr
    );
  }

  const results: Array<{ row: number; reference: string; status: 'imported' | 'updated' }> = [];
  let imported = 0;
  let updated = 0;
  // PHASE 1 — version identity: Country + content-hash, never filename alone.
  const country = normalizeCountryCode(fileParams.countryCode);
  const currency = String(fileParams.currencyCode || 'TND').toUpperCase();
  // CATALOG-ONLY — the country-catalog SNAPSHOT models PRICES (`price_ht` is
  // NOT NULL), so it is built from the rows that actually carry one. For a
  // Master Catalog file without prices there are none: versioning/replay is
  // skipped entirely (no version row, no snapshot, NO price invented) and only
  // the material upserts below run. A file WITH prices has `pricedRows ===
  // valid`, so its hash/version/snapshot are byte-identical to before.
  const pricedRows = valid.filter((v) => v.price !== undefined);
  const contentHash = catalogContentHash(pricedRows.map((v) => ({ reference: v.reference, price: v.price as number, unit: v.unit, trade: v.trade, category: v.category })), currency, country);
  let catalogInfo: { catalogId: string | null; version: number; idempotentReplay: boolean } = { catalogId: null, version: 0, idempotentReplay: false };

  try {
    await db.transaction(async (tx: any) => {
      // PHASE 1 — idempotent replay: same Country + same content-hash returns
      // the existing ACTIVE catalog without writing duplicates.
      let cc: any = null; let ci: any = null; let orm: any = null;
      // Guarded by the OUT-OF-TRANSACTION availability probe above — and by
      // `pricedRows.length > 0` (CATALOG-ONLY): a file without any price has
      // no price-catalog content to version or replay, so this block is
      // skipped exactly like the missing-table case, while the material
      // upserts further down still commit for every row.
      if (countryCatalogReady && pricedRows.length > 0) try {
        cc = await import('../db/schema/countryCatalog');
        ci = await import('../db/schema/countryCatalogItems');
        orm = await import('drizzle-orm');
        const { eq: eq2, and: and2, desc: desc2, ne: ne2 } = orm;
        const existingActive = await tx.select().from(cc.countryCatalogs)
          .where(and2(eq2(cc.countryCatalogs.countryCode, country), eq2(cc.countryCatalogs.isActive, true)))
          .orderBy(desc2(cc.countryCatalogs.version)).limit(1);
        const active = existingActive[0];
        if (active && active.contentSha256 === contentHash) {
          catalogInfo = { catalogId: active.id, version: active.version, idempotentReplay: true };
          // Count against existing snapshot (imported vs updated by existence).
          for (const item of valid) {
            const hit = await tx.select().from(ci.countryCatalogItems)
              .where(and2(eq2(ci.countryCatalogItems.catalogId, active.id), eq2(ci.countryCatalogItems.materialCode, item.reference))).limit(1);
            if (hit[0]) { updated++; results.push({ row: item.row, reference: item.reference, status: 'updated' }); }
            else { imported++; results.push({ row: item.row, reference: item.reference, status: 'imported' }); }
          }
          return;
        }
        // New version: next monotonic version for this country.
        const allVersions = await tx.select({ version: cc.countryCatalogs.version }).from(cc.countryCatalogs)
          .where(eq2(cc.countryCatalogs.countryCode, country));
        const nextVersion = allVersions.reduce((m: number, r: any) => Math.max(m, Number(r.version) || 0), 0) + 1;
        const [catalogRow] = await tx.insert(cc.countryCatalogs).values({
          countryCode: country, version: nextVersion, isActive: true,
          fileName: opts?.fileName || null, sourceRef: opts?.sourceRef || null,
          contentSha256: contentHash, currencyCode: currency,
          itemsCount: pricedRows.length, createdByUserId: opts?.actorUserId || null,
        }).returning();
        catalogInfo = { catalogId: catalogRow.id, version: nextVersion, idempotentReplay: false };
        // Deactivate previous ACTIVE versions (history kept, rows untouched).
        // The new row is excluded by id so it stays active.
        await tx.update(cc.countryCatalogs)
          .set({ isActive: false, updatedAt: new Date() })
          .where(and2(eq2(cc.countryCatalogs.countryCode, country), eq2(cc.countryCatalogs.isActive, true), ne2(cc.countryCatalogs.id, catalogRow.id)));
        // Snapshot every PRICED row: trade and category stored SEPARATELY,
        // verbatim. (A catalog-only row has no price and `price_ht` is NOT
        // NULL — it is never snapshotted with an invented value; such rows
        // have no version at all, see the gate above.)
        for (const item of pricedRows) {
          await tx.insert(ci.countryCatalogItems).values({
            catalogId: catalogRow.id, countryCode: country,
            materialCode: item.reference, materialName: item.nameFr,
            trade: item.trade, tradeLabel: item.tradeLabel || null,
            category: item.category || item.trade,
            unit: item.unit, priceHt: String(roundMoney(item.price)),
            currencyCode: item.currencyCode || currency, tvaRate: item.tvaRate != null ? String(item.tvaRate) : null,
            isActive: true, sourceRow: item.row,
          }).onConflictDoNothing({ target: [ci.countryCatalogItems.catalogId, ci.countryCatalogItems.materialCode] });
        }
      } catch (snapshotErr: any) {
        // The version snapshot belongs to the SAME all-or-nothing batch. Once a
        // statement failed, PostgreSQL has already aborted the transaction, so
        // swallowing here only produced a LATER, unrelated-looking failure.
        // Rethrow with the true cause — the import is reported as rolled back.
        throw new Error(`Catalog version snapshot failed: ${snapshotErr?.message || snapshotErr}`);
      }
      for (const item of valid) {
        if (catalogInfo.idempotentReplay) break;
        const existing = await findOfficialMaterialByCode(item.reference, tx);
        // Persist material and capture the returned row so we have the material.id
        const material = await upsertMaterialByCode({
          code: item.reference,
          trade: item.trade,
          // Phase 1 Foundation — persist the resolved trade UUID so
          // materials.trade_id is actually saved (was previously computed
          // into tradeIdByCode and dropped on the floor).
          tradeId: tradeIdByCode.get(item.trade) ?? null,
          category: item.category || item.trade,
          nameFr: item.nameFr,
          nameAr: item.nameAr ?? null,
          nameEn: item.nameEn ?? null,
          baseUnit: item.unit,
          technicalSpecs: item.note ?? null,
        }, tx);
        // CATALOG-ONLY — a row without a price (file has no price column)
        // writes NO `material_prices` row at all: the material is created/
        // updated above and the existing prices are left untouched. No `0`
        // (or any other value) is ever written in place of a missing price.
        if (item.price !== undefined) await upsertOfficialPrice({
          materialCode: item.reference,
          price: roundMoney(item.price),
          // PER-ROW currency/market preserved; the file-level selection is the
          // fallback only (see ValidImportRow) — a row is never converted.
          currencyCode: item.currencyCode || fileParams.currencyCode,
          countryCode: item.countryCode || fileParams.countryCode,
          sourceCode: item.source,
          effectiveFrom: item.effectiveFrom,
          effectiveTo: item.effectiveTo,
          observedAt: item.observedAt,
          sourceStatus: item.sourceStatus,
          tvaRate: item.tvaRate,
          sourceUrl: item.sourceUrl,
        }, tx);

        // Phase 2 — attempt to resolve an existing calculator rule and
        // create an idempotent material_calc_links row only when a reliable
        // active rule exists AND the calc tables were proven available OUTSIDE
        // the transaction (`calcLinkReady`). Running this probe inside the
        // transaction is what used to abort the whole import on a database
        // without migration 0009. Silent no-op when unavailable.
        if (calcLinkReady) try {
          if (material && material.id) {
            const rule = await calcRepository.findRuleForMaterial({ code: material.code, materialId: material.id, trade: material.trade }, tx);
            if (rule) {
              await calcRepository.upsertMaterialCalcLink({ materialId: material.id, slotCode: rule.slotCode, ruleCode: rule.ruleCode, matchKey: rule.legacyKey || material.id }, tx);
            }
          }
        } catch (e) {
          // Do not fail the whole import for calc-link insert issues. Log via console.warn
          // (kept minimal and non-fatal per Phase 2 additive goal).
          // eslint-disable-next-line no-console
          console.warn('Calc linking skipped due to error:', e?.message || e);
        }

        // DYNAMIC MÉTRÉ — persist the optional element metadata in the SAME
        // transaction as the catalogue row it describes (idempotent upsert by
        // (trade_id, element_code)). Guarded by `metreTableReady`, so a missing
        // migration can never abort the import; legacy rows never enter here.
        if (metreTableReady && item.metre) {
          const metreTradeId = tradeIdByCode.get(item.trade);
          if (metreTradeId) {
            await upsertTradeMetreElement(metreTradeId, {
              elementCode: item.metre.elementCode,
              labelFr: item.metre.labelFr,
              labelAr: item.metre.labelAr,
              method: item.metre.method,
              dims: item.metre.dims,
              calc: item.metre.calc,
              qtyUnit: item.metre.qtyUnit,
              // ── P1 — enriched metadata: supplied ONLY when the file carried
              // it (undefined = "leave the stored value untouched", exactly the
              // `TradeMetreElementInput` contract). `linkedSlotCode` is
              // deliberately NOT passed — the interface declares no such field.
              ...(item.metre.wastePercent !== undefined ? { wastePercent: item.metre.wastePercent } : {}),
              ...(item.metre.layers !== undefined ? { layers: item.metre.layers } : {}),
              ...(item.metre.coveragePerProductUnit !== undefined ? { coveragePerProductUnit: item.metre.coveragePerProductUnit } : {}),
              ...(item.metre.yieldPerUnit !== undefined ? { yieldPerUnit: item.metre.yieldPerUnit } : {}),
              ...(item.metre.openings !== undefined ? { openings: item.metre.openings } : {}),
              ...(item.metre.deductions !== undefined ? { deductions: item.metre.deductions } : {}),
              ...(item.metre.materialBindings !== undefined ? { materialBindings: item.metre.materialBindings } : {}),
              ...(item.metre.serviceBindings !== undefined ? { serviceBindings: item.metre.serviceBindings } : {}),
            }, tx);
          }
        }

        if (existing) {
          updated++;
          results.push({ row: item.row, reference: item.reference, status: 'updated' });
        } else {
          imported++;
          results.push({ row: item.row, reference: item.reference, status: 'imported' });
        }
      }
      // PHASE 1 — persist final counts on the catalog version row (same tx).
      if (cc && orm && catalogInfo.catalogId && !catalogInfo.idempotentReplay) {
        await tx.update(cc.countryCatalogs).set({
          importedCount: imported,
          updatedCount: updated,
          updatedAt: new Date(),
        }).where(orm.eq(cc.countryCatalogs.id, catalogInfo.catalogId));
      }
    });
  } catch (txErr: any) {
    // NEVER silent: the real database error (with its SQL state) is logged so a
    // 500 can no longer be unattributable — the HTTP response carries the same
    // message, and the two optional blocks above are probed OUTSIDE the
    // transaction so they can never abort it.
    // eslint-disable-next-line no-console
    console.error('[catalogImport] import transaction failed — rolled back:', txErr?.stack || txErr?.message || txErr);
    // Drizzle already rolled the transaction back — nothing persisted.
    return {
      ok: false,
      message: `Import failed and was fully rolled back: ${txErr?.message || txErr}`,
      failedRows: valid.map((item) => ({ row: item.row, reference: item.reference, reason: 'Rolled back: database error during the transaction.' })),
    };
  }

  return { ok: true, imported, updated, results, catalog: { id: catalogInfo.catalogId, version: catalogInfo.version, countryCode: country, idempotentReplay: catalogInfo.idempotentReplay }, deactivated: 0 };
}