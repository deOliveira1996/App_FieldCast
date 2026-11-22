# Status das Sprints — FieldCast (Agent Swarm)

| Sprint | Modo | Prompt | Status | Gate Validado |
|---|---|---|---|---|
| Sprint 1 — Scaffold, API Probe, Contratos & Assets | Sequencial | `/prompts/prompt_sprint_1.md` | CONCLUÍDA | Gate 1: `npx tsc --noEmit` (0 erros) + `npm run test` (100% aprovado) + `npm run icons:generate` |
| Sprint 2A — Core Matemático, APIs, Dexie & Vitest | Swarm Paralelo | `/prompts/prompt_sprint_2a.md` | CONCLUÍDA | Gate 2A: `npx tsc --noEmit` (0 erros) + `npx vitest run` (49/49 testes aprovados) |
| Sprint 2B — UI Windy/Windguru, ECharts & Boundaries | Swarm Paralelo | `/prompts/prompt_sprint_2b.md` | CONCLUÍDA | Gate 2B: `npx tsc --noEmit` (0 erros) + Hierarquia Windy/Windguru + Boundaries + Health Check UI |
| Sprint 3A — Mapa Leaflet, Radar & Cache Offline | Swarm Paralelo | `/prompts/prompt_sprint_3a.md` | CONCLUÍDA | Gate 3A: `npx tsc --noEmit` (0 erros) + `npx vitest run src/test/offlineTiles.test.ts` (5/5 aprovados) |
| Sprint 3B — Campo, Tracker, Waypoints, Bússola & Export | Swarm Paralelo | `/prompts/prompt_sprint_3b.md` | CONCLUÍDA | Gate 3B: `npx tsc --noEmit` (0 erros) + `npx vitest run src/test/fieldOps.test.ts` (13/13 aprovados) |
| Sprint 3C — Merge, Integração & GitHub Actions APK | Sequencial (Merge) | `/prompts/prompt_sprint_3c.md` | CONCLUÍDA | Gate 3: `npx tsc --noEmit` (0 erros) + `npm run test` (9 suítes, 67/67 testes 100%) + `npm run build` (PWA `dist/manifest.webmanifest`, `dist/sw.js`, `dist/icons/*`) |
| Sprint 4 — QA Audit (Browser) & README | Sequencial | `/prompts/prompt_sprint_4.md` | CONCLUÍDA | Gate 4 (Final QA): `npx tsc --noEmit` (0 erros) + `npm run test` (67/67 100%) + `npm run build` + Auditoria Visual Desktop/Mobile (`0` erros de console) + `README.md` |

---

## Notas de Handoff Consolidado

### Sprint 1 — Scaffold, API Probe Real, Contratos Tipados & Assets (`CONCLUÍDA`)

1. **Fixtures Reais de 48h (`src/test/fixtures/`):**
   - `openMeteoCoastal.json` (Florianópolis `-27.5954, -48.5480`, `elevation: 23`, `timezone: "America/Sao_Paulo"`)
   - `openMeteoInland.json` (Brasília `-15.7939, -47.8828`, `elevation: 1092`, `timezone: "America/Sao_Paulo"`)
   - `marineCoastal.json` (Florianópolis `-27.5954, -48.5480`, grade oceânica ativa com valores válidos)
   - `marineInland.json` (Brasília `-15.7939, -47.8828`, grade continental 100% `[null, null, ...]`, `hasValidMarineGrid === false`)

