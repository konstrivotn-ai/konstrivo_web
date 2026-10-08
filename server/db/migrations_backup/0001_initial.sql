-- ═══════════════════════════════════════════════════════════════════════
-- Phase 3 — KONSTRIVO PostgreSQL Initial Migration (0001_initial.sql)
-- Apply with: npx drizzle-kit migrate   (requires DATABASE_URL)
-- ═══════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(254) NOT NULL UNIQUE,
    phone           VARCHAR(20),
    full_name       VARCHAR(200) NOT NULL,
    password_hash   TEXT NOT NULL,
    global_role     VARCHAR(30) NOT NULL DEFAULT 'artisan',
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    avatar_url      TEXT,
    preferred_lang  VARCHAR(10) DEFAULT 'fr',
    region          VARCHAR(100),
    country         VARCHAR(5) DEFAULT 'TN',
    license_number  VARCHAR(50),
    matricule_fiscale VARCHAR(30),
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version         INTEGER NOT NULL DEFAULT 1,
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS companies (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legal_name          VARCHAR(255) NOT NULL,
    trade_name          VARCHAR(255),
    country_code        VARCHAR(5) NOT NULL DEFAULT 'TN',
    currency_code       VARCHAR(5) NOT NULL DEFAULT 'TND',
    tax_id_matricule_fiscal VARCHAR(50),
    commercial_register_rc  VARCHAR(50),
    logo_url            TEXT,
    address_street      TEXT,
    address_city        VARCHAR(100),
    address_postal_code VARCHAR(10),
    bank_rib            VARCHAR(50),
    website_url         TEXT,
    phone               VARCHAR(20),
    email               VARCHAR(254),
    status              VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version             INTEGER NOT NULL DEFAULT 1,
    is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS company_members (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id),
    company_id  UUID NOT NULL REFERENCES companies(id),
    role        VARCHAR(30) NOT NULL DEFAULT 'artisan',
    tier        VARCHAR(20) NOT NULL DEFAULT 'FREE',
    entitlements JSONB NOT NULL DEFAULT '[]',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version     INTEGER NOT NULL DEFAULT 1,
    is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_company_member UNIQUE (user_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON company_members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_company ON company_members(company_id);

CREATE TABLE IF NOT EXISTS subscriptions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id              UUID NOT NULL REFERENCES companies(id),
    tier                    VARCHAR(20) NOT NULL DEFAULT 'FREE',
    status                  VARCHAR(20) NOT NULL DEFAULT 'active',
    current_period_start    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_end      TIMESTAMPTZ,
    cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE,
    trial_ends_at           TIMESTAMPTZ,
    payment_method_id       VARCHAR(100),
    discount_code           VARCHAR(50),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version                 INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_company ON subscriptions(company_id);

CREATE TABLE IF NOT EXISTS materials (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            VARCHAR(100) NOT NULL,
    trade           VARCHAR(50) NOT NULL,
    category        VARCHAR(50) NOT NULL,
    name_fr         TEXT NOT NULL,
    name_ar         TEXT,

CREATE TABLE IF NOT EXISTS price_sources (
    code            VARCHAR(50) PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    is_verified     BOOLEAN NOT NULL DEFAULT TRUE,
    priority_weight INTEGER NOT NULL DEFAULT 50
);

CREATE TABLE IF NOT EXISTS material_prices (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    material_id         UUID NOT NULL REFERENCES materials(id),
    source_code         VARCHAR(50) NOT NULL REFERENCES price_sources(code),
    country_code        VARCHAR(5) NOT NULL DEFAULT 'TN',
    currency_code       VARCHAR(5) NOT NULL DEFAULT 'TND',
    unit_price          NUMERIC(12,3) NOT NULL CHECK (unit_price >= 0),
    company_id          UUID REFERENCES companies(id),
    supplier_id         UUID,
    is_current          BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from      DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to        DATE,
    package_definition_id UUID,
    package_price       NUMERIC(12,3),
    supplier_catalog_item_id UUID,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version             INTEGER NOT NULL DEFAULT 1,
    is_deleted          BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_prices_material ON material_prices(material_id);
CREATE INDEX IF NOT EXISTS idx_prices_country ON material_prices(country_code);
CREATE INDEX IF NOT EXISTS idx_prices_currency ON material_prices(currency_code);
CREATE INDEX IF NOT EXISTS idx_prices_is_current ON material_prices(is_current);
CREATE INDEX IF NOT EXISTS idx_prices_company ON material_prices(company_id);
CREATE INDEX IF NOT EXISTS idx_prices_supplier ON material_prices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_prices_effective_from ON material_prices(effective_from);

CREATE TABLE IF NOT EXISTS package_definitions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    material_id         UUID NOT NULL REFERENCES materials(id),
    package_type        VARCHAR(20) NOT NULL DEFAULT 'unit',
    units_per_package   NUMERIC(12,3) NOT NULL DEFAULT 1,
    allow_partial       BOOLEAN NOT NULL DEFAULT FALSE,
    barcode             VARCHAR(50),
    package_dimensions  VARCHAR(100),
    package_weight_kg   NUMERIC(10,3),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version             INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS devis (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id              UUID NOT NULL REFERENCES companies(id),
    created_by_user_id      UUID NOT NULL REFERENCES users(id),

CREATE TABLE IF NOT EXISTS devis_items (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    devis_id                UUID NOT NULL REFERENCES devis(id),
    line_number             INTEGER NOT NULL DEFAULT 1,
    material_id             UUID REFERENCES materials(id),
    trade                   VARCHAR(50),
    title                   TEXT,
    description_snapshot    TEXT,
    unit                    VARCHAR(20),
    exact_calculated_quantity   NUMERIC(12,3) DEFAULT 0,
    waste_included_quantity     NUMERIC(12,3) DEFAULT 0,
    billable_quantity           NUMERIC(12,3) DEFAULT 0,
    unit_price_applied_tnd  NUMERIC(12,3) NOT NULL DEFAULT 0,
    total_price_tnd         NUMERIC(12,3) NOT NULL DEFAULT 0,
    is_custom_added         BOOLEAN NOT NULL DEFAULT FALSE,
    package_details_snapshot TEXT,
    supplier_reference      VARCHAR(100),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version                 INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_devis_items_devis ON devis_items(devis_id);

CREATE TABLE IF NOT EXISTS suppliers (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                        VARCHAR(255) NOT NULL,
    legal_registration_number   VARCHAR(50),
    country_code                VARCHAR(5) DEFAULT 'TN',
    contact_email               VARCHAR(254),
    contact_phone               VARCHAR(20),
    is_verified                 BOOLEAN DEFAULT FALSE,
    verification_status         VARCHAR(20) DEFAULT 'pending',
    logo_url                    TEXT,
    region_governorate          VARCHAR(100),
    address                     TEXT,
    website_url                 TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version                     INTEGER NOT NULL DEFAULT 1,
    is_deleted                  BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at                  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS supplier_catalog_imports (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id         UUID REFERENCES suppliers(id),
    file_name           VARCHAR(255) NOT NULL,
    file_size_bytes     BIGINT NOT NULL DEFAULT 0,
    file_sha256         VARCHAR(64),
    file_mime_type      VARCHAR(100),
    import_status       VARCHAR(30) NOT NULL DEFAULT 'UPLOADED',
    items_count         INTEGER DEFAULT 0,
    parsed_at           TIMESTAMPTZ,
    approved_at         TIMESTAMPTZ,
    approved_by_user_id UUID REFERENCES users(id),
    published_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version             INTEGER NOT NULL DEFAULT 1,
    is_deleted          BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_imports_supplier ON supplier_catalog_imports(supplier_id);
CREATE INDEX IF NOT EXISTS idx_imports_status ON supplier_catalog_imports(import_status);

CREATE TABLE IF NOT EXISTS supplier_catalog_items (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    import_id           UUID NOT NULL REFERENCES supplier_catalog_imports(id),
    material_code       VARCHAR(100),
    name_fr             TEXT,
    category            VARCHAR(50),
    unit                VARCHAR(20),
    price_tnd           NUMERIC(12,3),
    tva_included        BOOLEAN DEFAULT FALSE,
    matched_material_id UUID REFERENCES materials(id),
    status              VARCHAR(20) DEFAULT 'pending',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_catalog_items_import ON supplier_catalog_items(import_id);

CREATE TABLE IF NOT EXISTS artisan_profiles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID REFERENCES users(id),
    company_name        VARCHAR(255),
    trade               VARCHAR(50) NOT NULL,
    region              VARCHAR(100),
    rating              NUMERIC(3,2),
    is_verified         BOOLEAN DEFAULT FALSE,
    is_pro              BOOLEAN DEFAULT FALSE,
    phone               VARCHAR(20),
    whatsapp            VARCHAR(20),
    hourly_rate_tnd     NUMERIC(12,3),
    square_meter_rate_tnd NUMERIC(12,3),
    services            JSONB DEFAULT '[]',
    badges              JSONB DEFAULT '[]',
    bio                 TEXT,
    avatar_url          TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_operations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id),
    client_id           VARCHAR(100),
    entity_type         VARCHAR(30) NOT NULL,
    entity_id           VARCHAR(100) NOT NULL,
    operation_type      VARCHAR(20) NOT NULL,
    client_version      INTEGER,
    server_version      INTEGER,
    client_timestamp    TIMESTAMPTZ,
    server_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    sync_status         VARCHAR(20) DEFAULT 'pending',
    payload             JSONB
);
CREATE INDEX IF NOT EXISTS idx_sync_user ON sync_operations(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_entity ON sync_operations(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key                 VARCHAR(255) PRIMARY KEY,
    entity_type         VARCHAR(50) NOT NULL,
    entity_id           UUID NOT NULL,
    response_snapshot   JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

    devis_number            VARCHAR(50) NOT NULL,
    reference               VARCHAR(50),
    date                    DATE,
    client_name             VARCHAR(200),
    client_phone            VARCHAR(20),
    client_address          TEXT,
    project_title           VARCHAR(200),
    country                 VARCHAR(5) DEFAULT 'TN',
    currency                VARCHAR(5) DEFAULT 'TND',
    region                  VARCHAR(100),
    surface_area_m2         NUMERIC(12,3),
    perimeter_linear_m      NUMERIC(12,3),
    waste_margin_percent    NUMERIC(5,2),
    total_materials_cost_tnd NUMERIC(12,3),
    total_labor_cost_tnd    NUMERIC(12,3),
    subtotal_before_tax_tnd NUMERIC(12,3),
    tax_rate_percent        NUMERIC(5,2),
    tax_amount_tnd          NUMERIC(12,3),
    grand_total_tnd         NUMERIC(12,3),
    status                  VARCHAR(20) NOT NULL DEFAULT 'draft',
    sync_state              VARCHAR(20) DEFAULT 'SYNCED',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version                 INTEGER NOT NULL DEFAULT 1,
    is_deleted              BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_devis_company_status ON devis(company_id, status);
CREATE INDEX IF NOT EXISTS idx_devis_created_by ON devis(created_by_user_id);

    name_derja      TEXT,
    base_unit       VARCHAR(20) NOT NULL DEFAULT 'unit',
    is_official     BOOLEAN NOT NULL DEFAULT TRUE,
    company_id      UUID REFERENCES companies(id),
    technical_specs TEXT,
    image_url       TEXT,
    standard_norm   VARCHAR(50),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version         INTEGER NOT NULL DEFAULT 1,
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT uq_material_code UNIQUE (code, company_id)
);
CREATE INDEX IF NOT EXISTS idx_materials_trade ON materials(trade);
CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);
CREATE INDEX IF NOT EXISTS idx_materials_company ON materials(company_id);
