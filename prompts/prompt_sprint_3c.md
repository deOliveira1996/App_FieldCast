# SPRINT 3C — MERGE, INTEGRAÇÃO FINAL & GITHUB ACTIONS APK (SEQUENCIAL)

Leia `@.agent/rules/fieldcast-standards.md`, `@docs/SPEC.md` e os 4 handoffs paralelos:
- `@docs/handoff_2a.md`
- `@docs/handoff_2b.md`
- `@docs/handoff_3a.md`
- `@docs/handoff_3b.md`

## Tarefas Obrigatórias
1. **Integração Completa (`src/App.tsx`, `src/main.tsx` e hooks de orquestração):**
   - Conecte toda a UI (2B), Mapa/Radar (3A) e Campo/Dados (3B) aos serviços reais e Dexie (2A), removendo qualquer dado mockado.
   - Implemente o fluxo completo de **Pontos Salvos Favoritos** no Dexie + busca textual Nominatim (submissão explícita ou debounce >= 1000ms) + `useSmartLocation`.
   - Alimente o **Health Check** do cabeçalho com métricas reais (Plataforma Web/Android, latência/status das APIs Open-Meteo/Marine/RainViewer, GPS, IndexedDB e Log de Erros).
   - Garanta `<GlobalErrorBoundary>` na raiz e `<ModuleErrorBoundary>` em cada módulo principal.
2. **Empacotamento Android & Cloud Build Gratuito:**
   - Crie `.github/workflows/android-apk.yml` configurando Node.js + Java 21 + Android SDK no GitHub Actions para executar `npm ci`, `npm run build`, `npx cap sync android`, injetar as permissões Android 14+ (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`) no `AndroidManifest.xml`, compilar `./gradlew assembleDebug` e publicar o `.apk` como Artifact baixável.

## Gate 3 (Global)
- Execute `npx tsc --noEmit`, `npm run test` e `npm run build` com **zero erros**.
- Consolide os resultados em `@docs/SPRINT_STATUS.md` marcando 2A, 2B, 3A, 3B e 3C como `CONCLUÍDA`.
- **PARE** e informe que o projeto está pronto para a **Sprint 4 (QA Audit)**.