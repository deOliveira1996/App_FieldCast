# AGENTS.md — FieldCast Global Architecture & Agent Governance

FieldCast is an offline-first multi-model meteorological, oceanographic, and field-operations app (Web PWA + Capacitor 6 Android).

## Non-Negotiable Invariants
1. **100% Open-Source & Zero Backend**: Never introduce paid API keys or backend servers (`Open-Meteo`, `RainViewer`, `Nominatim`, `ipwho.is` only).
2. **Temporal & Elevation Rules**:
   - Forecast & Marine endpoints always use `hourly` (1h steps), `timeformat=unixtime`, `timezone=auto`.
   - Elevation comes strictly from Open-Meteo `elevation` (DEM); never override it with device GPS altitude.
   - Dates formatted without timestamps (`YYYY-MM-DD`) must never be parsed as UTC midnight for local display (use noon UTC or local YMD calendar formatting).
3. **Models & Marine Rules**:
   - Atmospheric ensemble: `ecmwf_ifs025`, `gfs_seamless`, `icon_seamless`, `gem_seamless`. Handle partial `null` variables (`80m`/`100m`/`120m`, `visibility`, `precipitation_probability`) uniformly without throwing.
   - Marine (`sea_level_height_msl`, waves, swell, currents): coastal only; apply zero confidence penalty on continental coordinates. Any `sea_level_height_msl` tide indicator must carry an explicit notice that MSL (~8 km) does **not** replace official DHN / Marinha port tide tables.
4. **Resilience & Security**:
   - Async UI actions use `safeAction` (`src/utils/safeAction.ts`).
   - External HTTP calls use `fetchWithCircuitBreaker` (`src/services/httpClient.ts`) + Zod validation (`src/types/schemas.ts`) + Dexie IndexedDB offline fallback.
   - Do not commit secrets, keystores, `.env`, or bypass `@capacitor/share` / sandbox rules.
   - Touch targets >= `44x44px`; support both Light and Dark Tailwind themes.
5. **Swarm Non-Collision & Windows Tooling**:
   - Parallel workers operate strictly within their assigned `Write-Scope` (or isolated `workspace: "share"` worktrees) and hand off structured results before sequential integration.
   - On Windows, if `node`/`npm`/`npx` is not on default PATH, use `E:\Microsoft Visual Studio18\Community\MSBuild\Microsoft\VisualStudio\NodeJs`.
   - Authoritative output directory for synced builds & Android APK: `F:\Backup-data\local_data\App_FieldCast`.

## Customization Layout
- **Skills (Operators & Stages)**: `.agents/skills/` (`fieldcast-orchestrator`, `fieldcast-core-data`, `fieldcast-ui-charts`, `fieldcast-map-radar`, `fieldcast-field-ops`, `fieldcast-qa-audit`, `fieldcast-android-release`)
- **Security Hooks**: `.agents/hooks.json` -> `.agents/scripts/safety-gate.mjs`
- **Plugin Bundle**: `.agents/plugins/fieldcast-ops/plugin.json`
- **Detailed Rules**: `.agents/rules/fieldcast-standards.md`
- **Historical & Swarm Prompts**: `prompts/` (use `prompts/prompt_swarm_mobile_v2.md` for active multi-agent runs)

## Mandatory Verification Gate
Before marking any task complete:
1. `npx tsc --noEmit` -> 0 errors
2. `npm run test` -> all suites pass
3. `npm run build` -> clean `dist/` PWA build
4. When releasing/syncing: regenerate icons (PWA + Android `mipmap-*`), run `npx cap sync android`, and compile Debug APK (`.\gradlew.bat assembleDebug`).
