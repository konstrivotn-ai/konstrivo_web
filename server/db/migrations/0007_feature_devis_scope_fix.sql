-- ═════════��� Audit fix: repair legacy 'client'-only devis:create scope ═════
-- Forward repair for databases seeded by the pre-fix 0004: promote the
-- persisted scope to 'all' (only when it is still the legacy 'client'
-- value — an admin-customized scope is never overwritten). Fresh
-- environments are already correct via the updated 0004 seed above.
UPDATE feature_entitlements
SET scope = 'all', updated_at = NOW()
WHERE feature_key = 'devis:create' AND scope = 'client';
