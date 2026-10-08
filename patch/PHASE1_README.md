# KONSTRIVO — Phase 1 Type Harmonization

Scope: Website type layer only.

Changed:
- app/src/types/materials.ts
- app/src/types/pricing.ts
- app/src/types/index.ts (new canonical entry point)

Preserved:
- Existing legacy Unit/Price shapes for current local repositories.
- Existing UI and localStorage code were not modified.
- No Android/Kotlin/Room code was modified.
- No database schema or migrations were modified.
- No API routes were implemented in Phase 1.

Canonical split:
- Material = catalog identity/metadata only.
- MaterialPrice = dynamic price/rate entity.

Validation:
- Standalone strict TypeScript check of the changed type files: PASS.
- Full project typecheck could not be completed because the reconstructed snapshot has no installed node_modules and contains pre-existing path/dependency issues outside Phase 1.

Important snapshot note:
The available project evidence is the archived repopack snapshot of the Website repository. This patch is therefore intended to be applied to the current working copy in VS Code, rather than claiming a direct mutation of the user's local C:\ repository.
