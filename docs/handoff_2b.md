# Handoff Sprint 2B — UI Windy/Windguru, Apache ECharts, Error Boundaries, Health Check & Ajuda Contextual

**Status:** `CONCLUÍDA`
**Validação TypeScript (`tsc --noEmit`):** `0 erros` (100% tipado contra `src/types/*` e integrado com `src/utils/safeAction.ts`).

---

## 1. Inventário de Arquivos Criados / Atualizados (Write-Scope Estrito 2B)

### Estilos & Hooks
- `src/styles/index.css` — Estilos base Tailwind CSS (temas Claro de alto contraste solar e Escuro noturno) + utilitário `.scrollbar-thin` para a grade horária de 168h.
- `src/hooks/useTheme.ts` — Hook `useTheme(defaultTheme?: ThemeMode)` com persistência em `localStorage` (`fieldcast_theme`), sincronização da classe `dark` em `document.documentElement` e atualização de `<meta name="theme-color">`.
- `src/hooks/useToast.ts` — Hook `useToast()` gerenciando fila de `ToastMessage[]` com auto-dismiss e assinatura `addToast: (toast: Omit<ToastMessage, 'id'>) => string` compatível diretamente com `onToast` do `safeAction`.

### Resiliência, Feedback, Ajuda Contextual & Health Check (`src/components/common/`)
- `src/components/common/GlobalErrorBoundary.tsx` — Error Boundary de raiz exibindo motivo exato da exceção, stack trace, timestamp UTC e botões `>= 44x44px` *"Copiar Relatório Técnico"* e *"Limpar Cache e Reiniciar"* (via `safeAction`).
- `src/components/common/ModuleErrorBoundary.tsx` — Error Boundary granular por módulo/aba com tradução amigável do erro, detalhe técnico, horário UTC e botão *"Recarregar Módulo"* (via `safeAction`).
- `src/components/common/ToastContainer.tsx` — Pilha flutuante acessível (`aria-live="polite"`) para `ToastMessage[]` (`success`, `info`, `warning`, `error`).
- `src/components/common/SkeletonLoaders.tsx` — Skeletons reutilizáveis: `PulseBlock`, `SummaryCardSkeleton`, `ChartSkeleton`, `TableSkeleton` e `ForecastSkeleton`.
- `src/components/common/HelpPopover.tsx` — Botão contextual (`?`) com alvo de toque `min-h-[44px] min-w-[44px]` e dicionário `HELP_TOPICS` em português simples (`confidence`, `ensemble_vs_native`, `vertical_profile`, `barometric_trend`, `safe_window`, `fog_risk`, `stratified_clouds`, `waves_swell`, `ephemeris`).
- `src/components/common/GlossaryModal.tsx` — Modal *"Guia Rápido & Glossário Operacional"* com busca instantânea e filtro por categorias (*Guia de Campo*, *Modelos & Perfil Vertical*, *Confiabilidade*, *Alertas & Semáforo*, *Ondas & Marinho*).
- `src/components/common/HealthBadge.tsx` — Indicador fixo no cabeçalho (Verde `healthy`, Âmbar `degraded`, Vermelho `down`) com contador de erros e abertura do modal de autodiagnóstico.
- `src/components/common/HealthCheckModal.tsx` — Painel completo de autodiagnóstico exibindo Plataforma (`web` / `android` / `ios`), status do GPS em cascata, integridade do IndexedDB, frescor do cache de previsão, tabela de APIs monitoradas com latência e estado do Circuit Breaker, e tabela de Log de Erros (`ErrorLogRecord[]`).
- `src/components/common/index.ts` — Barrel export de `src/components/common/`.

### Shell Responsivo & Seletor de Pontos Salvos/Busca (`src/components/layout/`)
- `src/components/layout/SavedLocationsModal.tsx` — Modal de **Pontos Salvos + Busca Geográfica**:
  - Busca textual Nominatim (OSM) disparada exclusivamente no `onSubmit` (Enter / botão *"Buscar"*), respeitando a política de 1 req/s.
  - Botões rápidos *"Usar Meu GPS"* e *"Salvar Atual"*.
  - Entrada manual de coordenadas (`Latitude`, `Longitude`, `Nome`).
  - Lista de `SavedLocation[]` com seleção offline, estrela de favorito, renomeação inline e exclusão (todos `>= 44x44px` com `safeAction`).
- `src/components/layout/AppShell.tsx` — Layout responsivo com:
  - Cabeçalho contendo logo `/icon.svg`, seletor do ponto ativo + badge de origem (`GPS`, `Aproximado via IP`, `Cache Offline`, `Ponto Salvo`, `Busca OSM`), barra de navegação superior limpa no desktop (`hidden md:flex`), botão de atualização, botão *"Guia Rápido & Glossário"*, toggle de tema **Claro/Escuro** e `HealthBadge`.
  - *Bottom Tab Bar* fixa no mobile (`md:hidden`) para as 3 abas (**Previsão**, **Mapa & Radar**, **Campo & Dados**) com badge de contagem de alertas ativos.
- `src/components/layout/index.ts` — Barrel export de `src/components/layout/`.