2. **Chaves Exatas Retornadas pela Open-Meteo Forecast API (`models=ecmwf_ifs025,gfs_seamless,icon_seamless&timeformat=unixtime&timezone=auto`):**
   - **Chaves de topo:** `latitude`, `longitude`, `generationtime_ms`, `utc_offset_seconds`, `timezone`, `timezone_abbreviation`, `elevation`, `hourly_units`, `hourly`.
   - **Chaves `hourly` (55 chaves no total = `time` + 18 variáveis × 3 modelos):**
     - `time` (`number[]` em segundos UNIX UTC)
     - **Sufixo `_ecmwf_ifs025`:** `wind_speed_10m_ecmwf_ifs025`, `wind_speed_80m_ecmwf_ifs025`, `wind_speed_100m_ecmwf_ifs025`, `wind_speed_120m_ecmwf_ifs025`, `wind_direction_10m_ecmwf_ifs025`, `wind_direction_80m_ecmwf_ifs025`, `wind_direction_100m_ecmwf_ifs025`, `wind_direction_120m_ecmwf_ifs025`, `wind_gusts_10m_ecmwf_ifs025`, `precipitation_ecmwf_ifs025`, `precipitation_probability_ecmwf_ifs025`, `temperature_2m_ecmwf_ifs025`, `dew_point_2m_ecmwf_ifs025`, `visibility_ecmwf_ifs025` *(100% `null` no Probe real, `hourly_units: "undefined"`)*, `surface_pressure_ecmwf_ifs025`, `cloud_cover_low_ecmwf_ifs025`, `cloud_cover_mid_ecmwf_ifs025`, `cloud_cover_high_ecmwf_ifs025`.
     - **Sufixo `_gfs_seamless`:** `wind_speed_10m_gfs_seamless`, `wind_speed_80m_gfs_seamless`, `wind_speed_100m_gfs_seamless`, `wind_speed_120m_gfs_seamless`, `wind_direction_10m_gfs_seamless`, `wind_direction_80m_gfs_seamless`, `wind_direction_100m_gfs_seamless`, `wind_direction_120m_gfs_seamless`, `wind_gusts_10m_gfs_seamless`, `precipitation_gfs_seamless`, `precipitation_probability_gfs_seamless`, `temperature_2m_gfs_seamless`, `dew_point_2m_gfs_seamless`, `visibility_gfs_seamless` *(48/48 preenchido em metros)*, `surface_pressure_gfs_seamless`, `cloud_cover_low_gfs_seamless`, `cloud_cover_mid_gfs_seamless`, `cloud_cover_high_gfs_seamless`.
     - **Sufixo `_icon_seamless`:** `wind_speed_10m_icon_seamless`, `wind_speed_80m_icon_seamless`, `wind_speed_100m_icon_seamless`, `wind_speed_120m_icon_seamless`, `wind_direction_10m_icon_seamless`, `wind_direction_80m_icon_seamless`, `wind_direction_100m_icon_seamless`, `wind_direction_120m_icon_seamless`, `wind_gusts_10m_icon_seamless`, `precipitation_icon_seamless`, `precipitation_probability_icon_seamless`, `temperature_2m_icon_seamless`, `dew_point_2m_icon_seamless`, `visibility_icon_seamless` *(100% `null` no Probe real)*, `surface_pressure_icon_seamless`, `cloud_cover_low_icon_seamless`, `cloud_cover_mid_icon_seamless`, `cloud_cover_high_icon_seamless`.

3. **Chaves Exatas Retornadas pela Open-Meteo Marine API (`timeformat=unixtime&timezone=auto`):**
   - **Chaves de topo:** `latitude`, `longitude`, `generationtime_ms`, `utc_offset_seconds`, `timezone`, `timezone_abbreviation`, `elevation`, `hourly_units`, `hourly`.
   - **Chaves `hourly` (9 chaves):** `time`, `wave_height`, `wave_period`, `wave_direction`, `swell_wave_height`, `swell_wave_period`, `swell_wave_direction`, `ocean_current_velocity`, `ocean_current_direction`.

4. **Contratos & Utilitários Travados para Sprints Paralelas (2A / 2B / 3A / 3B):**
   - `src/types/weather.ts`, `src/types/field.ts`, `src/types/health.ts`, `src/types/schemas.ts`, `src/types/index.ts`
   - `src/utils/safeAction.ts` (`safeAction`, `createSafeHandler`, `isActionInFlight`, `clearInFlightActions`)
   - `public/icon.svg`, `public/icons/*` (`192x192.png`, `512x512.png`, `maskable-512x512.png`) e `assets/*` (`icon-only.png`, `icon-foreground.png`, `icon-background.png`).

---

### Sprint 2A — Core Matemático, APIs com Circuit Breaker, Dexie & Vitest (`CONCLUÍDA`)

