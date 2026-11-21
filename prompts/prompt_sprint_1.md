# SPRINT 1 — SCAFFOLD, API PROBE, CONTRATOS & ASSETS (SEQUENCIAL)

Leia `@.agent/rules/fieldcast-standards.md` e `@docs/SPEC.md`.
**Write-Scope:** Raiz do projeto, `package.json`, `capacitor.config.ts`, `public/`, `scripts/`, `assets/`, `src/types/`, `src/utils/safeAction.ts`, `src/test/fixtures/`, `docs/SPRINT_STATUS.md`.

## Tarefas Obrigatórias
1. **Scaffold e Dependências Completas (instalar tudo agora para travar o `package.json` nas sprints paralelas):**
   - Vite + React + TypeScript (`strict: true`), Tailwind CSS (`darkMode: 'class'`), `vite-plugin-pwa`, `dexie`, `zod`, `vitest`, `@vitest/ui`, `jsdom`, `echarts`, `echarts-for-react`, `leaflet`, `react-leaflet`, `@types/leaflet`, `suncalc`, `@types/suncalc`, `lucide-react`, `sharp` (devDep) e pacotes Capacitor (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/geolocation`, `@capacitor/camera`, `@capacitor/share`, `@capacitor/filesystem`).
   - Configure `capacitor.config.ts` (`appId: "org.fieldcast.app"`, `appName: "FieldCast"`) e `vite.config.ts` com `VitePWA` (manifesto completo `FieldCast — Previsão Local & Campo`, `short_name: "FieldCast"`).
   - Scripts em `package.json`: `dev`, `build`, `preview`, `test`, `icons:generate`, `cap:sync`, `cap:android`.

2. **API Probe Real no Terminal (Obrigatório antes dos schemas Zod):**
   - Execute `curl` na Open-Meteo Forecast (`models=ecmwf_ifs025,gfs_seamless,icon_seamless` + `timeformat=unixtime&timezone=auto` + todas as variáveis horárias da Seção 1.3 de `docs/SPEC.md`) e Marine API em:
     - Ponto costeiro (ex.: Florianópolis `-27.5954, -48.5480`)
     - Ponto continental (ex.: Brasília `-15.7939, -47.8828`)
   - Salve amostras enxutas (ex.: 48h) em `src/test/fixtures/openMeteoCoastal.json`, `openMeteoInland.json`, `marineCoastal.json` e `marineInland.json`.

3. **Contratos Tipados & Schemas Zod (`src/types/`):**
   - Crie `src/types/weather.ts`, `src/types/field.ts`, `src/types/health.ts` e `src/types/schemas.ts` (Zod) espelhando os nomes reais de chaves sufixadas e campos `nullable` observados no Probe.
   - Inclua contrato para `SavedLocation`, `NormalizedForecast`, `EnsembleHour`, `ConfidenceScore`, `OperationalAlert`, `SafeWindowThresholds`, `Waypoint`, `TrackSession`, `HealthCheckSnapshot` e `ToastMessage`.

4. **Shared Utility Desbloqueadora do Swarm (`src/utils/safeAction.ts`):**
   - Implemente `safeAction` (trava anti-duplo-clique, `try/catch`, callbacks de loading e toast/log) + teste unitário básico para que os agentes 2A e 2B possam importá-lo sem conflito.

5. **Identidade Visual & Ícones:**
   - Crie `public/icon.svg` (vetorial minimalista, geométrico, alto contraste).
   - Crie e execute `scripts/generate-icons.mjs` usando `sharp` gerando PNGs em `public/icons/` (`192x192`, `512x512`, `maskable-512x512`) e `assets/` (`icon-only.png`, `icon-foreground.png`, `icon-background.png`).

## Gate 1
- Execute `npx tsc --noEmit` e `npm run test` (0 erros).
- Atualize `@docs/SPRINT_STATUS.md` registrando os nomes exatos das chaves retornadas pela Open-Meteo e marque a Sprint 1 como `CONCLUÍDA`.
- **PARE** e informe que o projeto está pronto para disparar **Sprint 2A** e **Sprint 2B** em paralelo no Agent Manager.