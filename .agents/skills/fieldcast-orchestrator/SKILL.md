---
name: fieldcast-orchestrator
description: Coordinate parallel FieldCast development sprints and Swarm workers without file collisions. Use when orchestrating multi-agent builds, reviewing handoffs, or synchronizing the worktree into F:\Backup-data\local_data\App_FieldCast.
---

# FieldCast Swarm Orchestrator

1. Read `/AGENTS.md`, `/.agents/rules/fieldcast-standards.md`, and `/docs/SPRINT_STATUS.md`.
2. Assign each parallel worker a strict `Write-Scope` (or isolated `workspace: "share"` worktree):
   - Core/Data (`fieldcast-core-data`): `src/services/*`, `src/db/*`, `src/utils/*`, `src/types/*`
   - Forecast UI (`fieldcast-ui-charts`): `src/components/forecast/*`
   - Map/Radar (`fieldcast-map-radar`): `src/components/map/*`, `src/services/weatherGridService.ts`
   - Field Ops (`fieldcast-field-ops`): `src/components/field/*`, `src/components/common/Health*`, `src/hooks/*`
3. Require structured handoffs before integrating in `src/App.tsx`.
4. Enforce `.agents/hooks.json` security checks and run `npx tsc --noEmit`, `npm run test`, and `npm run build` before finishing.
