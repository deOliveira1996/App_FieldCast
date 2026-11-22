# Padrões de Arquitetura e Governança — FieldCast

## Regra 1 — Fidelidade Absoluta à Especificação (`docs/SPEC.md`)
- O projeto **FieldCast** é 100% open-source, gratuito, sem servidor próprio e sem chaves de API pagas.
- Toda previsão atmosférica e oceanográfica opera em resolução **horária (1h)** por pelo menos **7 dias (168 horas)** em produção (e 48h nos fixtures de teste).
- Chamadas Open-Meteo devem usar sempre `timeformat=unixtime&timezone=auto`.
- Utilizar exclusivamente a altitude `elevation` (DEM) retornada pela Open-Meteo; descartar altitude do GPS.

## Regra 2 — Qualidade TypeScript & Validação Zod
- TypeScript em modo `strict: true`, sem uso de `any` implícito.
- Respostas externas de APIs (Open-Meteo Forecast, Open-Meteo Marine, RainViewer, Nominatim, `ipwho.is`) devem ser validadas via `zod` usando os schemas de `src/types/schemas.ts`.
- Respeitar que diferentes modelos meteorológicos (`ecmwf_ifs025`, `gfs_seamless`, `icon_seamless`) retornam chaves sufixadas e podem omitir níveis verticais (ex.: ECMWF sem `80m`/`120m`) ou retornar `null`.

## Regra 3 — Arquitetura Zero-Crash & Resiliência Offline
- Toda interação de usuário assíncrona (botões, downloads, exportações, GPS, câmera) deve utilizar `safeAction` (`src/utils/safeAction.ts`).
- Chamadas HTTP passam pelo Circuit Breaker (`src/services/httpClient.ts`) com timeout de 10s, 2 retries com backoff exponencial e fallback automático para IndexedDB (`dexie`).
- Error Boundaries granulares (`<ModuleErrorBoundary>`) protegem cada módulo/aba e `<GlobalErrorBoundary>` protege a raiz.

## Regra 4 — Dupla Entrega (PWA + Capacitor Android)
- Detectar plataforma via `Capacitor.isNativePlatform()` em `src/services/platform/`.
- Todos os botões e alvos de toque na interface devem ter área mínima de `44x44px` para uso em campo.
- Suporte a tema Claro (alto contraste solar) e Escuro (noturno) persistente via classe `dark` no Tailwind CSS.

## Regra 5 — Anti-Colisão em Agent Swarm Paralelo (WRITE-SCOPE ESTRITO)
Quando múltiplos agentes estiverem trabalhando em paralelo, cada agente **SÓ PODE** criar ou editar arquivos dentro do seu `Write-Scope` declarado no prompt da sua Sprint:
- **Sprint 1 (Sequencial):** Raiz (`package.json`, `tsconfig*.json`, `vite.config.ts`, `capacitor.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`), `.agent/*`, `public/*`, `scripts/*`, `assets/*`, `src/types/*`, `src/utils/safeAction.ts`, `src/test/fixtures/*`, `src/test/safeAction.test.ts`, `src/test/schemas.test.ts`, placeholders iniciais (`src/main.tsx`, `src/App.tsx`, `src/styles/index.css`) e `docs/SPRINT_STATUS.md`.
- **Sprint 2A (Swarm Paralelo):** `src/utils/*` (**EXCETO** `safeAction.ts`), `src/services/httpClient.ts`, `src/services/openMeteoService.ts`, `src/services/rainViewerService.ts`, `src/services/geocodingService.ts`, `src/db/*`, `src/test/*.test.ts` (novos testes unitários de 2A), `docs/handoff_2a.md`. **PROIBIDO** tocar em `package.json`, `src/types/*`, `src/utils/safeAction.ts`, `src/components/*`, `src/App.tsx`, `docs/SPRINT_STATUS.md`.
- **Sprint 2B (Swarm Paralelo):** `src/components/layout/*`, `src/components/common/*`, `src/components/forecast/*`, `src/hooks/useTheme.ts`, `src/hooks/useToast.ts`, `src/styles/*`, `docs/handoff_2b.md`. **PROIBIDO** tocar em `package.json`, `src/types/*`, `src/utils/*`, `src/services/*`, `src/db/*`, `src/App.tsx`, `docs/SPRINT_STATUS.md`.
- **Sprint 3A (Swarm Paralelo):** `src/components/map/*`, `src/services/offlineTilesService.ts`, `src/test/offlineTiles.test.ts`, `docs/handoff_3a.md`.
- **Sprint 3B (Swarm Paralelo):** `src/services/platform/*`, `src/hooks/useSmartLocation.ts`, `src/components/field/*`, `src/test/fieldOps.test.ts`, `docs/handoff_3b.md`.
- **Sprint 3C (Sequencial — Merge):** `src/App.tsx`, `src/main.tsx`, hooks integradores, `.github/workflows/android-apk.yml` e consolidação em `docs/SPRINT_STATUS.md`.

## Regra 6 — Ambiente de Execução Node.js no Windows
- No terminal PowerShell deste ambiente, os binários do Node.js (`v24.17.0`), `npm.cmd` e `npx.cmd` estão em `E:\Microsoft Visual Studio18\Community\MSBuild\Microsoft\VisualStudio\NodeJs` (acessível dentro do sandbox padrão).
- Para executar comandos `npm`, `npx` ou `node` no terminal, utilize o caminho completo do binário (ex.: `& "E:\Microsoft Visual Studio18\Community\MSBuild\Microsoft\VisualStudio\NodeJs\npx.cmd" vitest run`) ou adicione o diretório ao `$env:PATH` da sessão.

