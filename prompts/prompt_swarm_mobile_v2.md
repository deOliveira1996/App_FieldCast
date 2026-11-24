# SWARM MOBILE & V2 — FIELDCAST (PROMPT CONSOLIDADO DE EXECUÇÃO)

Leia `@AGENTS.md`, `@.agents/rules/fieldcast-standards.md` e ative a skill correspondente ao seu escopo em `/.agents/skills/`.

## Arquitetura Anti-Colisão (`workspace: "share"` + `Write-Scope`)

### Operador 1 — Core, APIs, Histórico & Exportadores (`fieldcast-core-data`)
- **Escopo**: `src/services/openMeteoService.ts`, `src/services/historicalWeatherService.ts`, `src/services/httpClient.ts`, `src/services/geocodingService.ts`, `src/services/rainViewerService.ts`, `src/db/database.ts`, `src/utils/exporters.ts`, `src/utils/operationalAlerts.ts`, `src/utils/localTimeHour.ts`, `src/utils/modelComparison.ts`, `src/services/platform/ShareService.ts`, `src/test/`.
- **Entregáveis**:
  1. Integrar modelo **`gem_seamless`** (`GEM 15 km`) no ensemble escalar/vetorial e comparação de modelos mantendo retrocompatibilidade com fixtures de 3 modelos.
  2. Incluir **`sea_level_height_msl`** na Marine API (estimativa indicativa de nível do mar / maré).
  3. Criar `historicalWeatherService.ts` + persistência em Dexie/localStorage para **séries históricas sob demanda** (intervalo temporal, coordenada, modelos selecionados/todos) e **recorrência semanal local**.
  4. Corrigir agrupamento e parsing de datas em **`operationalAlerts.ts`** e **`localTimeHour.ts`** para que `YYYY-MM-DD` nunca volte para o dia anterior em UTC-3.
  5. Atualizar **`httpClient.ts`** com estado inicial `'unverified'` ("Sob Demanda") em vez de falso `'healthy'`, e expor probes ativos para `nominatim`, `ipwhois` e `rainviewer`.
  6. Atualizar **`exporters.ts`** e **`ShareService.ts`**: boletim WhatsApp usando hora local atual com temperatura, precipitação, vento médio, direção e rajadas sempre pareados; corrigir `mission_bundle` CSV; adicionar geradores **`KML`** e **`KMZ`** (Google Earth).

### Operador 2 — Previsão UI, Gráficos, Efemérides & Scroll Mobile (`fieldcast-ui-charts`)
- **Escopo**: `src/components/forecast/*`, `src/components/common/HelpPopover.tsx`, `src/test/`.
- **Entregáveis**:
  1. Remover `scrollIntoView` automático do `useEffect` em `WindguruTable.tsx` (manter scroll estritamente no container horizontal ao clicar no botão "Agora").
  2. Corrigir `EphemerisCard.tsx` (`formatDateTab`) para abrir sempre na data local atual correta.
  3. Adicionar **painel-resumo pontual** junto aos gráficos (`ForecastCharts.tsx`) mostrando dados da janela horária selecionada/atual sem obrigar clique na linha, mantendo plots interativos e adicionando curva de nível do mar (`sea_level_height_msl`) com aviso explícito de que não substitui tábua oficial da DHN.
  4. Atualizar `ModelSelectorBar.tsx` e UI de comparação para suportar `gem_seamless`.
  5. Adicionar opção explícita de **"Definir como Área Principal"** nos controles de localização/GPS (`CurrentSummaryCard.tsx` / `SavedLocationsModal.tsx`).

### Operador 3 — Mapa Otimizado, Bússola WebView, Histórico UI & Diagnóstico (`fieldcast-map-radar` + `fieldcast-field-ops`)
- **Escopo**: `src/components/map/*`, `src/services/weatherGridService.ts`, `src/components/field/*`, `src/components/common/HealthCheckModal.tsx`, `src/hooks/useSmartLocation.ts`, `src/App.tsx`, `src/components/layout/*`, `src/test/`.
- **Entregáveis**:
  1. Otimizar `WeatherModelOverlayLayer.tsx` com cache offscreen da malha IDW (eliminando redesenho por frame no WebView Android) e suportar `gem_seamless` + debounce e fallback seguro no `MapRadarTab.tsx`.
  2. Persistir **área principal do usuário** (localStorage + Dexie) em `App.tsx` e `useSmartLocation.ts`, preservando localização selecionada e pin ao fechar, reabrir ou trocar de aba; oferecer salvar fix de GPS como área principal.
  3. Corrigir `WindCompass.tsx` com prioridade absoluta (`AbsoluteOrientationSensor` / `deviceorientationabsolute` exclusivo + compensação 3D + toggle/auto-ocultamento seguro caso hardware Android entregue eixos inconsistentes).
  4. Construir painel opcional de **Séries Históricas & Recorrência Semanal** e botões **KML/KMZ** em `FieldDataTab.tsx`.
  5. Conectar `handleRunHealthCheck` em `App.tsx` sondando todas as 5 APIs (`open_meteo_forecast`, `open_meteo_marine`, `rainviewer`, `nominatim`, `ipwhois`) e exibir com clareza em `HealthCheckModal.tsx`.

### Operador 4 — Ícones Android, QA & Build Final (`fieldcast-android-release` + `fieldcast-qa-audit`)
- **Escopo**: `scripts/*`, `android/app/src/main/res/*`, `compilar-fieldcast.bat`, `.github/workflows/android-apk.yml`, sincronização para `F:\Backup-data\local_data\App_FieldCast`.
- **Entregáveis**:
  1. Garantir geração de `mipmap-*/ic_launcher*.png` e `values/ic_launcher_background.xml` (`#0f172a`) no `icons:generate` para o app instalado no Android exibir o ícone FieldCast.
  2. Executar `npx tsc --noEmit`, `npm run test`, `npm run build`, verificação visual no navegador e compilação Windows + Android APK em `F:\Backup-data\local_data\App_FieldCast`.