### Aba Previsão — Hierarquia Estrita Windy / Windguru (`src/components/forecast/`)
- `src/components/forecast/CurrentSummaryCard.tsx` — Nível 1 da hierarquia: resumo atual, badge de **Altitude DEM Open-Meteo** (`elevationDemM`), badge de origem da localização, timestamp *"Atualizado às HH:MM"*, **Badge de Confiança (0–100)** com painel expansível detalhando os 4 pilares (*Concordância /50*, *Integridade /30 + Regra Continental*, *Horizonte /20*, *Penalidade de Cisalhamento*) + `HelpPopover`, e **Semáforo de Janela Segura** + botão *"Limites"* + `HelpPopover`.
- `src/components/forecast/ThresholdSettingsModal.tsx` — Modal de edição de `SafeWindowThresholds` (`maxWindKmh`, `maxGustKmh`, `maxWaveM`, `maxPrecipProbPct`) validado com `SafeWindowThresholdsSchema` (`zod`) e salvo via `safeAction`.
- `src/components/forecast/ActiveAlertsBanner.tsx` — Nível 2 da hierarquia: banner de alertas operacionais ativos para Queda Barométrica ($\Delta P / 3\text{h} > 4\text{ hPa}$), Risco de Nevoeiro (`visibility < 1000m` & *dew point spread* $< 2^\circ\text{C}$), Cisalhamento Atípico ($\alpha \notin [0.05, 0.40]$) e violação do Semáforo, cada um com seu `HelpPopover`.
- `src/components/forecast/ModelSelectorBar.tsx` — Nível 3A da hierarquia: seletor entre **Modelo FieldCast (Ensemble)**, modelos nativos (`ecmwf_ifs025`, `gfs_seamless`, `icon_seamless`) e **Spaghetti Plot**, toggle de **Interpolação Vertical 10–120m** com selo visual **"Estimado"** + aviso de cisalhamento atípico, e filtro de horizonte (`48h`, `72h`, `168h`).
- `src/components/forecast/ForecastCharts.tsx` — Nível 3B da hierarquia (Apache ECharts via `echarts-for-react`):
  1. **Vento (10m–120m) & Rajadas (estritamente 10m)** com banda de incerteza `min–max` no modo Ensemble ou linhas comparativas no modo Spaghetti + **Perfil Vertical de Vento (0–120m)** da hora selecionada com controle deslizante e curva pontilhada *"Estimado"*.
  2. **Ondas Significativas, Swell & Período** (exibe aviso continental gracioso quando `marineAvailable === false`).
  3. **Precipitação Horária (mm/h) & Pressão de Superfície (hPa)**.
  4. **Nebulosidade Estratificada Separada (Baixa 0–2km, Média 2–6km, Alta >6km)**.
- `src/components/forecast/WindguruTable.tsx` — Nível 4 da hierarquia: tabela horária compacta rolável de 168h agrupada por dia, coluna esquerda fixa, linha de Semáforo (Verde/Amarelo/Vermelho), Confiança, Vento 10m/80m/100m/120m, Rajadas 10m, setas vetoriais rotacionadas (`(deg + 180) % 360`), Ondas, Chuva, Temperatura, Pressão e Nuvens B/M/A.
- `src/components/forecast/EphemerisCard.tsx` — Nível 5 da hierarquia: efemérides solares e lunares por dia (Nascer/Pôr do Sol, Crepúsculo Civil, Crepúsculo Náutico, Fase e Iluminação da Lua).
- `src/components/forecast/ForecastTab.tsx` — Container integrador da Aba Previsão encapsulado em `<ModuleErrorBoundary moduleName="Aba Previsão (Windy/Windguru)">`.
- `src/components/forecast/index.ts` — Barrel export de `src/components/forecast/`.

---

## 2. Contratos de Props Principais para Integração na Sprint 3C (`src/App.tsx`)

### `AppShellProps` (`src/components/layout/AppShell.tsx`)
```ts
export type AppTabId = 'forecast' | 'map' | 'field';

export interface AppShellProps {
  activeTab: AppTabId;
  onTabChange: (tab: AppTabId) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  activeLocation: ActiveCoordinates;
  savedLocations: SavedLocation[];
  healthSnapshot: HealthCheckSnapshot;
  activeAlertsCount?: number;
  isRefreshingForecast?: boolean;
  onRefreshForecast?: () => void | Promise<void>;
  onSelectLocation: (coords: {
    latitude: number;
    longitude: number;
    name: string;
    origin?: ActiveCoordinates['origin'];
  }) => void | Promise<void>;
  onSaveLocation?: (location: {
    name: string;
    latitude: number;
    longitude: number;
    region?: string;
    isFavorite?: boolean;
  }) => void | Promise<void>;
  onRenameLocation?: (id: string, newName: string) => void | Promise<void>;
  onToggleFavoriteLocation?: (id: string, isFavorite: boolean) => void | Promise<void>;
  onDeleteLocation?: (id: string) => void | Promise<void>;
  onSearchQuery?: (query: string) => Promise<NominatimResult[]>;
  onRequestGps?: () => void | Promise<void>;
  onRunHealthCheck?: () => void | Promise<void>;
  onClearErrorLogs?: () => void | Promise<void>;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  isLocationsModalOpen?: boolean;
  onLocationsModalOpenChange?: (open: boolean) => void;
  children: ReactNode;
}
```

### `ForecastTabProps` (`src/components/forecast/ForecastTab.tsx`)
```ts
export interface ForecastTabProps {
  forecast: NormalizedForecast | null;
  activeLocation: ActiveCoordinates;
  isLoading?: boolean;
  isDark?: boolean;
  thresholds?: SafeWindowThresholds;
  onSaveThresholds?: (nextThresholds: SafeWindowThresholds) => void | Promise<void>;
  onOpenLocationsModal?: () => void;
  onReloadForecast?: () => void | Promise<void>;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
}
```

### Hooks (`src/hooks/useTheme.ts` & `src/hooks/useToast.ts`)
```ts
const { theme, isDark, toggleTheme, setTheme } = useTheme('dark');
const { toasts, addToast, dismissToast, clearToasts } = useToast();
```