- **Detalhes completos:** `docs/handoff_2a.md`
- **Entregas principais:**
  1. `src/utils/ensembleMath.ts` — Estatísticas escalares multi-modelo, decomposição vetorial circular ($u/v$, `atan2(-u_mean, -v_mean)`, comprimento resultante unitário $R \in [0, 1]$), perfil vertical de vento (`10m–120m`) via Lei de Potência $v(z) = v_{\text{ref}} \cdot (z / z_{\text{ref}})^\alpha$ com Double-Check de cisalhamento atípico ($\alpha \notin [0.05, 0.40]$) e rajadas estritamente em `10m`.
  2. `src/utils/confidenceIndex.ts` — Score horário e geral (`0–100`): Concordância (`50 pts`), Integridade/Frescor (`30 pts` com **Regra Continental** redistribuindo peso sem penalizar coordenadas sem grade marinha), Horizonte Temporal (`20 pts`) e Penalidade de Cisalhamento (`-10 pts`).
  3. `src/utils/operationalAlerts.ts` — Semáforo de Janela Segura configurável, tendência barométrica ($\Delta P / 3\text{h} > 4\text{ hPa}$), risco de nevoeiro (`visibility < 1000m` & *dew point spread* $< 2^\circ\text{C}$), nebulosidade estratificada e efemérides offline (`suncalc`).
  4. `src/utils/exporters.ts` — Exportadores puros CSV com BOM UTF-8 (`\uFEFF`), JSON, GPX 1.1, GeoJSON RFC 7946, distância Haversine e boletim WhatsApp (`wa.me`).
  5. `src/db/database.ts` — Banco IndexedDB (`dexie`) com tabelas `savedLocations`, `forecastCache`, `waypoints`, `tracks`, `offlineTiles`, `errorLogs` e fallback em memória.
  6. `src/services/httpClient.ts`, `openMeteoService.ts`, `rainViewerService.ts`, `geocodingService.ts` — Circuit Breaker (timeout 10s, 2 retries backoff exponencial, validação `zod`, abertura após 3 falhas e fallback automático para Dexie).

---

### Sprint 2B — UI Windy/Windguru, Apache ECharts, Error Boundaries & Health Check (`CONCLUÍDA`)

- **Detalhes completos:** `docs/handoff_2b.md`
- **Entregas principais:**
  1. `src/hooks/useTheme.ts` (Claro alto contraste solar e Escuro noturno persistente em `localStorage`) e `src/hooks/useToast.ts`.
  2. `src/components/common/` — `GlobalErrorBoundary`, `ModuleErrorBoundary`, `ToastContainer`, `SkeletonLoaders`, `HelpPopover` (`?`), `GlossaryModal` (*"Guia Rápido & Glossário"*), `HealthBadge` e `HealthCheckModal`.
  3. `src/components/layout/` — `AppShell` (Header desktop + Bottom Tab Bar mobile com alvos `>= 44x44px`) e `SavedLocationsModal` (favoritos offline Dexie + busca textual Nominatim no `onSubmit` + entrada manual Lat/Lon).
  4. `src/components/forecast/` — Hierarquia estrita Windy/Windguru em `ForecastTab`: (1) `CurrentSummaryCard` com Altitude DEM Open-Meteo, Badge de Confiança expansível e Semáforo + `ThresholdSettingsModal`; (2) `ActiveAlertsBanner`; (3) `ModelSelectorBar` + `ForecastCharts` (Apache ECharts: Vento & Perfil Vertical 0–120m, Ondas & Swell, Chuva & Pressão, Nebulosidade Estratificada Baixa/Média/Alta); (4) `WindguruTable` (grade horária compacta 168h com setas vetoriais); (5) `EphemerisCard`.

---

### Sprint 3A — Mapa Interativo Leaflet, Radar RainViewer & Cache Offline de Área de Missão (`CONCLUÍDA`)

