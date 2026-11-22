# Handoff Sprint 3A — Mapa Interativo Leaflet, Radar RainViewer & Cache Offline de Área de Missão (IndexedDB)

**Status:** `CONCLUÍDA`
**Write-Scope Estrito Respeitado:** `src/services/offlineTilesService.ts`, `src/components/map/MapRadarTab.tsx`, `src/components/map/index.ts`, `src/test/offlineTiles.test.ts`, `docs/handoff_3a.md`.
**Validação:**
- `npx vitest run src/test/offlineTiles.test.ts` — **5/5 testes aprovados (100%)**
- `npx tsc --noEmit` — **0 erros**

---

## 1. Inventário de Arquivos e Assinaturas Exportadas

### 1.1. `src/services/offlineTilesService.ts`
Gerenciador de cálculo geométrico Slippy Map (Web Mercator), fila concorrente de download de tiles CartoDB com CORS (`crossOrigin: 'anonymous'`), persistência de blobs no IndexedDB (`dexie`) e subclasse customizada `OfflineCartoTileLayer` (`L.TileLayer`).

#### Constantes e Tipos Exportados
- `MAX_OFFLINE_TILES_PER_MISSION = 300` — Trava rígida máxima de tiles por missão offline.
- `MAX_CONCURRENT_TILE_DOWNLOADS = 4` — Limite máximo de downloads simultâneos na fila concorrente.
- `CARTO_VOYAGER_TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'` (Tema Claro / Solar)
- `CARTO_DARK_MATTER_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'` (Tema Escuro / Noturno)
- `CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd'] as const`
- `CARTO_ATTRIBUTION`
- `MapTileTheme = 'light' | 'dark'`
- `OfflineDownloadProgress` (alias para `OfflineMissionProgress` de `src/types/field.ts`)
- `TileCoordinate`: `{ z: number; x: number; y: number }`
- `ZoomTileCountBreakdown`: `{ zoom: number; count: number; xMin: number; xMax: number; yMin: number; yMax: number }`
- `MissionTileEstimate`: `{ totalTiles: number; exceedsLimit: boolean; maxAllowed: number; byZoom: ZoomTileCountBreakdown[] }`
- `OfflineCacheStats`: `{ totalTiles: number; lightTiles: number; darkTiles: number; totalBytes: number; missionIds: string[] }`
- `DownloadOfflineMissionOptions`
- `OfflineTileLimitExceededError` — Exceção tipada lançada quando a missão ultrapassa `MAX_OFFLINE_TILES_PER_MISSION` (`300` tiles).

#### Funções e Classes Exportadas
- `lonToTileX(lonDeg: number, zoom: number): number`
- `latToTileY(latDeg: number, zoom: number): number`
- `tileXToLon(x: number, zoom: number): number`
- `tileYToLat(y: number, zoom: number): number`
- `normalizeMissionBounds(bounds: OfflineMissionBounds): OfflineMissionBounds`
- `createMissionBoundsAroundPoint(latitude: number, longitude: number, radiusKm?: number, minZoom?: number, maxZoom?: number): OfflineMissionBounds`
- `estimateMissionTileCount(bounds: OfflineMissionBounds, maxAllowed?: number): MissionTileEstimate`
- `calculateMissionTileCoordinates(bounds: OfflineMissionBounds, options?: { enforceLimit?: boolean; maxTiles?: number }): TileCoordinate[]`
- `buildOfflineTileKey(theme: MapTileTheme, z: number, x: number, y: number): string` (`${theme}:${z}/${x}/${y}`)
- `getCartoTileUrlTemplate(theme: MapTileTheme): string`
- `buildCartoTileUrl(theme: MapTileTheme, z: number, x: number, y: number, options?: { subdomain?: string; retina?: boolean }): string`
- `downloadOfflineMissionTiles(options: DownloadOfflineMissionOptions): Promise<OfflineDownloadProgress>`
- `getOfflineCacheStats(): Promise<OfflineCacheStats>`
- Re-exports de `src/db/database.ts`: `saveOfflineTile`, `getOfflineTile`, `getOfflineTilesCount`, `clearOfflineTiles`
- `OfflineCartoTileLayer extends L.TileLayer` — Subclasse customizada que sobrescreve `createTile(coords, done)`:
  - Consulta primeiro `getOfflineTile(key)` no IndexedDB (`dexie`).
  - Se encontrado, cria ObjectURL (com fallback para Data URL em ambientes headless como `jsdom`), marca `tile.dataset.offlineSource = 'indexeddb'` e revoga o ObjectURL no `load`/`error`.
  - Caso não esteja em cache (ou se o blob falhar), faz fallback transparente para a rede CartoDB CORS (`crossOrigin: 'anonymous'`).
