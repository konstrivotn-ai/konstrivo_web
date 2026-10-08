import React, { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Search,
  RefreshCw,
  Pencil,
  X,
  Save,
  Package,
  AlertCircle,
  Check,
  Upload,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Link,
  History,
  Database,
  Power,
} from 'lucide-react';
import {
  adminApproveGlobalCatalogImportItem,
  adminCreateGlobalCatalogSource,
  adminCreateGlobalProduct,
  adminRejectGlobalCatalogImportItem,
  adminUpdateGlobalCatalogSource,
  adminUpdateGlobalProduct,
  commitGlobalCatalogImport,
  listGlobalCatalogImportItems,
  listGlobalCatalogImports,
  listGlobalCatalogProducts,
  listGlobalCatalogSources,
  previewGlobalCatalogImport,
  syncGlobalCatalogSource,
  testGlobalCatalogSourceConnection,
  type GlobalCatalogImportItem,
  type GlobalCatalogImportPreview,
  type GlobalCatalogImportResult,
  type GlobalCatalogImportRun,
  type GlobalCatalogProduct,
  type GlobalCatalogProductInput,
  type GlobalCatalogSource,
  type GlobalCatalogSourceApiConfiguration,
  type GlobalCatalogSourceApiMapping,
  type GlobalCatalogSourceConfiguration,
  type GlobalCatalogSourceInput,
  type GlobalCatalogSourceTestResult,
  type GlobalCatalogSourceSyncResult,
  GLOBAL_CATALOG_API_MAPPING_FIELDS,
  type GlobalCatalogApiMappingRow,
} from '../lib/api';
import { listCountryOptions } from '../data/countryConfig';

type ProductForm = GlobalCatalogProductInput;

const EMPTY_FORM: ProductForm = {
  name: '',
  brand: '',
  manufacturer: '',
  category: '',
  subcategory: '',
  description: '',
  specification: '',
  unit: '',
  model: '',
  sku: '',
  status: 'active',
};

type SourceForm = GlobalCatalogSourceInput;

const EMPTY_SOURCE_FORM: SourceForm = {
  name: '',
  sourceType: 'csv',
  countryCode: '',
  provider: '',
  url: '',
  updateFrequency: '',
  status: 'active',
};

/** Types offered in the UI (the API also accepts the other documented types). */
const SOURCE_TYPE_OPTIONS = ['csv', 'xlsx', 'api'];

/** `active` = enabled, `inactive` = disabled (only values the API accepts). */
const SOURCE_STATUS_OPTIONS = ['active', 'inactive'];

// ── Phase 1 : configuration API (`configuration.api`) ───────────────────────
// Les listes miroitent les allow-lists du serveur
// (CATALOG_SOURCE_API_* de server/repositories/globalCatalogRepository.ts).

/** `configuration.api.authType`. */
const SOURCE_API_AUTH_OPTIONS = ['none', 'api_key', 'bearer_token', 'basic_auth'];

/** `configuration.api.credentialLocation` — seulement pour `api_key`. */
const SOURCE_API_CREDENTIAL_LOCATIONS = ['header', 'query'];

/** `configuration.api.responseFormat`. */
const SOURCE_API_RESPONSE_FORMATS = ['json', 'xml', 'csv'];

/** Libellés FR des types d'authentification. */
const SOURCE_API_AUTH_LABELS: Record<string, string> = {
  none: 'Aucune',
  api_key: 'Clé API',
  bearer_token: 'Bearer token',
  basic_auth: 'Basic (utilisateur)',
};

/**
 * État local du bloc « Connexion API » (= `configuration.api`).
 * `headerNames` est un simple texte : un nom d'en-tête par ligne.
 * Aucune valeur secrète n'y figure — uniquement des références.
 */
type SourceApiForm = {
  baseUrl: string;
  authType: string;
  headerNames: string;
  credentialRef: string;
  credentialLocation: string;
  credentialKey: string;
  username: string;
  responseFormat: string;
};

const EMPTY_SOURCE_API_FORM: SourceApiForm = {
  baseUrl: '',
  authType: 'none',
  headerNames: '',
  credentialRef: '',
  credentialLocation: 'header',
  credentialKey: 'X-API-Key',
  username: '',
  responseFormat: 'json',
};

// ── Phase 3 : Mapping de la réponse API (`configuration.api.mapping`) ───────

/**
 * État local de la section « Mapping ». Les chemins de `fields` sont
 * RELATIFS à un produit ; l'adresse absolue affichée est
 * `<root>.<collection>[].<champ>` (ex. `products[].name`).
 */
type SourceMappingState = {
  root: string;
  collection: string;
  rows: GlobalCatalogApiMappingRow[];
};

const EMPTY_SOURCE_MAPPING: SourceMappingState = { root: '', collection: '', rows: [] };

/** Miroir PUR du `describeApiMappingPath` du serveur (affichage uniquement). */
function describeApiMappingPath(root: string, collection: string, fieldPath: string): string {
  const segments = [root.trim(), collection.trim()].filter(Boolean);
  const prefix = segments.length ? `${segments.join('.')}[].` : '';
  return prefix + fieldPath.trim();
}

/** `configuration.api.mapping` → état du formulaire (ouverture de Edit). */
function mappingToState(mapping: unknown): SourceMappingState {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    return EMPTY_SOURCE_MAPPING;
  }
  const source = mapping as Record<string, unknown>;
  const rawFields =
    source.fields && typeof source.fields === 'object' && !Array.isArray(source.fields)
      ? (source.fields as Record<string, unknown>)
      : {};

  return {
    root: typeof source.root === 'string' ? source.root : '',
    collection: typeof source.collection === 'string' ? source.collection : '',
    rows: Object.keys(rawFields)
      .filter((key) => GLOBAL_CATALOG_API_MAPPING_FIELDS.some((f) => f.key === key))
      .map((key) => ({
        field: key,
        path: typeof rawFields[key] === 'string' ? (rawFields[key] as string) : '',
      })),
  };
}

/**
 * État → `configuration.api.mapping`.
 * Retourne `undefined` quand la section est entièrement vide ⇒ le mapping est
 * retiré du `configuration` (effacement sûr). Jette une Error (message FR) en
 * cas de doublon / chemin vide / champ obligatoire manquant ; le serveur
 * re-valide avec exactement les mêmes règles.
 */
function buildSourceApiMapping(
  state: SourceMappingState,
): GlobalCatalogSourceApiMapping | undefined {
  const root = state.root.trim();
  const collection = state.collection.trim();
  const touched =
    !!root || !!collection || state.rows.some((row) => row.field.trim() || row.path.trim());

  const rows = state.rows
    .map((row) => ({ field: row.field.trim().toLowerCase(), path: row.path.trim() }))
    .filter((row) => row.field && row.path);

  if (rows.length === 0) {
    if (touched) {
      throw new Error(
        'Mapping : renseignez un chemin pour chaque champ, ou videz complètement la section.',
      );
    }
    return undefined; // section jamais utilisée ⇒ rien à envoyer
  }

  const fields: Record<string, string> = {};
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(fields, row.field)) {
      throw new Error(`Mapping : champ Global Catalog dupliqué « ${row.field} ».`);
    }
    if (/\s/.test(row.path) || row.path.indexOf('..') !== -1) {
      throw new Error(`Mapping : chemin de réponse invalide « ${row.path} ».`);
    }
    if (row.path.startsWith('.') || row.path.endsWith('.')) {
      throw new Error(`Mapping : chemin de réponse invalide « ${row.path} ».`);
    }
    fields[row.field] = row.path;
  }

  if (!fields.name) throw new Error('Mapping : le champ « Nom du produit » est obligatoire.');

  return { root, collection, fields };
}

/** `configuration` → objet JS (jamais null / jamais un tableau). */
function readSourceConfiguration(value: unknown): GlobalCatalogSourceConfiguration {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as GlobalCatalogSourceConfiguration) }
    : {};
}

/** `configuration.api` → valeurs du formulaire (utilisé à l'ouverture de Edit). */
function sourceApiToForm(api: unknown): SourceApiForm {
  if (!api || typeof api !== 'object' || Array.isArray(api)) {
    return EMPTY_SOURCE_API_FORM;
  }
  const cfg = api as Record<string, unknown>;
  const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
  return {
    baseUrl: str(cfg.baseUrl),
    authType: SOURCE_API_AUTH_OPTIONS.includes(str(cfg.authType)) ? str(cfg.authType) : 'none',
    headerNames: Array.isArray(cfg.headerNames) ? cfg.headerNames.map((h) => String(h)).join('\n') : '',
    credentialRef: str(cfg.credentialRef),
    credentialLocation: SOURCE_API_CREDENTIAL_LOCATIONS.includes(str(cfg.credentialLocation))
      ? str(cfg.credentialLocation)
      : 'header',
    credentialKey: str(cfg.credentialKey, 'X-API-Key'),
    username: str(cfg.username),
    responseFormat: SOURCE_API_RESPONSE_FORMATS.includes(str(cfg.responseFormat))
      ? str(cfg.responseFormat)
      : 'json',
  };
}