- **Detalhes completos:** `docs/handoff_3a.md`
- **Entregas principais:**
  1. `src/services/offlineTilesService.ts` — Cálculo geométrico Slippy Map, fila concorrente (`MAX_CONCURRENT_TILE_DOWNLOADS = 4`) com trava rígida de **`MAX_OFFLINE_TILES_PER_MISSION = 300` tiles**, tiles CartoDB Voyager/DarkMatter CORS (`crossOrigin: 'anonymous'`), persistência de blobs no Dexie e subclasse customizada `OfflineCartoTileLayer extends L.TileLayer` sobrescrevendo `createTile()`.
  2. `src/components/map/MapRadarTab.tsx` — Mapa interativo `react-leaflet` com troca automática de tema Claro/Escuro, player animado do radar RainViewer (**Play/Pause**, timeline, opacidade e aviso âmbar não-bloqueante quando degradado), camadas táticas (Ponto Ativo, Locais Salvos, Waypoints com foto, Trilhas GPS `<Polyline>`, inspeção por clique) e ferramenta **Área de Missão Offline** (visão atual, desenho por 2 cliques ou presets de raio 2–15 km).
  3. `src/test/offlineTiles.test.ts` — 5/5 testes unitários aprovados.

---

### Sprint 3B — Operações de Campo, Adaptadores Híbridos, GPS Tracker, Waypoints & Bússola (`CONCLUÍDA`)

- **Detalhes completos:** `docs/handoff_3b.md`
- **Entregas principais:**
  1. `src/services/platform/` — `LocationTrackerService.ts` (filtro rígido de acurácia `<= 20m`, notificação Android Foreground Service *"FieldCast: Gravando rota..."*, Web Wake Lock API + banner de tela ligada), `CameraService.ts` (captura nativa/web + compressão `<canvas>` para ~200 KB WebP/JPEG) e `ShareService.ts` (Capacitor Share / Web Share API / download local + link WhatsApp `wa.me`).
  2. `src/hooks/useSmartLocation.ts` — Cascata de geolocalização em 3 níveis: (1) GPS (timeout 8s) -> (2) `https://ipwho.is/` (*"Aproximado via IP"*) -> (3) cache offline Dexie.
  3. `src/components/field/WindCompass.tsx` (permissão explícita iOS `requestPermission()` + `webkitCompassHeading`, Android/Web `deviceorientationabsolute`, ocultação automática no desktop sem sensor) e `src/components/field/FieldDataTab.tsx` (Tracker, Waypoints com `ConditionSnapshot` automático e Central de Exportação CSV BOM / JSON / GPX / GeoJSON / WhatsApp).
  4. `src/test/fieldOps.test.ts` — 13/13 testes unitários aprovados.

---

### Sprint 3C — Merge Sequencial, Integração Final & GitHub Actions Android APK (`CONCLUÍDA`)

1. **Integração Completa (`src/App.tsx` e `src/main.tsx`):**
   - Conexão integral entre `AppShell`, `ForecastTab`, `MapRadarTab` e `FieldDataTab` com os serviços reais (`fetchOpenMeteoForecast`, `reapplyThresholdsToForecast`, `searchLocationsNominatim`, `getEndpointHealthSnapshot`, `getOverallEndpointsHealthLevel`) e banco IndexedDB `dexie`.
   - **Resiliência Cold-Boot Offline/Sandboxed:** Pré-seeding automático no Dexie e fallback instantâneo (`buildBundledFallbackForecast`) utilizando os fixtures reais de 48h (`openMeteoCoastal.json` + `marineCoastal.json` para pontos costeiros como Florianópolis; `openMeteoInland.json` + `marineInland.json` para pontos continentais como Brasília) com `fromCache: true`, garantindo que o aplicativo renderize 100% populado em `< 50ms` mesmo sem conexão de rede.
   - Fluxo completo de **Pontos Salvos Favoritos** no Dexie (seleção, salvamento do ponto ativo, estrela de favorito, renomeação inline, exclusão) + busca textual Nominatim com fallback offline + `useSmartLocation`.
   - Persistência de `SafeWindowThresholds` em `localStorage` (`fieldcast_safe_window_thresholds`) com reaplicação imediata via `reapplyThresholdsToForecast`.
   - Alimentação em tempo real do **Health Check** (`HealthCheckSnapshot`) no cabeçalho com plataforma (`detectRuntimePlatform()`), status do GPS, integridade do IndexedDB, idade do cache, tabela de latência/Circuit Breaker das 5 APIs monitoradas e log de erros (`getRecentErrorLogs`, `clearErrorLogs`).
   - Proteção de raiz com `<GlobalErrorBoundary>` e isolamento de cada aba/módulo com `<ModuleErrorBoundary>`.
