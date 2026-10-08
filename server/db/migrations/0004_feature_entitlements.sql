-- ════════════ Feature Entitlement System — migration 0004 ════════════

-- Phase 4 — Feature Entitlements & Usage Tracking
-- Additive: does not modify existing tables

CREATE TABLE IF NOT EXISTS feature_entitlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  feature_key VARCHAR(100) NOT NULL UNIQUE,
  label_fr VARCHAR(200),
  label_ar VARCHAR(200),
  label_derja VARCHAR(200),
  free_access BOOLEAN NOT NULL DEFAULT true,
  pro_access BOOLEAN NOT NULL DEFAULT true,
  usage_limit INTEGER,  -- NULL = unlimited
  scope VARCHAR(20) NOT NULL DEFAULT 'all',  -- 'all' | 'client' | 'artisan' | 'supplier' | 'engineer'
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_entitlements_scope ON feature_entitlements(scope);
CREATE INDEX IF NOT EXISTS idx_feature_entitlements_active ON feature_entitlements(is_active);

CREATE TABLE IF NOT EXISTS user_feature_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key VARCHAR(100) NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, feature_key, period_start)
);

CREATE INDEX IF NOT EXISTS idx_user_feature_usage_user ON user_feature_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_user_feature_usage_period ON user_feature_usage(period_start, period_end);

-- Canonical Phase C matrix seed (FREE useful / PRO valuable).
-- Scope rules:
--  - 'all'             → every role may use it if plan + usage allow
--  - 'client'          → client role only
--  - 'artisan'         → artisan role only
--  - 'supplier'        → fournisseur / vendor (supplier) roles only
--  - 'engineer'        → ingenieur / engineer roles only
--
-- Rule: Devis PDF export is available to every role that can create devis.
-- devis:create is scope='all', so devis:export_pdf is also scope='all'
-- (not client-only). It remains PRO-only so it stays valuable.
INSERT INTO feature_entitlements (feature_key, label_fr, label_ar, label_derja, free_access, pro_access, usage_limit, scope) VALUES
  ('devis:create', 'Création de devis', 'إنشاء عرض سعر', 'إنشاء عرض السعر', true, true, 3, 'all'),
  ('devis:export_pdf', 'Export PDF de devis', 'تصدير عرض السعر PDF', 'تصدير عرض السعر PDF', false, true, NULL, 'all'),
  ('projects:save', 'Enregistrement de projets', 'حفظ المشاريع', 'حفظ المشاريع', true, true, 5, 'all'),
  ('projects:premium_formulas', 'Formules projet avancées', 'صيغ مشروع متقدمة', 'صيغ مشروع متقدمة', false, true, NULL, 'all'),
  ('supplier:products', 'Gestion des produits fournisseur', 'إدارة منتجات المورد', 'إدارة منتجات المؤيد', true, true, 10, 'supplier'),
  ('supplier:bulk_update', 'Mise à jour groupée des prix', 'تحديث أسعار جماعي', 'تحديث الأسعار الجماعي', false, true, NULL, 'supplier'),
  ('engineer:advanced_calc', 'Calculs avancés ingénieur', 'حسابات مهندس متقدمة', 'حسابات مهندس متقدمة', false, true, NULL, 'engineer'),
  ('engineer:multi_project', 'Multi-projets ingénieur', 'متعدد المشاريع للمهندس', 'متعدد مشاريع المهندس', false, true, NULL, 'engineer'),
  ('catalogue:browse', 'Parcourir le catalogue', 'تصفح الكتالوج', 'تصفح الكتالوج', true, true, NULL, 'all'),
  ('catalogue:export', 'Export du catalogue', 'تصدير الكتالوج', 'تصدير الكتالوج', false, true, NULL, 'all'),
  ('analytics:view', 'Statistiques et analyses', 'الإحصاء والتحليلات', 'الإحصائيات والتحليلات', false, true, NULL, 'all')
ON CONFLICT (feature_key) DO NOTHING;