- `createOfflineCartoTileLayer(theme?: MapTileTheme, options?: L.TileLayerOptions): OfflineCartoTileLayer`

---

### 1.2. `src/components/map/MapRadarTab.tsx` e `src/components/map/index.ts`
Componente completo da aba **Mapa & Radar**, encapsulado em `<ModuleErrorBoundary moduleName="Aba Mapa Interativo, Radar RainViewer & Cache Offline">`.

#### Recursos Implementados
1. **Mapa Base Offline-First CartoDB CORS:**
   - Alterna automaticamente entre **CartoDB Voyager** (tema Claro) e **CartoDB DarkMatter** (tema Escuro) via `OfflineCartoTileLayer`.
   - Corrige automaticamente o redimensionamento do container Leaflet (`map.invalidateSize()`) ao alternar abas no `AppShell`.
2. **Player de Radar Animado RainViewer:**
   - Integração com `fetchRainViewerRadar()` via `safeAction`.
   - Controles com área mínima `>= 44x44px` (`min-h-[44px] min-w-[44px]`): **Play/Pause**, **Quadro Anterior**, **Próximo Quadro**, **Slider Temporal**, **Seletor de Opacidade (45% / 70% / 90%)**, **Toggle de Visibilidade** e **Atualizar Radar**.
   - Badge indicando quadro **Observado** vs. **Nowcast (+30m)** e horário formatado.
   - **Aviso Não-Bloqueante Âmbar** exibido automaticamente caso o RainViewer esteja degradado ou indisponível, mantendo o mapa base, cache offline, waypoints e trilhas 100% funcionais.
3. **Camadas Táticas de Campo:**
   - **Ponto Ativo:** Marcador com popup exibindo vento a 10m, rajadas, direção, temperatura, altura/período de onda (ou indicação continental), altitude DEM Open-Meteo e Índice de Confiança (`0–100`).
   - **Locais Salvos (`SavedLocation[]`):** Marcadores favoritos com botão *"Tornar Ponto Ativo"* (`safeAction`).
   - **Waypoints Georreferenciados (`Waypoint[]`):** Marcadores com miniatura da foto comprimida (`photoDataUrl`), nota de campo, horário UTC e `ConditionSnapshot`.
   - **Trilhas GPS (`TrackSession[]`):** Renderização de `<Polyline>` para rotas gravadas/em gravação com distância Haversine e contagem de pontos aceitos (`<= 20m`) vs. descartados (`> 20m`).
   - **Inspeção por Clique no Mapa:** Tocar em qualquer ponto do mapa permite inspecionar a coordenada e acionar *"Usar Esta Coordenada"* (`onSelectLocation`) ou *"Salvar Favorito"* (`onSaveLocation`).
4. **Ferramenta Área de Missão Offline:**
   - Definição do retângulo por **"Usar Visão Atual do Mapa"**, **"Desenhar no Mapa (2 Cliques)"** ou **Presets de Raio (`2 km`, `5 km`, `10 km`, `15 km`)** + seletores de **Zoom Mínimo** e **Zoom Máximo**.
   - Visualização do retângulo tracejado no mapa (Verde quando `<= 300` tiles; Vermelho com alerta bloqueante quando `> 300` tiles).
   - Download via `safeAction` com barra de progresso em tempo real, botão **Cancelar** (`AbortController`) e painel de estatísticas/limpeza do cache IndexedDB.

---

## 2. Contrato de Props para Integração na Sprint 3C (`src/App.tsx`)

```ts
import { MapRadarTab, type MapRadarTabProps } from './components/map';
```

```ts
export interface MapRadarTabProps {
  activeLocation: ActiveCoordinates;
  forecast?: NormalizedForecast | null;
  savedLocations?: SavedLocation[];
  waypoints?: Waypoint[];
  tracks?: TrackSession[];
  isDark?: boolean;
  onSelectLocation?: (coords: {
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
  onRadarStateChange?: (state: RainViewerRadarState) => void;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
}
```
> **Nota de Resiliência:** Caso `savedLocations`, `waypoints` ou `tracks` não sejam fornecidos via props, `MapRadarTab` carrega automaticamente os registros persistidos no IndexedDB (`getSavedLocations`, `getWaypoints`, `getTrackSessions` de `src/db/database.ts`).