2. **Workflow de Cloud Build Android (`.github/workflows/android-apk.yml`):**
   - Pipeline GitHub Actions (`ubuntu-latest`) com Node.js 20, Java 21 (`temurin`) e Android SDK executando `npm ci`, `npm run icons:generate`, `npx tsc --noEmit`, `npm run test`, `npm run build`, inicialização/sync do Capacitor Android (`npx cap add android` / `npx cap sync android`), injeção idempotente das permissões Android 14+ (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `INTERNET`, `WAKE_LOCK`) no `AndroidManifest.xml`, compilação `./gradlew assembleDebug` e publicação do artefato `fieldcast-android-debug-apk`.
3. **Validação Gate 3 Global:**
   - `npx tsc --noEmit`: **0 erros**
   - `npm run test`: **9 suítes aprovadas, 67/67 testes passando (100%)**
   - `npm run build`: **0 erros** (`dist/manifest.webmanifest`, `dist/sw.js` e `dist/icons/*` gerados e verificados).

---

### Sprint 4 — Auditoria QA Completa (Terminal + Browser) & Documentação Final (`CONCLUÍDA`)

1. **Validação Estática, Ícones, Tipagem, Testes Unitários e Build PWA (Terminal):**
   - `npm run icons:generate` (`node scripts/generate-icons.mjs`): Confirmada a geração automatizada a partir de `public/icon.svg` para PWA (`public/icons/192x192.png`, `public/icons/512x512.png`, `public/icons/maskable-512x512.png`) e Android Capacitor (`assets/icon-only.png`, `assets/icon-foreground.png`, `assets/icon-background.png`).
   - `npx tsc --noEmit`: **0 erros** em modo `strict: true`.
   - `npm run test` (`vitest run`): **9 suítes aprovadas (9), 67 testes aprovados (67) — 100% de aprovação**, cobrindo:
     - `ensembleMath.test.ts` (10 testes): Média circular vetorial ($350^\circ$ e $10^\circ \rightarrow 0^\circ$, $R \approx 1$; $0^\circ$ e $180^\circ \rightarrow R \approx 0$), estatísticas escalares, interpolação vertical por Lei de Potência (10–120m), Double-Check de cisalhamento atípico ($\alpha \notin [0.05, 0.40]$) e rajadas restritas a 10m.
     - `confidenceIndex.test.ts` (5 testes): Índice de Confiabilidade `0–100` com **Regra Continental** redistribuindo os pontos marinhos sem penalidade quando `marineAvailable === false`.
     - `operationalAlerts.test.ts` (8 testes): Semáforo de Janela Segura, tendência barométrica ($\Delta P / 3\text{h} > 4\text{ hPa}$), risco de nevoeiro (`visibility < 1000m` & *dew point spread* $< 2^\circ\text{C}$), nebulosidade estratificada e efemérides `suncalc`.
     - `schemas.test.ts` (6 testes) & `servicesAndFixtures.test.ts` (9 testes): Contratos `zod`, normalização dos fixtures reais de 48h (Costeiro e Continental) e Circuit Breaker HTTP.
     - `exportersAndDb.test.ts` (7 testes): CSV com BOM UTF-8 (`\uFEFF`), JSON, GPX 1.1, GeoJSON RFC 7946, Haversine e persistência Dexie.
     - `offlineTiles.test.ts` (5 testes): Geometria Slippy Map, trava rígida de **máximo 300 tiles por missão**, fila de **4 downloads simultâneos**, cancelamento via `AbortController` e `OfflineCartoTileLayer` (`createTile()`).
     - `fieldOps.test.ts` (13 testes) & `safeAction.test.ts` (4 testes): GPS Tracker com filtro $\le 20\text{m}$ e Foreground Service Android / Wake Lock Web, cascata de geolocalização em 3 níveis, compressão de fotos `< 200 KB`, bússola de vento/onda relativa e wrapper Zero-Crash `safeAction`.
   - `npm run build` (`tsc -b && vite build`): **0 erros**, gerando `dist/manifest.webmanifest`, `dist/sw.js`, `dist/workbox-*.js`, `dist/icon.svg` e `dist/icons/*`.
   - Validação de Empacotamento Android: `capacitor.config.ts` (`appId: "org.fieldcast.app"`, `appName: "FieldCast"`) e `.github/workflows/android-apk.yml` verificados.

