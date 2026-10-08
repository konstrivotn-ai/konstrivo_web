# KONSTRIVO — Current Work Plan

## Priority Levels

- **P0** — Critical / blocking production release
- **P1** — Important / should be done next
- **P2** — Nice to have / future work

---

## P0 — Critical (Pre-Production Blockers)

### 1. Secrets & Configuration Review
**Status:** Pending decision
- Rotate production credentials (Secret/configuration exists and must remain outside documentation.)
- Remove any development credentials from environment files
- Configure `CORS_ALLOWED_ORIGINS` for production domains

**Affected Areas:** Environment configuration, deployment
**Note:** No secret values are documented here — they must remain outside documentation.

### 2. Production Validation
**Status:** Not executed in this audit
- Run full test suite against a dedicated test database (`TEST_DATABASE_URL`)
- Verify all `/api/v1` endpoints against the production database
- Validate offline sync workflow end-to-end
- Confirm Android client API compatibility

**Affected Areas:** Backend, Database, API, Mobile clients
**Acceptance:** All documented endpoints verified with production DB; test results recorded.

---

## P1 — Important (Next Iteration)

### 1. Supplier Catalog Drizzle Backend
**Status:** In Progress (memory-backed today, with production guard)
- Replace memory-only supplier import storage with Drizzle/PostgreSQL persistence
- Keep existing memory implementation for dev/test

**Affected Areas:** `server/repositories/`, `server/db/schema/`, supplier import routes

### 2. Test Suite Infrastructure
**Status:** Requires decision + configuration
- Provision dedicated `TEST_DATABASE_URL` (must differ from `DATABASE_URL` — enforced in `server/config.ts`)
- Execute full suite (`npm test` → `tsx tests/run.ts`) and record results
- Add CI execution

**Affected Areas:** `tests/`, CI configuration

### 3. API Contract Formalization
**Status:** Needs Verification / Requires Decision
- No OpenAPI specification file was found in the repository during this audit
- Endpoint discovery exists at `GET /api/v1/` (`server/routes/v1/index.ts`)
- Creating a formal OpenAPI 3.x definition requires explicit owner approval

---

## P2 — Future Work

### 1. Mobile Applications
- Android app (separate codebase — not in this repository)
- iOS app
- Offline-first sync client

### 2. Real-Time & Advanced Features
- WebSocket implementation status unknown (Needs Verification)
- Real-time chat
- Advanced analytics & reporting
- Payment integration

### 3. Scale & Optimization
- Load testing
- Caching strategy
- Performance monitoring

---

## Requires Decision (Owner Approval Needed)

1. **Secrets rotation timing** — when to rotate production credentials
2. **CORS domains** — which origins are allowed in production
3. **Test database provisioning** — separate `TEST_DATABASE_URL` instance
4. **Migration timing** — when to run `npx drizzle-kit migrate` against production
5. **OpenAPI specification** — whether to create a formal OpenAPI file for `/api/v1`
6. **Android scope** — confirmation that Android lives in a separate repository (assumed, not verified here)

---

## Guardrails for This Plan

- Documentation-only audit: **no code was changed** in producing this plan.
- Nothing here has been executed — all validation items are marked **"Not executed in this audit."**
- Each P0/P1 item must go through the phase gates defined in `PHASES.md` before being marked complete.

---

**Last Updated:** 2026-09-09
