# KONSTRIVO — Project Overview

## What is KONSTRIVO?

KONSTRIVO is a comprehensive **Construction & Renovation SaaS Platform** designed for the Tunisian market (with expansion to other regions). It provides digital tools for construction professionals, artisans, and property owners to estimate material quantities, generate quotes (devis), manage projects, and connect with service providers.

## Problem Solved

The construction industry in Tunisia relies on:
- Manual material calculations (error-prone)
- Paper-based quote systems
- Fragmented artisan networks
- No real-time material pricing

KONSTRIVO digitizes and streamlines these processes.

## Target Users

- **Artisans** (Plasterers, Painters, Electricians, Plumbers, etc.)
- **Construction Companies**
- **Engineers & Architects**
- **Property Owners**
- **Material Suppliers**

## Platform Architecture

### Web Application (Current)
- **Framework:** React 19 + TypeScript
- **Styling:** Tailwind CSS 4
- **Build Tool:** Vite 6
- **State Management:** React Hooks + Context
- **API Client:** Custom fetch wrapper with JWT authentication

### Backend Server
- **Framework:** Express.js 4 + TypeScript
- **Database ORM:** Drizzle ORM 0.45
- **Database:** PostgreSQL
- **Authentication:** JWT (access + refresh tokens)
- **AI Integration:** Google Gemini AI

### Database
- **Type:** PostgreSQL
- **ORM:** Drizzle
- **Tables:** 16+ core tables
- **Migrations:** Drizzle Kit

### API
- **Version:** v1 (`/api/v1`)
- **Protocol:** REST
- **Authentication:** Bearer JWT
- **Format:** JSON

## Core Features (Implemented)

### 1. Material Quantity Calculator
- Placo/Plasterboard calculations (BA13, Démontable, Aquapanel)
- Paint estimates
- Tile calculations
- Masonry estimates
- Plumbing & Electrical estimates
- Waterproofing & Insulation

### 2. Devis (Quote) Generation
- Professional quote creation
- Multi-currency support (TND, EUR, DZD, SAR, AED, USD)
- TVA and fiscal calculations
- PDF export capability
- Quote history management

### 3. Project Management (Chantiers)
- Project tracking
- Phase management
- Budget monitoring
- Team management
- Site logs

### 4. Artisan Directory
- Professional profiles
- Ratings & reviews
- Service listings
- Contact management

### 5. Marketplace
- Material listings
- Supplier catalogs
- Price comparisons

### 6. Maintenance Services
- Urgent repair requests
- Ticket management
- Technician assignment

### 7. AI Assistant
- Construction estimation AI
- Material calculations
- Technical advice
- Multi-language support (French, Arabic, Derja)

### 8. Multi-Market Support
- Tunisia (primary)
- France, Algeria, Saudi Arabia, UAE, US (expanding)

## Languages

- **Frontend:** TypeScript, HTML, CSS
- **Backend:** TypeScript
- **Database:** SQL (PostgreSQL)
- **Configuration:** JSON, YAML

## Currency & Market

- **Primary Market:** Tunisia
- **Primary Currency:** TND (Tunisian Dinar)
- **Supported Currencies:** TND, EUR, DZD, SAR, AED, USD

## System Relationships

- **Web SPA (React)** → calls → **Backend API (`/api/v1`, Express)** → reads/writes → **PostgreSQL (Drizzle ORM)**.
- **Backend** → calls → **Google Gemini AI** for the construction estimator (`POST /api/ai-estimator`).
- **Web SPA** is served by the **same Express origin** (Vite middleware in dev, static `dist/` in production), so auth cookies are first-party.
- **Android/mobile clients** are expected to consume the same `/api/v1` REST API (separate codebase, not in this repository).
- **Seed data** (`server/db/seedCatalog.ts`, `scripts/seed-production-tn.sql`) mirrors `src/data/marketRates.ts` (78 materials, TND) — material identity and pricing stay separate.

## Feature Status