2. **Auditoria Visual e Funcional no Navegador (`http://127.0.0.1:4173/` via Chrome DevTools Protocol):**
   - **Zero Erros de Console / Página:** `0` exceções não tratadas (`Runtime.exceptionThrown = 0`) e `0` erros inesperados de console (`console.error = 0`) em toda a jornada Desktop (`1440x900`) e Mobile (`390x844`).
   - **Correções Cirúrgicas Aplicadas durante a Auditoria Visual:**
     - `src/db/database.ts` e `src/App.tsx`: Corrigida a ordenação determinística de `DEFAULT_SAVED_LOCATIONS` (`lastUsedAtIso`) e sincronização de `activeLocation` no `bootstrapApp` para garantir que o ponto padrão **Florianópolis — SC (Costeiro, DEM 23m)** carregue sincronizado desde o primeiro frame em cold-boot.
     - `src/components/field/WindCompass.tsx`: Refinada a detecção `requiresIosOrientationPermission()` para verificar dispositivos iOS/iPadOS reais antes de exibir o prompt `DeviceOrientationEvent.requestPermission()`, ocultando automaticamente a bússola no Desktop sem sensor magnetômetro conforme a Seção 4.6 da `SPEC.md`.
     - `src/components/layout/AppShell.tsx`: Otimizado o badge de origem no seletor de local do cabeçalho mobile (`hidden sm:inline-block`) para preservar legibilidade total em telas de `390px`.
   - **Checklist Funcional Validado em Prática:**
     - [x] Alternância de Tema **Claro (Alto Contraste Solar)** / **Escuro (Noturno)** com persistência confirmada após `reload`.
     - [x] Seletor de Modelos: **Modelo FieldCast (Ensemble)**, **ECMWF IFS 0.25°**, **NOAA GFS**, **DWD ICON** e **Spaghetti Plot**, além do toggle **Interpolação 10–120m** com selo **"Estimado"** e aviso da Lei de Potência ($v(z) = v_{\text{ref}} \cdot (z / z_{\text{ref}})^\alpha$, rajadas estritas a 10m).
     - [x] Botões de Ajuda Contextual (`?`), modal **Guia Rápido & Glossário Operacional** e modal **Painel de Autodiagnóstico (Health Check)** com tabela de Circuit Breaker e status do IndexedDB.
     - [x] Modal **Pontos Salvos & Busca Geográfica**: alternância entre **Florianópolis — SC (Costeiro, DEM 23m, Onda/Swell ativo)** e **Brasília — DF (Continental, DEM 1092m, aviso "Ponto Continental — Grade marinha não aplicável em terra firme (sem penalidade na confiança)" e nota 94/100 Alta Confiabilidade)**.
     - [x] Aba **Mapa & Radar**: Mapa Leaflet interativo com `OfflineCartoTileLayer`, controles do player RainViewer e ferramenta **Área de Missão Offline** com estimador de tiles e limite estrito de **300 tiles**.
     - [x] Aba **Campo & Dados**: Início e encerramento de rota no **GPS Tracker Adaptativo**, criação de **Waypoint Georreferenciado** (*"Ponto de Fundeio Ilha do Campeche"*) com **Snapshot Automático de Condições** e exportação nos 4 formatos (**CSV BOM UTF-8**, **JSON**, **GPX 1.1**, **GeoJSON RFC 7946**) com feedback via Toast (`safeAction`).
     - [x] Viewport Mobile (`390x844`): *Bottom Tab Bar* fixa com 3 abas e 100% dos alvos interativos auditados com dimensões $\ge 44\times44\text{px}$.

3. **Documentação Final (`README.md`):**
   - `README.md` completo documentando arquitetura, motor matemático/meteorológico, stack Zero-Crash offline-first e passo a passo detalhado para: (1) execução local, (2) publicação gratuita do PWA na Vercel ou GitHub Pages, (3) compilação local do `.apk` Android via Capacitor e (4) download do `.apk` compilado automaticamente na nuvem via GitHub Actions (`.github/workflows/android-apk.yml`).
