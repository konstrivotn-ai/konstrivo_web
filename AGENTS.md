# KONSTRIVO — Agent Operating Rules

## Mandatory Rules for All AI Agents

### 1. Documentation First
- **READ all existing documentation before modifying any code.**
- Start with `PROJECT_OVERVIEW.md` for project understanding.
- Check `PROJECT_STATE.md` for current status.
- Review `ROADMAP.md` and `PHASES.md` for planned work.

### 2. Git Safety
- **ALWAYS check `git status` before making any changes.**
- **NEVER delete or reset uncommitted changes.**
- **NEVER checkout branches without explicit permission.**
- **NEVER run `git clean` or `git stash` without explicit permission.**
- If uncommitted changes exist, STOP and report them.

### 3. Database Safety
- **NEVER modify database schema without explicit permission.**
- **NEVER run destructive commands (DROP, TRUNCATE, DELETE) on production.**
- **ALWAYS use migrations for schema changes.**
- **ALWAYS backup before migration.**

### 4. API Safety
- **NEVER break existing API contracts.**
- **ALWAYS maintain backward compatibility.**
- **ALWAYS document new endpoints.**
- **NEVER change request/response models without versioning.**

### 5. Code Quality
- **NEVER rebuild existing functionality.**
- **ALWAYS check for existing implementations before creating new ones.**
- **ALWAYS follow existing code conventions and patterns.**
- **NEVER claim test/build success without actually running it.**

### 6. Security
- **NEVER log or expose secrets (passwords, API keys, tokens).**
- **NEVER commit .env files.**
- **ALWAYS validate user input.**
- **ALWAYS use parameterized queries.**

### 7. Testing
- **ALWAYS run tests after making changes.**
- **NEVER claim tests pass without running them.**
- **ALWAYS document test results accurately.**

### 8. Cross-Platform Impact
- **ALWAYS consider impact on Android, Web, and Backend.**
- **ALWAYS verify API changes don't break mobile clients.**
- **ALWAYS test across all affected platforms.**

### 9. Documentation Updates
- **ALWAYS update `PROJECT_STATE.md` after significant changes.**
- **ALWAYS document new features and changes.**
- **ALWAYS mark incomplete work as "In Progress" or "Needs Verification".**

### 10. Scope Discipline
- **ONLY execute what was requested.**
- **NEVER make unauthorized changes.**
- **ALWAYS confirm before taking action outside the requested scope.**

---

## Priority Order for Source of Truth

1. **Current source code** — always the primary reference
2. **Database schema/migrations** — for data structure
3. **Tests** — for expected behavior
4. **Git history** — for recent changes
5. **API/OpenAPI definitions** — for endpoint contracts
6. **Existing documentation** — for context
7. **Agent reports** — for audit findings

---

## When in Doubt

- **STOP and ASK.**
- **Document under "Needs Verification"** instead of guessing.
- **Never assume** — verify with code or tests.