/**
 * Formulaire → `configuration.api`.
 * Jette une Error (message FR) si un champ obligatoire manque ; le serveur
 * re-valide systématiquement avec les mêmes règles.
 */
function sourceApiFormToConfiguration(form: SourceApiForm): GlobalCatalogSourceApiConfiguration {
  const baseUrl = form.baseUrl.trim();
  if (!baseUrl) throw new Error("L'URL de base (endpoint) de l'API est obligatoire.");
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error("L'URL de base de l'API doit commencer par http:// ou https://.");
  }

  const authType = SOURCE_API_AUTH_OPTIONS.includes(form.authType) ? form.authType : 'none';
  const responseFormat = SOURCE_API_RESPONSE_FORMATS.includes(form.responseFormat)
    ? form.responseFormat
    : 'json';

  const headerNames = form.headerNames
    .split(/[\n,]/)
    .map((name) => name.trim())
    .filter(Boolean);

  // Seule une RÉFÉRENCE (nom de variable d'environnement) est enregistrée —
  // jamais la valeur du secret, qui n'est pas stockée par le projet.
  const credentialRef = authType === 'none' ? '' : form.credentialRef.trim();
  if (authType !== 'none' && !credentialRef) {
    throw new Error(
      "La référence du secret (nom de variable d'environnement) est obligatoire pour ce type d'authentification.",
    );
  }

  const username = authType === 'basic_auth' ? form.username.trim() : '';
  if (authType === 'basic_auth' && !username) {
    throw new Error("L'utilisateur est obligatoire pour une authentification basic.");
  }

  const credentialLocation = SOURCE_API_CREDENTIAL_LOCATIONS.includes(form.credentialLocation)
    ? form.credentialLocation
    : 'header';
  const credentialKey =
    form.credentialKey.trim() || (credentialLocation === 'query' ? 'api_key' : 'X-API-Key');

  return {
    baseUrl,
    authType,
    headerNames,
    credentialRef: credentialRef || null,
    credentialLocation,
    credentialKey,
    username: username || null,
    responseFormat,
  };
}