### Implemented ✅
- Material quantity calculator (12 official trades + dynamic trades via registry)
- Devis (quotes) CRUD with fiscal calculations (TVA, timbre fiscal, retenue de garantie)
- Project management (Chantiers) with Drizzle persistence
- Artisan directory & marketplace
- Maintenance tickets
- AI assistant (Gemini, auth-protected, rate-limited, with local fallback)
- JWT auth (register/login/refresh/logout) + password reset flow
- Catalog import (CSV + XLSX): preview → mapping → transactional commit
- Price update workflow (pending → admin review → official)
- Sync pull/push API
- Multi-currency (TND default) and multi-language (fr / ar / derja)

### In Progress 🔄
- Supplier catalog imports Drizzle backend (currently memory-backed, guarded in production)

### Planned 📋
- Android / iOS applications
- Advanced analytics & reporting
- Payment integration
- Real-time chat / WebSocket features

### Needs Verification ⚠️
- WebSocket implementation (no WebSocket code found in this audit; unconfirmed)
- Email delivery (Resend integration referenced in code; actual delivery not verified)
- Actual test results and build outputs (not executed in this audit)
- Android client API compatibility (no manual testing evidence found)

## Android

- **Status:** Not present in this repository. The Android application (if it exists) lives in a separate codebase and could not be audited here (no Gradle/Kotlin files found).
- **Contract:** The backend `/api/v1` API is designed to serve mobile clients too (JWT auth, sync pull/push endpoints exist).

## Key Technical Decisions

1. **Hybrid repository pattern** — in-memory store for development/tests, Drizzle/PostgreSQL for production; production refuses to run in memory mode.
2. **JWT + HttpOnly refresh cookie** — access token kept in JS memory only; refresh token in an HttpOnly/SameSite=Strict cookie; silent rotation on 401.
3. **Fail-closed security** — production refuses weak/missing `JWT_SECRET` or missing `DATABASE_URL`; admin role is blocked in public registration; rate limiting on sensitive routes.
4. **NUMERIC(12,3)** for all monetary columns — never FLOAT.
5. **Soft deletes + version columns** — `is_deleted`/`deleted_at` and optimistic-locking `version` on core tables.
6. **AI fallback** — if Gemini is unavailable, a local Tunisian-market fallback message is returned instead of an error.

## Repository Structure

```
KONSTRIVO_WEBSITE_BACKUP_BEFORE_PHASE1/
├── src/                    # Frontend React application
│   ├── components/         # Tab components + modals
│   ├── data/               # Static data (marketRates, countryConfig, mockSaaSData)
│   ├── lib/api.ts          # Central API client (JWT, silent refresh)
│   ├── types.ts            # Frontend domain types
│   └── utils/              # priceLookup, devisFields, devisPrint, etc.
├── server/                 # Backend Express server
│   ├── config.ts           # Env configuration (fails closed in production)
│   ├── db/schema/          # Drizzle schema modules
│   ├── db/migrations/      # Generated SQL migrations (0000…, 0002_futuristic_loa)
│   ├── middleware/         # auth, cors, rateLimit, securityHeaders, upload, errorHandler
│   ├── repositories/       # Memory + Drizzle repositories
│   ├── routes/v1/          # API route modules
│   ├── services/           # Business logic (catalogImport, passwordResetService)
│   └── types.ts            # API contract types
├── tests/                  # Test suite (`npm test` → tsx tests/run.ts)
├── patch/                  # Phase 1 patch notes (PHASE1_README.md)
├── scripts/                # Production seed SQL
└── drizzle.config.ts       # Drizzle Kit configuration (requires DATABASE_URL)
```

## Important Notes

- This directory is a **backup snapshot** taken before "Phase 1" work; it represents the website repository at commit `81d7204` on branch `main` (confirmed read-only from `.git/HEAD` + `.git/packed-refs`; git CLI was unavailable in the audit session).
- **No Android code exists in this repository** — architecture/screens/ViewModels/Room could not be audited here and are documented as "Not present / separate codebase".
- **Secret/configuration exists and must remain outside documentation.** No secret values are recorded in any of these documents.
- An older `FINAL_PRODUCTION_AUDIT.md` (dated 2026-09-01) exists and claims Phase 3 production readiness; its claims were **not re-verified** by this audit (tests/builds were not executed here).

---

**Last Updated:** 2026-09-09
**Version:** 2026.5.0
**Status:** Pre-Phase 1 Backup