export function GlobalCatalogAdminPanel() {
  const [products, setProducts] = useState<GlobalCatalogProduct[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /** Re-entrancy guard: blocks duplicate submits before React re-renders. */
  const savingRef = useRef(false);

  /** Same rationale for the import + review actions (state is stale in a closure). */
  const importBusyRef = useRef(false);
  const reviewBusyRef = useRef(false);

  // ── Import CSV / XLSX + review workflow state ────────────────────────────
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importCountry, setImportCountry] = useState<string>(
    () => listCountryOptions()[0]?.code ?? '',
  );
  const [importPreviewing, setImportPreviewing] = useState(false);
  const [importCommitting, setImportCommitting] = useState(false);
  const [importPreview, setImportPreview] =
    useState<GlobalCatalogImportPreview | null>(null);
  const [importResult, setImportResult] =
    useState<GlobalCatalogImportResult | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [reviewItems, setReviewItems] = useState<GlobalCatalogImportItem[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);

  // ── Historique des imports (lecture seule, GET uniquement) ───────────────
  const [importHistory, setImportHistory] = useState<GlobalCatalogImportRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // ── Sources Management (catalog_sources — GET/POST/PATCH admin) ───────────
  const [sources, setSources] = useState<GlobalCatalogSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourceCountryFilter, setSourceCountryFilter] = useState('');
  const [sourceTypeFilter, setSourceTypeFilter] = useState('');
  const [sourceStatusFilter, setSourceStatusFilter] = useState('');
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [editingSource, setEditingSource] = useState<GlobalCatalogSource | null>(null);
  const [sourceForm, setSourceForm] = useState<SourceForm>(EMPTY_SOURCE_FORM);
  /** Bloc « Connexion API » (= `configuration.api`) — visible si type = api. */
  const [sourceApiForm, setSourceApiForm] = useState<SourceApiForm>(EMPTY_SOURCE_API_FORM);
  /** Phase 3 : section « Mapping » (= `configuration.api.mapping`). */
  const [sourceMapping, setSourceMapping] = useState<SourceMappingState>(EMPTY_SOURCE_MAPPING);
  const [savingSource, setSavingSource] = useState(false);
  const [sourceBusyId, setSourceBusyId] = useState<string | null>(null);
  /** Re-entrancy guard (state is stale inside the closure). */
  const sourceBusyRef = useRef(false);

  // ── Phase 2 : « Tester la connexion » (POST .../test-connection) ──────────
  /** Id of the API source currently being probed (drives the row spinner). */
  const [sourceTestingId, setSourceTestingId] = useState<string | null>(null);
  /** Dernier résultat affiché — n'écrit jamais la source elle-même. */
  const [sourceTestResult, setSourceTestResult] = useState<{
    sourceName: string;
    result: GlobalCatalogSourceTestResult;
  } | null>(null);
  /** Re-entrancy guard : un seul test à la fois (state stale dans le closure). */
  const sourceTestingRef = useRef(false);

  // ── API Sync : lancement MANUEL d'une synchronisation (POST .../sync) ──────
  /** Id de la source en cours de synchronisation (spinner du bouton). */
  const [sourceSyncingId, setSourceSyncingId] = useState<string | null>(null);
  /** Dernier run affiché — uniquement des compteurs et un résumé assaini. */
  const [sourceSyncResult, setSourceSyncResult] = useState<{
    sourceName: string;
    result: GlobalCatalogSourceSyncResult;
  } | null>(null);
  /** Re-entrancy guard : une seule synchronisation à la fois dans l'UI. */
  const sourceSyncingRef = useRef(false);

  const countryOptions = listCountryOptions();
  const importBusy =
    importPreviewing || importCommitting || reviewBusyId !== null;

  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] =
    useState<GlobalCatalogProduct | null>(null);

  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);

  const loadProducts = async (): Promise<GlobalCatalogProduct[]> => {
    setLoading(true);
    setError(null);

    try {
      const result = await listGlobalCatalogProducts({
        search: search.trim() || undefined,
        page: 1,
        limit: 100,
      });

      // Server payload: { data: { data: rows[], page, limit, total } } — the API
      // client already unwraps the outer envelope, so the rows live in
      // `result.data`. Bare array / items / products are still tolerated.
      const rows: GlobalCatalogProduct[] = Array.isArray(result)
        ? result
        : Array.isArray(result?.data)
          ? result.data
          : Array.isArray(result?.items)
            ? result.items
            : Array.isArray(result?.products)
              ? result.products
              : [];

      setProducts(rows);

      return rows;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de charger le Global Catalog.',
      );

      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProducts();
    // Historique des imports: GET en lecture seule au montage du panneau.
    void loadImportHistory();
    // Sources: liste en lecture seule au montage du panneau.
    void loadSources();
  }, []);

  const openCreate = () => {
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setError(null);
    setSuccess(null);
  };

  const openEdit = (product: GlobalCatalogProduct) => {
    setEditingProduct(product);

    setForm({
      name: product.name ?? '',
      brand: product.brand ?? '',
      manufacturer: product.manufacturer ?? '',
      category: product.category ?? '',
      subcategory: product.subcategory ?? '',
      description: product.description ?? '',
      specification: product.specification ?? '',
      unit: product.unit ?? '',
      model: product.model ?? '',
      sku: product.sku ?? '',
      status: product.status ?? 'active',
      media: product.media,
      extra: product.extra,
    });

    setShowForm(true);
    setError(null);
    setSuccess(null);
  };

  const closeForm = () => {
    if (saving) return;

    setShowForm(false);
    setEditingProduct(null);
    setForm(EMPTY_FORM);
  };

  const updateField = (
    field: keyof ProductForm,
    value: string,
  ) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const saveProduct = async () => {
    // Duplicate-submit guard: a second click can land before React re-renders.
    if (savingRef.current) return;

    const name = form.name.trim();

    if (!name) {
      setError('Le nom du produit est obligatoire.');
      return;
    }

    const editing = editingProduct;
    const payload: ProductForm = { ...form, name };

    savingRef.current = true;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const saved = editing
        ? await adminUpdateGlobalProduct(editing.id, payload)
        : await adminCreateGlobalProduct(payload);

      // Close the modal directly: closeForm() is a no-op while `saving` is true.
      setShowForm(false);
      setEditingProduct(null);
      setForm(EMPTY_FORM);

      // Reload from the API so the list shows the persisted row immediately.
      const rows = await loadProducts();

      // Guarantee visibility even if the active search filter hides the row.
      if (saved?.id && !rows.some((row) => row.id === saved.id)) {
        setProducts((current) => [
          saved,
          ...current.filter((row) => row.id !== saved.id),
        ]);
      }

      setSuccess(
        editing
          ? `Produit « ${name} » mis à jour.`
          : `Produit « ${name} » créé.`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible d’enregistrer le produit.',
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // ── Import CSV / XLSX handlers ───────────────────────────────────────────
  const onPickImportFile = (file: File | null) => {
    setImportFile(file);
    setImportPreview(null);
    setImportResult(null);
    setImportId(null);
    setReviewItems([]);
    setError(null);
    setSuccess(null);
  };

  const loadReviewItems = async (id: string) => {
    if (!id) return;

    setReviewLoading(true);

    try {
      const rows = await listGlobalCatalogImportItems({
        importId: id,
        matchStatus: 'review_required',
        limit: 200,
      });

      setReviewItems(rows);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de charger les lignes à revoir.',
      );
    } finally {
      setReviewLoading(false);
    }
  };

  /**
   * Historique des imports — GET uniquement (aucune écriture, aucun test data).
   * Lecture des `catalog_imports` déjà présents en base.
   */
  const loadImportHistory = async (): Promise<GlobalCatalogImportRun[]> => {
    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const rows = await listGlobalCatalogImports({ limit: 50 });

      setImportHistory(rows);

      return rows;
    } catch (err) {
      setHistoryError(
        err instanceof Error
          ? err.message
          : "Impossible de charger l'historique des imports.",
      );

      return [];
    } finally {
      setHistoryLoading(false);
    }
  };

  /**
   * Sources — GET avec recherche + filtres (pays / type / statut).
   * Lecture seule : la création/modification passe par saveSource()/toggleSourceStatus().
   */
  const loadSources = async (): Promise<GlobalCatalogSource[]> => {
    setSourcesLoading(true);
    setSourcesError(null);
    // Un rechargement invalide le dernier résultat de test affiché.
    setSourceTestResult(null);

    try {
      const rows = await listGlobalCatalogSources({
        search: sourceSearch.trim() || undefined,
        country: sourceCountryFilter || undefined,
        type: sourceTypeFilter || undefined,
        status: sourceStatusFilter || undefined,
        limit: 100,
      });

      setSources(rows);

      return rows;
    } catch (err) {
      setSourcesError(
        err instanceof Error
          ? err.message
          : 'Impossible de charger les sources du catalogue.',
      );

      return [];
    } finally {
      setSourcesLoading(false);
    }
  };

  const openCreateSource = () => {
    setEditingSource(null);
    setSourceForm(EMPTY_SOURCE_FORM);
    setSourceApiForm(EMPTY_SOURCE_API_FORM);
    setSourceMapping(EMPTY_SOURCE_MAPPING);
    setShowSourceForm(true);
    setSourcesError(null);
    setSuccess(null);
  };

  const openEditSource = (source: GlobalCatalogSource) => {
    setEditingSource(source);

    setSourceForm({
      name: source.name ?? '',
      sourceType: source.sourceType ?? 'csv',
      countryCode: source.countryCode ?? '',
      provider: source.provider ?? '',
      url: source.url ?? '',
      updateFrequency: source.updateFrequency ?? '',
      status: source.status ?? 'active',
    });
    // Edit affiche les réglages déjà enregistrés (`configuration.api`).
    const apiConfiguration = readSourceConfiguration(source.configuration).api;
    setSourceApiForm(sourceApiToForm(apiConfiguration));
    // Phase 3 : le mapping existant re-peuple la section « Mapping ».
    setSourceMapping(
      mappingToState(
        apiConfiguration && typeof apiConfiguration === 'object'
          ? (apiConfiguration as { mapping?: unknown }).mapping
          : undefined,
      ),
    );

    setShowSourceForm(true);
    setSourcesError(null);
    setSuccess(null);
  };

  const closeSourceForm = () => {
    setShowSourceForm(false);
    setEditingSource(null);
    setSourceForm(EMPTY_SOURCE_FORM);
    setSourceApiForm(EMPTY_SOURCE_API_FORM);
    setSourceMapping(EMPTY_SOURCE_MAPPING);
  };

  const updateSourceField = (field: keyof SourceForm, value: string) => {
    setSourceForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateSourceApiField = (field: keyof SourceApiForm, value: string) => {
    setSourceApiForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateMappingField = (field: 'root' | 'collection', value: string) => {
    setSourceMapping((prev) => ({ ...prev, [field]: value }));
  };

  const updateMappingRow = (index: number, patch: Partial<GlobalCatalogApiMappingRow>) => {
    setSourceMapping((prev) => ({
      ...prev,
      rows: prev.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  };

  const removeMappingRow = (index: number) => {
    setSourceMapping((prev) => ({ ...prev, rows: prev.rows.filter((_, i) => i !== index) }));
  };

  /** N'ajoute que le premier champ Global Catalog encore non utilisé. */
  const addMappingRow = () => {
    setSourceMapping((prev) => {
      const used = new Set(prev.rows.map((row) => row.field.trim().toLowerCase()));
      const next = GLOBAL_CATALOG_API_MAPPING_FIELDS.find((f) => !used.has(f.key));
      if (!next) return prev;
      return { ...prev, rows: [...prev.rows, { field: next.key, path: '' }] };
    });
  };

  /**
   * Créer ou modifier une source (`catalog_sources` uniquement).
   * IMPORTANT: aucun import ni synchronisation n'est déclenché ici —
   * seule la fiche source est enregistrée.
   */
  const saveSource = async () => {
    if (sourceBusyRef.current) return;

    const name = sourceForm.name.trim();

    if (!name) {
      setSourcesError('Le nom de la source est obligatoire.');
      return;
    }

    sourceBusyRef.current = true;
    setSavingSource(true);
    setSourcesError(null);

    try {
      const sourceType = sourceForm.sourceType || 'csv';
      const isApiSource = sourceType === 'api';

      // `configuration` : les clés existantes sont conservées telles quelles.
      // - type API        → le bloc `api` est (re)construit depuis le formulaire ;
      // - passage api→autre→ le bloc `api` est retiré (CSV/XLSX ne l'utilisent pas) ;
      // - CSV/XLSX sans bloc api → `configuration` n'est PAS envoyée du tout,
      //   exactement comme avant cette phase : la colonne n'est pas réécrite.
      const configuration = readSourceConfiguration(editingSource?.configuration);
      const hadApiBlock = Object.prototype.hasOwnProperty.call(configuration, 'api');
      let configurationToSend: GlobalCatalogSourceConfiguration | undefined;

      if (isApiSource) {
        const apiConfiguration = sourceApiFormToConfiguration(sourceApiForm);
        // Phase 3 : `mapping` est optionnel. Une section vide l'omet donc du
        // payload, ce qui retire le mapping déjà enregistré (effacement sûr).
        const mapping = buildSourceApiMapping(sourceMapping);
        if (mapping) apiConfiguration.mapping = mapping;
        configuration.api = apiConfiguration;
        configurationToSend = configuration;
      } else if (hadApiBlock) {
        delete configuration.api;
        configurationToSend = configuration;
      }

      const payload: GlobalCatalogSourceInput = {
        name,
        sourceType,
        countryCode: sourceForm.countryCode?.trim() || null,
        provider: sourceForm.provider?.trim() || null,
        url: sourceForm.url?.trim() || null,
        updateFrequency: sourceForm.updateFrequency?.trim() || null,
        status: sourceForm.status || 'active',
        ...(configurationToSend ? { configuration: configurationToSend } : {}),
      };

      if (editingSource) {
        await adminUpdateGlobalCatalogSource(editingSource.id, payload);
        setSuccess(`Source « ${name} » mise à jour.`);
      } else {
        await adminCreateGlobalCatalogSource(payload);
        setSuccess(
          `Source « ${name} » créée (aucun import ni synchronisation lancé).`,
        );
      }

      closeSourceForm();
      await loadSources();
    } catch (err) {
      setSourcesError(
        err instanceof Error
          ? err.message
          : "Enregistrement de la source impossible.",
      );
    } finally {
      sourceBusyRef.current = false;
      setSavingSource(false);
    }
  };

  /** Activer / désactiver une source (`status` active ⇄ inactive via PATCH). */
  const toggleSourceStatus = async (source: GlobalCatalogSource) => {
    if (sourceBusyRef.current || sourceBusyId) return;

    const nextStatus = source.status === 'active' ? 'inactive' : 'active';

    sourceBusyRef.current = true;
    setSourceBusyId(source.id);
    setSourcesError(null);
    setSuccess(null);

    try {
      await adminUpdateGlobalCatalogSource(source.id, { status: nextStatus });

      setSuccess(
        nextStatus === 'inactive'
          ? `Source « ${source.name} » désactivée.`
          : `Source « ${source.name} » réactivée.`,
      );

      await loadSources();
    } catch (err) {
      setSourcesError(
        err instanceof Error
          ? err.message
          : 'Mise à jour du statut de la source impossible.',
      );
    } finally {
      sourceBusyRef.current = false;
      setSourceBusyId(null);
    }
  };

  /**
   * Phase 2 — « Tester la connexion ».
   *
   * Envoie UNIQUEMENT la requête de test côté serveur (une seule, à la
   * demande). Ne recharge PAS la liste : la source n'est pas modifiée, aucun
   * import et aucune synchronisation ne sont lancés.
   * Un refus serveur (source inconnue, type != api, secret absent, cible
   * privée) atterrit dans `sourcesError` ; la réponse du probe dans le bandeau
   * de résultat (succès ou échec, jamais de credential).
   */
  const testSourceConnection = async (source: GlobalCatalogSource) => {
    if (sourceTestingRef.current) return;
    // Le bouton n'est rendu que pour les sources de type `api` ; on verrouille
    // ici aussi pour qu'un changement de type en session ne puisse pas passer.
    if (source.sourceType !== 'api') return;

    sourceTestingRef.current = true;
    setSourceTestingId(source.id);
    setSourcesError(null);
    setSuccess(null);
    setSourceTestResult(null);

    try {
      const result = await testGlobalCatalogSourceConnection(source.id);
      setSourceTestResult({ sourceName: source.name, result });
    } catch (err) {
      setSourcesError(
        err instanceof Error ? err.message : 'Test de connexion impossible.',
      );
    } finally {
      sourceTestingRef.current = false;
      setSourceTestingId(null);
    }
  };

  /**
   * API Sync — lancement MANUEL.
   *
   * Appelle UNIQUEMENT le run de synchronisation côté serveur, qui réutilise
   * le resolver / normalization / matching / commit EXISTANTS. Ne recharge PAS
   * la liste des sources et n'écrit rien d'autre.
   *
   * Un refus serveur (source inconnue, type != api, secret absent, cible
   * privée, run déjà en cours) atterrit dans `sourcesError` ; le résultat du
   * run (succès / partiel / échec) dans le bandeau dédié, avec les compteurs
   * et le résumé assaini — jamais de credential ni de corps de réponse.
   */
  const runSourceSync = async (source: GlobalCatalogSource) => {
    if (sourceSyncingRef.current) return;
    // Le bouton n'est rendu que pour les sources de type `api` ; on verrouille
    // ici aussi pour qu'un changement de type en session ne puisse pas passer.
    if (source.sourceType !== 'api') return;

    sourceSyncingRef.current = true;
    setSourceSyncingId(source.id);
    setSourcesError(null);
    setSuccess(null);
    setSourceSyncResult(null);

    try {
      const result = await syncGlobalCatalogSource(source.id);
      setSourceSyncResult({ sourceName: source.name, result });
    } catch (err) {
      setSourcesError(
        err instanceof Error ? err.message : 'Synchronisation impossible.',
      );
    } finally {
      sourceSyncingRef.current = false;
      setSourceSyncingId(null);
    }
  };

  const runImportPreview = async () => {
    if (!importFile) {
      setError('Sélectionnez un fichier .csv ou .xlsx.');
      return;
    }

    if (importBusyRef.current) return;

    importBusyRef.current = true;
    setImportPreviewing(true);
    setError(null);
    setSuccess(null);
    setImportPreview(null);
    setImportResult(null);
    setImportId(null);
    setReviewItems([]);

    try {
      const preview = await previewGlobalCatalogImport(importFile, {
        countryCode: importCountry || undefined,
      });

      setImportPreview(preview);
      setSuccess(
        `Aperçu: ${preview.summary.total} ligne(s) — ${preview.summary.valid} valide(s), ${preview.summary.reviewRequired} à revoir.`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible de générer l'aperçu.",
      );
    } finally {
      importBusyRef.current = false;
      setImportPreviewing(false);
    }
  };

  const runImportCommit = async () => {
    if (!importFile) {
      setError('Sélectionnez un fichier .csv ou .xlsx.');
      return;
    }

    if (importBusyRef.current) return;

    importBusyRef.current = true;
    setImportCommitting(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await commitGlobalCatalogImport(importFile, {
        countryCode: importCountry || undefined,
      });

      setImportResult(result);
      setImportId(result.importId || null);
      setSuccess(
        `Import terminé: ${result.created} créé(s), ${result.updated} mis à jour, ${result.reviewRequired} à revoir, ${result.invalid} invalide(s).`,
      );

      if (result.importId) await loadReviewItems(result.importId);
      // The import may have created products: reload the list immediately.
      await loadProducts();
      // Read-only refresh: the finished run is now part of the Import History.
      await loadImportHistory();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible d'importer ce fichier.",
      );
    } finally {
      importBusyRef.current = false;
      setImportCommitting(false);
    }
  };

  const approveReviewItem = async (
    item: GlobalCatalogImportItem,
    globalProductId?: string,
  ) => {
    if (reviewBusyRef.current) return;

    reviewBusyRef.current = true;
    setReviewBusyId(item.id);
    setError(null);
    setSuccess(null);

    try {
      await adminApproveGlobalCatalogImportItem(
        item.id,
        globalProductId
          ? { action: 'link_existing', globalProductId }
          : { action: 'create_new' },
      );

      setSuccess(
        globalProductId
          ? 'Ligne liée à un produit global existant.'
          : 'Ligne approuvée: produit global créé.',
      );

      if (importId) await loadReviewItems(importId);
      await loadProducts();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible d'approuver cette ligne.",
      );
    } finally {
      reviewBusyRef.current = false;
      setReviewBusyId(null);
    }
  };

  const rejectReviewItem = async (item: GlobalCatalogImportItem) => {
    if (reviewBusyRef.current) return;

    reviewBusyRef.current = true;
    setReviewBusyId(item.id);
    setError(null);
    setSuccess(null);

    try {
      await adminRejectGlobalCatalogImportItem(
        item.id,
        'Rejeté depuis Admin → Global Catalog',
      );

      setSuccess('Ligne rejetée.');

      if (importId) await loadReviewItems(importId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Impossible de rejeter cette ligne.',
      );
    } finally {
      reviewBusyRef.current = false;
      setReviewBusyId(null);
    }
  };

  return (
    <div className="space-y-6 text-slate-100">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
              <Package size={21} />
            </div>

            <div>
              <h2 className="text-xl font-bold">
                Global Catalog
              </h2>
              <p className="text-sm text-slate-400">
                Catalogue global des produits KONSTRIVO.
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadProducts()}
            disabled={loading || saving}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw
              size={16}
              className={loading ? 'animate-spin' : ''}
            />
            Actualiser
          </button>

          <button
            type="button"
            onClick={openCreate}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-50"
          >
            <Plus size={17} />
            Nouveau produit
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={17}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void loadProducts();
              }
            }}
            placeholder="Rechercher un produit..."
            className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2.5 pl-10 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-400"
          />
        </div>

        <button
          type="button"
          onClick={() => void loadProducts()}
          disabled={loading || saving}
          className="rounded-lg border border-slate-700 bg-slate-900 px-5 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          Rechercher
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
          <Check size={18} className="mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* ── Import CSV / XLSX (Global Catalog) ──────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40">
        <button
          type="button"
          onClick={() => setShowImport((current) => !current)}
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-900/60"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Upload size={16} />
            Import CSV / XLSX
          </span>

          <span className="text-xs text-slate-500">
            {showImport ? 'Masquer' : 'Afficher'}
          </span>
        </button>

        {showImport && (
          <div className="border-t border-slate-800 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  Fichier (.csv ou .xlsx)
                </label>

                <input
                  type="file"
                  accept=".csv,.xlsx"
                  disabled={importBusy}
                  onChange={(event) =>
                    onPickImportFile(event.target.files?.[0] ?? null)
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-200 focus:border-emerald-400 disabled:opacity-50"
                />
              </div>

              <div className="sm:w-56">
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  Pays
                </label>

                <select
                  value={importCountry}
                  disabled={importBusy}
                  onChange={(event) => setImportCountry(event.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-400 disabled:opacity-50"
                >
                  <option value="">— Non précisé —</option>

                  {countryOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.flag ? `${option.flag} ` : ''}
                      {option.nameFr} ({option.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void runImportPreview()}
                  disabled={!importFile || importBusy}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  {importPreviewing ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <Eye size={16} />
                  )}
                  {importPreviewing ? 'Analyse...' : 'Aperçu'}
                </button>

                <button
                  type="button"
                  onClick={() => void runImportCommit()}
                  disabled={!importFile || !importPreview || importBusy}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-50"
                >
                  {importCommitting ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <Upload size={16} />
                  )}
                  {importCommitting ? 'Import...' : 'Commit'}
                </button>
              </div>
            </div>

            {importPreview && (
              <div className="mt-4">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['Type', importPreview.fileType],
                      ['Total', importPreview.summary.total],
                      ['Valides', importPreview.summary.valid],
                      ['Invalides', importPreview.summary.invalid],
                      ['Déjà présents', importPreview.summary.matched],
                      ['À revoir', importPreview.summary.reviewRequired],
                      ['Nouveaux', importPreview.summary.new],
                    ] as [string, string | number][]
                  ).map(([label, value]) => (
                    <span
                      key={label}
                      className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-400"
                    >
                      {label}:{' '}
                      <strong className="text-slate-100">{value}</strong>
                    </span>
                  ))}
                </div>

                <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-800">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="sticky top-0 border-b border-slate-800 bg-slate-900/95 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Ligne</th>
                        <th className="px-3 py-2">Produit</th>
                        <th className="px-3 py-2">Identifiant</th>
                        <th className="px-3 py-2">Pays</th>
                        <th className="px-3 py-2">Match</th>
                        <th className="px-3 py-2">Erreurs</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-800">
                      {importPreview.items.slice(0, 200).map((item) => (
                        <tr key={`${item.sourceRow}-${item.matchStatus}`}>
                          <td className="px-3 py-2 text-slate-500">
                            {item.sourceRow}
                          </td>

                          <td className="px-3 py-2 text-slate-200">
                            {item.normalized?.name || '—'}
                          </td>

                          <td className="px-3 py-2 text-slate-400">
                            {item.normalized?.identifier_value
                              ? `${item.normalized?.identifier_type || 'id'}: ${item.normalized.identifier_value}`
                              : '—'}
                          </td>

                          <td className="px-3 py-2 text-slate-400">
                            {item.normalized?.country || '—'}
                          </td>

                          <td className="px-3 py-2">
                            <MatchBadge status={item.matchStatus} />
                          </td>

                          <td className="px-3 py-2 text-slate-500">
                            {item.errors && item.errors.length > 0
                              ? item.errors.join(' · ')
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {importResult && (
              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
                    Créés: {importResult.created}
                  </span>

                  <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-300">
                    Mis à jour: {importResult.updated}
                  </span>

                  <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-300">
                    Déjà présents: {importResult.matched}
                  </span>

                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-amber-300">
                    À revoir: {importResult.reviewRequired}
                  </span>

                  <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-300">
                    Ignorés: {importResult.skipped}
                  </span>

                  <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-red-300">
                    Invalides: {importResult.invalid}
                  </span>
                </div>

                {importId && (
                  <p className="mt-2 break-all text-[11px] text-slate-500">
                    importId: {importId}
                  </p>
                )}
              </div>
            )}

            {importId && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-200">
                    Lignes à revoir ({reviewItems.length})
                  </h4>

                  <button
                    type="button"
                    onClick={() => void loadReviewItems(importId ?? '')}
                    disabled={reviewLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                  >
                    <RefreshCw
                      size={13}
                      className={reviewLoading ? 'animate-spin' : ''}
                    />
                    Recharger
                  </button>
                </div>

                {reviewLoading ? (
                  <p className="rounded-lg border border-slate-800 px-3 py-6 text-center text-xs text-slate-500">
                    Chargement des lignes à revoir...
                  </p>
                ) : reviewItems.length === 0 ? (
                  <p className="rounded-lg border border-slate-800 px-3 py-6 text-center text-xs text-slate-500">
                    Aucune ligne en attente de revue.
                  </p>
                ) : (
                  <div className="max-h-80 overflow-auto rounded-lg border border-slate-800">
                    <table className="w-full min-w-[820px] text-left text-xs">
                      <thead className="sticky top-0 border-b border-slate-800 bg-slate-900/95 text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Ligne</th>
                          <th className="px-3 py-2">Produit</th>
                          <th className="px-3 py-2">Identifiant</th>
                          <th className="px-3 py-2">Statut</th>
                          <th className="px-3 py-2">Notes</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-800">
                        {reviewItems.map((item) => {
                          const rowBusy = reviewBusyId === item.id;

                          return (
                            <tr key={item.id}>
                              <td className="px-3 py-2 text-slate-500">
                                {item.sourceRow ?? '—'}
                              </td>

                              <td className="px-3 py-2 text-slate-200">
                                {item.normalized?.name || '—'}
                              </td>

                              <td className="px-3 py-2 text-slate-400">
                                {item.normalized?.identifier_value
                                  ? `${item.normalized?.identifier_type || 'id'}: ${item.normalized.identifier_value}`
                                  : '—'}
                              </td>

                              <td className="px-3 py-2">
                                <MatchBadge status={item.matchStatus} />
                              </td>

                              <td className="px-3 py-2 text-slate-500">
                                {item.notes || '—'}
                              </td>

                              <td className="px-3 py-2">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void approveReviewItem(item)}
                                    disabled={importBusy}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                                  >
                                    <ThumbsUp size={13} />
                                    {rowBusy ? '...' : 'Approuver'}
                                  </button>

                                  {item.matchedGlobalProductId && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void approveReviewItem(
                                          item,
                                          item.matchedGlobalProductId as string,
                                        )
                                      }
                                      disabled={importBusy}
                                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                                    >
                                      <Link size={13} />
                                      Lier
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => void rejectReviewItem(item)}
                                    disabled={importBusy}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                                  >
                                    <ThumbsDown size={13} />
                                    Rejeter
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Sources du catalogue (catalog_sources) ───────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Database size={16} />
            Sources
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-400">
              {sources.length}
            </span>
          </span>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                value={sourceSearch}
                onChange={(event) => setSourceSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void loadSources();
                }}
                placeholder="Rechercher une source..."
                className="w-56 rounded-lg border border-slate-700 bg-slate-900 py-2 pl-8 pr-3 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-400"
              />
            </div>

            <select
              value={sourceCountryFilter}
              onChange={(event) => setSourceCountryFilter(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200 outline-none focus:border-emerald-400"
            >
              <option value="">Tous les pays</option>
              {countryOptions.map((cfg) => (
                <option key={cfg.code} value={cfg.code}>
                  {cfg.code} · {cfg.nameFr}
                </option>
              ))}
            </select>

            <select
              value={sourceTypeFilter}
              onChange={(event) => setSourceTypeFilter(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200 outline-none focus:border-emerald-400"
            >
              <option value="">Tous les types</option>
              {SOURCE_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {type.toUpperCase()}
                </option>
              ))}
            </select>

            <select
              value={sourceStatusFilter}
              onChange={(event) => setSourceStatusFilter(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200 outline-none focus:border-emerald-400"
            >
              <option value="">Tous les statuts</option>
              {SOURCE_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status === 'active' ? 'Active' : 'Inactive'}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void loadSources()}
              disabled={sourcesLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw
                size={14}
                className={sourcesLoading ? 'animate-spin' : ''}
              />
              Actualiser
            </button>

            <button
              type="button"
              onClick={openCreateSource}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-300"
            >
              <Plus size={14} />
              Nouvelle source
            </button>
          </div>
        </div>

        <div className="border-t border-slate-800 p-4">
          {sourcesError && (
            <div className="mb-3 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{sourcesError}</span>
            </div>
          )}

          {/* ── Phase 2 : résultat du « Tester la connexion » ───────────────
              Bandeau informatif uniquement : il n'écrit jamais la source,
              ne lance ni import ni synchronisation, et n'affiche ni credential
              ni URL portant une query (le serveur ne renvoie que l'origine). */}
          {sourceTestResult && (
            <div
              className={`mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-xs ${
                sourceTestResult.result.success
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-300'
              }`}
            >
              <span className="inline-flex items-center gap-1.5 font-semibold">
                {sourceTestResult.result.success ? (
                  <Check size={14} />
                ) : (
                  <AlertCircle size={14} />
                )}
                {sourceTestResult.result.success ? 'Connexion OK' : 'Connexion échouée'}
              </span>

              <span className="text-slate-300">
                {sourceTestResult.sourceName} — {sourceTestResult.result.message}
              </span>

              <span className="font-mono text-[11px] text-slate-400">
                {sourceTestResult.result.target || '—'}
                {sourceTestResult.result.status !== null
                  ? ` · HTTP ${sourceTestResult.result.status}`
                  : ''}
                {` · ${sourceTestResult.result.durationMs} ms`}
                {sourceTestResult.result.format ? ` · ${sourceTestResult.result.format}` : ''}
              </span>
            </div>
          )}

          {/* ── API Sync : résultat du run manuel ───────────────────────────
              Bandeau informatif : uniquement des compteurs, un statut et le
              résumé assaini renvoyés par le serveur. Il n'affiche jamais de
              credential, d'Authorization header ni de corps de réponse, et il
              n'écrit jamais la source. */}
          {sourceSyncResult && (
            <div
              className={`mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-xs ${
                sourceSyncResult.result.status === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : sourceSyncResult.result.status === 'partial'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : 'border-red-500/30 bg-red-500/10 text-red-300'
              }`}
            >
              <span className="inline-flex items-center gap-1.5 font-semibold">
                {sourceSyncResult.result.status === 'success' ? (
                  <Check size={14} />
                ) : sourceSyncResult.result.status === 'partial' ? (
                  <AlertCircle size={14} />
                ) : (
                  <AlertCircle size={14} />
                )}
                {sourceSyncResult.result.status === 'success'
                  ? 'Synchronisation OK'
                  : sourceSyncResult.result.status === 'partial'
                    ? 'Synchronisation partielle'
                    : 'Synchronisation échouée'}
              </span>

              <span className="text-slate-300">
                {sourceSyncResult.sourceName} —{' '}
                {sourceSyncResult.result.message}
              </span>

              <span className="font-mono text-[11px] text-slate-400">
                {sourceSyncResult.result.counts.total} lu ·{' '}
                {sourceSyncResult.result.counts.created} créé(s) ·{' '}
                {sourceSyncResult.result.counts.matched} apparié(s) ·{' '}
                {sourceSyncResult.result.counts.updated} mis à jour ·{' '}
                {sourceSyncResult.result.counts.reviewRequired} à revoir
              </span>
            </div>
          )}

          <p className="mb-3 text-[11px] text-slate-500">
            Ajouter ou modifier une source n'importe aucun fichier et ne lance
            aucune synchronisation : l'import reste exclusivement manuel
            (Prévisualiser / Importer).
          </p>

          {sourcesLoading && sources.length === 0 ? (
            <p className="rounded-lg border border-slate-800 px-3 py-6 text-center text-xs text-slate-500">
              Chargement des sources...
            </p>
          ) : sources.length === 0 ? (
            <p className="rounded-lg border border-slate-800 px-3 py-6 text-center text-xs text-slate-500">
              Aucune source enregistrée.
            </p>
          ) : (
            <div className="overflow-auto rounded-lg border border-slate-800">
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="border-b border-slate-800 bg-slate-900/95 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Nom</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Pays</th>
                    <th className="px-3 py-2">Fournisseur</th>
                    <th className="px-3 py-2">Statut</th>
                    <th className="px-3 py-2">Dernière synchronisation</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800">
                  {sources.map((source) => (
                    <tr
                      key={source.id}
                      className="transition hover:bg-slate-900/60"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-100">
                          {source.name}
                        </div>

                        {source.url && (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 block max-w-[240px] truncate text-[11px] text-sky-400 hover:underline"
                            title={source.url}
                          >
                            {source.url}
                          </a>
                        )}

                        <div className="mt-0.5 font-mono text-[10px] text-slate-600">
                          {source.id}
                        </div>
                      </td>

                      <td className="px-3 py-2">
                        <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] uppercase text-slate-300">
                          {source.sourceType}
                        </span>
                      </td>

                      <td className="px-3 py-2 text-slate-300">
                        {source.countryCode || '—'}
                      </td>

                      <td className="px-3 py-2 text-slate-400">
                        <div
                          className="max-w-[180px] truncate"
                          title={source.provider || ''}
                        >
                          {source.provider || '—'}
                        </div>

                        {source.updateFrequency && (
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {source.updateFrequency}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2">
                        <SourceStatusBadge status={source.status} />
                      </td>

                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                        {source.lastSuccessfulSyncAt
                          ? formatImportDate(source.lastSuccessfulSyncAt)
                          : '— jamais'}
                      </td>

                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          {/* ── Phase 2 : visible UNIQUEMENT pour type = api ── */}
                          {source.sourceType === 'api' && (
                            <button
                              type="button"
                              onClick={() => void testSourceConnection(source)}
                              disabled={sourceTestingId !== null || sourceBusyId !== null}
                              title="Tester la connexion (aucun import, aucune synchronisation)"
                              className="inline-flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
                            >
                              {sourceTestingId === source.id ? (
                                <RefreshCw size={12} className="animate-spin" />
                              ) : (
                                <Link size={12} />
                              )}
                              {sourceTestingId === source.id
                                ? 'Test...'
                                : 'Tester la connexion'}
                            </button>
                          )}

                          {/* ── API Sync : visible UNIQUEMENT pour type = api ── */}
                          {source.sourceType === 'api' && (
                            <button
                              type="button"
                              onClick={() => void runSourceSync(source)}
                              disabled={sourceSyncingId !== null || sourceBusyId !== null}
                              title="Synchroniser maintenant (API uniquement — réutilise le resolver, le matching et la revue existants)"
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                            >
                              {sourceSyncingId === source.id ? (
                                <RefreshCw size={12} className="animate-spin" />
                              ) : (
                                <RefreshCw size={12} />
                              )}
                              {sourceSyncingId === source.id
                                ? 'Sync...'
                                : 'Synchroniser'}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => openEditSource(source)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800"
                          >
                            <Pencil size={12} />
                            Modifier
                          </button>

                          <button
                            type="button"
                            onClick={() => void toggleSourceStatus(source)}
                            disabled={sourceBusyId !== null}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] disabled:opacity-50 ${
                              source.status === 'active'
                                ? 'border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20'
                                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                            }`}
                          >
                            <Power size={12} />
                            {sourceBusyId === source.id
                              ? '...'
                              : source.status === 'active'
                                ? 'Désactiver'
                                : 'Réactiver'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Historique des imports (lecture seule) ───────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <History size={16} />
            Historique des imports
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-400">
              {importHistory.length}
            </span>
          </span>

          <button
            type="button"
            onClick={() => void loadImportHistory()}
            disabled={historyLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              className={historyLoading ? 'animate-spin' : ''}
            />
            Actualiser
          </button>
        </div>

        <div className="border-t border-slate-800 p-4">
          {historyError && (
            <div className="mb-3 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{historyError}</span>
            </div>
          )}

          {historyLoading && importHistory.length === 0 ? (
            <p className="rounded-lg border border-slate-800 px-3 py-6 text-center text-xs text-slate-500">
              Chargement de l'historique des imports...
            </p>
          ) : importHistory.length === 0 ? (
            <p className="rounded-lg border border-slate-800 px-3 py-6 text-center text-xs text-slate-500">
              Aucun import enregistré.
            </p>
          ) : (
            <div className="max-h-96 overflow-auto rounded-lg border border-slate-800">
              <table className="w-full min-w-[980px] text-left text-xs">
                <thead className="sticky top-0 border-b border-slate-800 bg-slate-900/95 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Fichier / Source</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Pays</th>
                    <th className="px-3 py-2">Statut</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Valid</th>
                    <th className="px-3 py-2 text-right">Invalid</th>
                    <th className="px-3 py-2 text-right">Matched</th>
                    <th className="px-3 py-2 text-right">Review</th>
                    <th className="px-3 py-2 text-right">New</th>
                    <th className="px-3 py-2">Import ID</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800">
                  {importHistory.map((run) => (
                    <tr
                      key={run.importId}
                      className="transition hover:bg-slate-900/60"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-slate-300">
                        {formatImportDate(run.createdAt)}
                      </td>

                      <td className="px-3 py-2 text-slate-200">
                        <div
                          className="max-w-[260px] truncate"
                          title={run.fileName || ''}
                        >
                          {run.fileName || '—'}
                        </div>

                        {run.sourceName && run.sourceName !== run.fileName && (
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {run.sourceName}
                          </div>
                        )}

                        {run.sourceType && (
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            source: {run.sourceType}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2">
                        <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">
                          {run.fileType || '—'}
                        </span>
                      </td>

                      <td className="px-3 py-2 text-slate-400">
                        {run.countryCode || '—'}
                      </td>

                      <td className="px-3 py-2">
                        <ImportRunStatusBadge status={run.status} />
                      </td>

                      <td className="px-3 py-2 text-right font-medium text-slate-100">
                        {run.total}
                      </td>

                      <td className="px-3 py-2 text-right text-emerald-300">
                        {run.valid}
                      </td>

                      <td className="px-3 py-2 text-right text-red-300">
                        {run.invalid}
                      </td>

                      <td className="px-3 py-2 text-right text-sky-300">
                        {run.matched}
                      </td>

                      <td className="px-3 py-2 text-right text-amber-300">
                        {run.review}
                      </td>

                      <td className="px-3 py-2 text-right text-slate-300">
                        {run.new}
                      </td>

                      <td className="px-3 py-2">
                        <span
                          className="block max-w-[150px] truncate font-mono text-[11px] text-slate-500"
                          title={run.importId}
                        >
                          {run.importId}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Produit</th>
                <th className="px-4 py-3">Marque</th>
                <th className="px-4 py-3">Catégorie</th>
                <th className="px-4 py-3">Unité</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    Chargement du catalogue...
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    Aucun produit trouvé.
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr
                    key={product.id}
                    className="transition hover:bg-slate-900/60"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-100">
                        {product.name}
                      </div>

                      {product.sku && (
                        <div className="mt-1 text-xs text-slate-500">
                          SKU: {product.sku}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-slate-300">
                      {product.brand || '—'}
                    </td>

                    <td className="px-4 py-3 text-slate-300">
                      {product.category || '—'}
                    </td>

                    <td className="px-4 py-3 text-slate-300">
                      {product.unit || '—'}
                    </td>

                    <td className="px-4 py-3">
                      <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300">
                        {product.status || '—'}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(product)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
                      >
                        <Pencil size={14} />
                        Modifier
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-4">
              <div>
                <h3 className="font-bold">
                  {editingProduct
                    ? 'Modifier le produit'
                    : 'Nouveau produit'}
                </h3>

                <p className="mt-1 text-xs text-slate-500">
                  Global Catalog
                </p>
              </div>

              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
              >
                <X size={19} />
              </button>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field
                label="Nom *"
                value={form.name ?? ''}
                onChange={(value) => updateField('name', value)}
              />

              <Field
                label="Marque"
                value={form.brand ?? ''}
                onChange={(value) => updateField('brand', value)}
              />

              <Field
                label="Fabricant"
                value={form.manufacturer ?? ''}
                onChange={(value) =>
                  updateField('manufacturer', value)
                }
              />

              <Field
                label="Catégorie"
                value={form.category ?? ''}
                onChange={(value) =>
                  updateField('category', value)
                }
              />

              <Field
                label="Sous-catégorie"
                value={form.subcategory ?? ''}
                onChange={(value) =>
                  updateField('subcategory', value)
                }
              />

              <Field
                label="Unité"
                value={form.unit ?? ''}
                onChange={(value) => updateField('unit', value)}
              />

              <Field
                label="Modèle"
                value={form.model ?? ''}
                onChange={(value) => updateField('model', value)}
              />

              <Field
                label="SKU"
                value={form.sku ?? ''}
                onChange={(value) => updateField('sku', value)}
              />

              <Field
                label="Statut"
                value={form.status ?? 'active'}
                onChange={(value) => updateField('status', value)}
              />

              <div className="sm:col-span-2">
                <Field
                  label="Spécification"
                  value={form.specification ?? ''}
                  onChange={(value) =>
                    updateField('specification', value)
                  }
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  Description
                </label>

                <textarea
                  value={form.description ?? ''}
                  onChange={(event) =>
                    updateField('description', event.target.value)
                  }
                  rows={4}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-400"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-4">
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                Annuler
              </button>

              <button
                type="button"
                onClick={() => void saveProduct()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-50"
              >
                {saving ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: créer / modifier une source (catalog_sources) ──────────── */}
      {showSourceForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-800 px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  {editingSource ? 'Modifier la source' : 'Nouvelle source'}
                </h3>

                <p className="mt-0.5 text-[11px] text-slate-500">
                  Enregistrement de la fiche uniquement : aucun import et aucune
                  synchronisation ne sont déclenchés.
                </p>
              </div>

              <button
                type="button"
                onClick={closeSourceForm}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {sourcesError && (
                <div className="mb-3 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{sourcesError}</span>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field
                    label="Nom de la source *"
                    value={sourceForm.name}
                    onChange={(value) => updateSourceField('name', value)}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    Type de source
                  </label>

                  <select
                    value={sourceForm.sourceType}
                    onChange={(event) =>
                      updateSourceField('sourceType', event.target.value)
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-400"
                  >
                    {(SOURCE_TYPE_OPTIONS.includes(sourceForm.sourceType)
                      ? SOURCE_TYPE_OPTIONS
                      : [sourceForm.sourceType, ...SOURCE_TYPE_OPTIONS]
                    ).map((type) => (
                      <option key={type} value={type}>
                        {type.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    Pays
                  </label>

                  <select
                    value={sourceForm.countryCode ?? ''}
                    onChange={(event) =>
                      updateSourceField('countryCode', event.target.value)
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-400"
                  >
                    <option value="">— Aucun pays —</option>
                    {countryOptions.map((cfg) => (
                      <option key={cfg.code} value={cfg.code}>
                        {cfg.code} · {cfg.nameFr}
                      </option>
                    ))}
                  </select>
                </div>

                <Field
                  label="Fournisseur"
                  value={sourceForm.provider ?? ''}
                  onChange={(value) => updateSourceField('provider', value)}
                />

                <Field
                  label="URL"
                  value={sourceForm.url ?? ''}
                  onChange={(value) => updateSourceField('url', value)}
                />

                <Field
                  label="Fréquence de mise à jour"
                  value={sourceForm.updateFrequency ?? ''}
                  onChange={(value) =>
                    updateSourceField('updateFrequency', value)
                  }
                />

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    Statut
                  </label>

                  <select
                    value={sourceForm.status ?? 'active'}
                    onChange={(event) =>
                      updateSourceField('status', event.target.value)
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-400"
                  >
                    {SOURCE_STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status === 'active'
                          ? 'Active'
                          : 'Inactive (désactivée)'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ── Phase 1 : réglages de connexion API (type = api UNIQUEMENT)
                    = `configuration.api`. Aucune requête, aucun test de
                    connexion, aucune synchronisation ne sont déclenchés. ─── */}
              {sourceForm.sourceType === 'api' && (
                <div className="mt-4 rounded-lg border border-sky-500/25 bg-sky-500/5 p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-sky-300">
                    <Link size={14} />
                    Connexion API
                    <span className="font-mono font-normal text-slate-500">
                      configuration.api
                    </span>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Field
                        label="URL de base / endpoint *"
                        value={sourceApiForm.baseUrl}
                        onChange={(value) => updateSourceApiField('baseUrl', value)}
                      />
                      <p className="mt-1 text-[10px] text-slate-600">
                        Ex. https://api.fournisseur.tn/v1/produits
                      </p>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-400">
                        Type d'authentification
                      </label>

                      <select
                        value={sourceApiForm.authType}
                        onChange={(event) =>
                          updateSourceApiField('authType', event.target.value)
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-400"
                      >
                        {SOURCE_API_AUTH_OPTIONS.map((authType) => (
                          <option key={authType} value={authType}>
                            {SOURCE_API_AUTH_LABELS[authType] || authType}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-400">
                        Format de réponse
                      </label>

                      <select
                        value={sourceApiForm.responseFormat}
                        onChange={(event) =>
                          updateSourceApiField('responseFormat', event.target.value)
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-400"
                      >
                        {SOURCE_API_RESPONSE_FORMATS.map((format) => (
                          <option key={format} value={format}>
                            {format.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </div>
                    {sourceApiForm.authType === 'api_key' && (
                      <>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-slate-400">
                            Emplacement de la clé
                          </label>

                          <select
                            value={sourceApiForm.credentialLocation}
                            onChange={(event) =>
                              updateSourceApiField('credentialLocation', event.target.value)
                            }
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-400"
                          >
                            {SOURCE_API_CREDENTIAL_LOCATIONS.map((location) => (
                              <option key={location} value={location}>
                                {location === 'header' ? 'En-tête HTTP' : 'Paramètre URL'}
                              </option>
                            ))}
                          </select>
                        </div>

                        <Field
                          label="Nom de l'en-tête / du paramètre"
                          value={sourceApiForm.credentialKey}
                          onChange={(value) => updateSourceApiField('credentialKey', value)}
                        />
                      </>
                    )}

                    {sourceApiForm.authType === 'basic_auth' && (
                      <Field
                        label="Utilisateur *"
                        value={sourceApiForm.username}
                        onChange={(value) => updateSourceApiField('username', value)}
                      />
                    )}

                    {sourceApiForm.authType !== 'none' && (
                      <div className="sm:col-span-2">
                        <Field
                          label="Référence du secret (variable d'environnement) *"
                          value={sourceApiForm.credentialRef}
                          onChange={(value) => updateSourceApiField('credentialRef', value)}
                        />
                        <p className="mt-1 text-[10px] text-slate-600">
                          Nom de la variable uniquement, ex. SOURCE_ACME_API_KEY.
                          La valeur du secret n'est jamais saisie ni enregistrée
                          ici (le projet n'a pas de coffre-fort de secrets).
                        </p>
                      </div>
                    )}

                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-xs font-medium text-slate-400">
                        En-têtes HTTP (noms seulement)
                      </label>

                      <textarea
                        value={sourceApiForm.headerNames}
                        onChange={(event) =>
                          updateSourceApiField('headerNames', event.target.value)
                        }
                        rows={3}
                        placeholder={'X-Api-Version\nAccept-Language'}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-400"
                      />
                      <p className="mt-1 text-[10px] text-slate-600">
                        Un nom d'en-tête par ligne. Les valeurs d'en-tête ne sont
                        pas enregistrées (elles pourraient contenir un secret).
                      </p>
                    </div>
                  </div>

                  {/* ── Phase 3 : Mapping de la réponse API ───────────────
                      Métadonnée SEULEMENT : elle décrit COMMENT une réponse
                      serait lue. Aucune requête, aucun import, aucune
                      synchronisation n'en découle, et ni donnée de réponse ni
                      credential n'est stocké. Masqué pour CSV/XLSX. ──────── */}
                  <div className="mt-4 border-t border-sky-500/20 pt-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-sky-300">
                        Mapping de la réponse
                        <span className="ml-2 font-mono font-normal text-slate-500">
                          configuration.api.mapping
                        </span>
                      </span>

                      <button
                        type="button"
                        onClick={addMappingRow}
                        disabled={
                          sourceMapping.rows.length >= GLOBAL_CATALOG_API_MAPPING_FIELDS.length
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
                      >
                        <Plus size={12} />
                        Ajouter un champ
                      </button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Chemin de la racine de réponse"
                        value={sourceMapping.root}
                        onChange={(value) => updateMappingField('root', value)}
                      />
                      <Field
                        label="Chemin de la collection de produits"
                        value={sourceMapping.collection}
                        onChange={(value) => updateMappingField('collection', value)}
                      />
                    </div>

                    <p className="mb-3 text-[10px] text-slate-600">
                      Ex. racine <span className="font-mono">data</span>, collection{' '}
                      <span className="font-mono">products</span> ⇒ une valeur est adressée{' '}
                      <span className="font-mono">data.products[].&lt;champ&gt;</span>. Laisser
                      vide pour la racine du document / un tableau racine.
                    </p>
                    {sourceMapping.rows.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-slate-700 px-3 py-5 text-center text-[11px] text-slate-500">
                        Aucun champ mappé — la section est facultative. Ajoutez un
                        champ pour décrire comment lire la réponse.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {sourceMapping.rows.map((row, index) => {
                          const composed = row.path.trim()
                            ? describeApiMappingPath(
                                sourceMapping.root,
                                sourceMapping.collection,
                                row.path,
                              )
                            : '';

                          return (
                            <div
                              key={`${index}-${row.field}`}
                              className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2"
                            >
                              <div className="min-w-[160px] flex-1">
                                <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
                                  Champ Global Catalog
                                </label>

                                <select
                                  value={row.field}
                                  onChange={(event) =>
                                    updateMappingRow(index, { field: event.target.value })
                                  }
                                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
                                >
                                  {GLOBAL_CATALOG_API_MAPPING_FIELDS.map((option) => (
                                    <option key={option.key} value={option.key}>
                                      {option.label}
                                      {option.required ? ' *' : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="min-w-[160px] flex-1">
                                <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
                                  Chemin dans la réponse
                                </label>

                                <input
                                  value={row.path}
                                  onChange={(event) =>
                                    updateMappingRow(index, { path: event.target.value })
                                  }
                                  placeholder="name"
                                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-400"
                                />
                              </div>

                              <span
                                className="max-w-[180px] truncate pb-2 font-mono text-[10px] text-slate-500"
                                title={composed || '—'}
                              >
                                {composed || '—'}
                              </span>

                              <button
                                type="button"
                                onClick={() => removeMappingRow(index)}
                                aria-label="Retirer ce champ"
                                className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:border-red-500/40 hover:text-red-300"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <p className="mt-3 text-[10px] text-slate-600">
                      Le champ <span className="font-medium text-slate-400">Nom du produit *</span>{' '}
                      est obligatoire dès qu'un champ est mappé. Seule la structure est
                      enregistrée : aucune donnée de réponse, aucun credential. Le mapping
                      ne déclenche ni requête, ni import, ni synchronisation.
                    </p>
                  </div>

                  <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-[10px] leading-relaxed text-slate-500">
                    Enregistrement de la fiche uniquement : cet enregistrement
                    n'envoie aucune requête et ne lance ni import ni
                    synchronisation. (Un test de connexion manuel reste possible
                    depuis la liste des sources.)
                  </p>
                </div>
              )}

              {editingSource && (
                <div className="mt-4 space-y-1 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-[11px] text-slate-500">
                  <div className="font-mono">{editingSource.id}</div>

                  <div>
                    Créée le {formatImportDate(editingSource.createdAt)} ·
                    modifiée le {formatImportDate(editingSource.updatedAt)}
                  </div>

                  <div>
                    Dernière synchronisation :{' '}
                    {editingSource.lastSuccessfulSyncAt
                      ? formatImportDate(editingSource.lastSuccessfulSyncAt)
                      : '— jamais (la synchronisation est hors périmètre)'}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-4">
              <button
                type="button"
                onClick={closeSourceForm}
                disabled={savingSource}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                Annuler
              </button>

              <button
                type="button"
                onClick={() => void saveSource()}
                disabled={savingSource}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-50"
              >
                {savingSource ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                {savingSource ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-400">
        {label}
      </label>

      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-400"
      />
    </div>
  );
}

/** Import matchStatus badge (preview + review tables). */
function MatchBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    new: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    matched: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
    possible_match: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    review_required: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    rejected: 'border-red-500/30 bg-red-500/10 text-red-300',
  };

  return (
    <span
      className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] ${
        styles[status] || 'border-slate-700 bg-slate-900 text-slate-300'
      }`}
    >
      {status}
    </span>
  );
}

/**
 * Date/heure `fr-FR` (robuste aux valeurs nulles/invalides).
 * Utilisée pour l'historique des imports ET pour les dates des sources.
 */
function formatImportDate(value?: string | null): string {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/** Statut d'un run d'import (`catalog_imports.import_status`). */
function ImportRunStatusBadge({ status }: { status?: string | null }) {
  const key = String(status || 'UPLOADED');

  const styles: Record<string, string> = {
    COMPLETED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    COMPLETED_WITH_ERRORS:
      'border-amber-500/40 bg-amber-500/10 text-amber-300',
    UPLOADED: 'border-slate-700 bg-slate-900 text-slate-300',
    FAILED: 'border-red-500/30 bg-red-500/10 text-red-300',
  };

  return (
    <span
      className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] ${
        styles[key] || 'border-slate-700 bg-slate-900 text-slate-300'
      }`}
    >
      {key}
    </span>
  );
}

/** Statut d'une source (`catalog_sources.status`: active | inactive). */
function SourceStatusBadge({ status }: { status?: string | null }) {
  const key = String(status || 'active');

  const styles: Record<string, string> = {
    active: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    inactive: 'border-slate-700 bg-slate-900 text-slate-400',
  };

  return (
    <span
      className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] ${
        styles[key] || 'border-slate-700 bg-slate-900 text-slate-300'
      }`}
    >
      {key === 'active' ? 'Active' : key === 'inactive' ? 'Inactive' : key}
    </span>
  );
}