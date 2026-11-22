# Handoff Sprint 2A — Core Matemático, Serviços com Circuit Breaker, Dexie & Vitest

## 1. Resumo de Entrega (Sprint 2A — Swarm Paralelo)
Todos os módulos do motor matemático/meteorológico, índice de confiabilidade, alertas operacionais e efemérides offline, exportadores puros, banco de dados offline IndexedDB (`dexie`) e serviços de API com Circuit Breaker e validação `zod` foram implementados e testados dentro do `Write-Scope` estrito da Sprint 2A.

---

## 2. Inventário de Arquivos e Assinaturas Exportadas

### 2.1. `src/utils/ensembleMath.ts`
- `NATIVE_WIND_HEIGHTS_M = [10, 80, 100, 120] as const`
- `INTERPOLATED_WIND_HEIGHTS_M = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120] as const`
- `MIN_NORMAL_SHEAR_ALPHA = 0.05`
- `MAX_NORMAL_SHEAR_ALPHA = 0.4`
- `ATYPICAL_SHEAR_MESSAGE = 'Cisalhamento Atípico — Baixa Confiança na Interpolação'`
- `filterValidNumbers(values: readonly (number | null | undefined)[]): number[]`
- `computeScalarStat(values: readonly (number | null | undefined)[], valuesByModel?: Partial<Record<WeatherModelId, number | null>>): ScalarStat`
- `computeModelScalarStat(valuesByModel: Partial<Record<WeatherModelId, number | null>>): ScalarStat`
- `normalizeAngleDeg(angleDeg: number): number`
- `decomposeMeteorologicalVector(directionDeg: number, speed?: number): { u: number; v: number }`
- `reconstructDirectionFromUV(uMean: number, vMean: number): number | null`
- `computeCircularStat(anglesDeg: readonly (number | null | undefined)[], speeds?: readonly (number | null | undefined)[], valuesByModel?: Partial<Record<WeatherModelId, number | null>>): CircularStat`
- `computeModelCircularStat(directionsByModel: Partial<Record<WeatherModelId, number | null>>, speedsByModel?: Partial<Record<WeatherModelId, number | null>>): CircularStat`
- `fitPowerLawAlpha(levels: readonly { heightM: number; speedKmh: number | null }[]): number | null`
- `buildVerticalWindProfile(input: { speed10m: number | null; speed80m: number | null; speed100m: number | null; speed120m: number | null; direction10m?: number | null; direction80m?: number | null; direction100m?: number | null; direction120m?: number | null }): VerticalWindProfile`
- `extractNativeModelSeries(timesUnix: readonly number[], model: WeatherModelId, hourlyRaw: Record<string, readonly (number | null)[] | undefined>): NativeModelHour[]`

### 2.2. `src/utils/confidenceIndex.ts`
- `SHEAR_PENALTY_POINTS = 10`
- `getConfidenceBadgeColor(total: number): ConfidenceBadgeColor` (`green` 80–100, `amber` 50–79, `red` 0–49)
- `computeTimeHorizonPoints(hourIndex: number): number` (`0–20 pts`)
- `computeModelAgreementPoints(input): { points: number; reasons: string[] }` (`0–50 pts`)
- `computeSourceIntegrityPoints(input): { points: number; reasons: string[] }` (`0–30 pts` com **Regra Continental** aplicando zero penalidade quando `isContinental === true` / `marineAvailable === false` em terra firme)
- `computeHourlyConfidence(input: HourlyConfidenceInput): ConfidenceScore`
- `computeOverallConfidence(hours: readonly Pick<EnsembleHour, 'hourIndex' | 'confidence'>[], options?: { isContinental?: boolean }): ConfidenceScore`

### 2.3. `src/utils/operationalAlerts.ts`
- `BAROMETRIC_SQUALL_DROP_THRESHOLD_HPA = 4`
- `FOG_VISIBILITY_THRESHOLD_M = 1000`
- `FOG_DEW_POINT_SPREAD_THRESHOLD_C = 2`
- `evaluateSafeWindow(input, thresholds?: SafeWindowThresholds): { status: SafeWindowStatus; reasons: string[] }`
- `computePressureDelta3h(pressuresHpa: readonly (number | null | undefined)[], index: number): number | null`
- `isBarometricSquallRisk(delta3hHpa: number | null | undefined): boolean`
- `evaluateBarometricTendency(pressurePrev3hHpa, pressureCurrentHpa): { delta3hHpa: number | null; dropHpa: number | null; isSquallRisk: boolean }`
- `computeDewPointSpread(temperature2mC, dewPoint2mC): number | null`
- `evaluateFogRisk(input: { visibilityM; temperature2mC?; dewPoint2mC?; dewPointSpreadC? }): boolean`
- `buildStratifiedCloudCover(input): StratifiedCloudCover`
- `generateOperationalAlerts(hours: readonly EnsembleHour[]): OperationalAlert[]`
- `getMoonPhaseLabel(phase: number): string`
- `computeEphemerisForDate(date: Date, latitude: number, longitude: number): EphemerisData`
- `computeEphemerisRange(latitude: number, longitude: number, timestampsUnix: readonly number[]): EphemerisData[]`

### 2.4. `src/utils/exporters.ts`
- `UTF8_BOM = '\uFEFF'`
- `haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number`
- `haversineDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number`
- `computeTrackDistanceKm(points: readonly Pick<TrackPoint, 'latitude' | 'longitude'>[]): number`
- `exportForecastToCsv(forecast: NormalizedForecast): string`
- `exportWaypointsToCsv(waypoints: readonly Waypoint[]): string`
- `exportTracksToCsv(tracks: readonly TrackSession[]): string`
- `exportToJson(data: unknown): string`
- `exportForecastToJson(forecast: NormalizedForecast): string`
- `exportFieldDataToJson(payload): string`
- `exportToGpx(options: { waypoints?: readonly Waypoint[]; tracks?: readonly TrackSession[]; name?: string }): string`
- `exportToGeoJson(options: { waypoints?: readonly Waypoint[]; tracks?: readonly TrackSession[]; forecast?: NormalizedForecast | null }): string`
- `buildWhatsAppShareUrl(forecast: NormalizedForecast, locationName?: string): { text: string; url: string }`

### 2.5. `src/db/database.ts`
- `db: FieldCastDatabase` (tabelas Dexie: `savedLocations`, `forecastCache`, `waypoints`, `tracks`, `offlineTiles`, `errorLogs` + fallback em memória para ambientes sem `indexedDB` como `jsdom`)
- `buildLocationKey(latitude: number, longitude: number): string`
- `DEFAULT_SAVED_LOCATIONS: SavedLocation[]`
- `ensureDefaultSavedLocations(): Promise<SavedLocation[]>`
- `getSavedLocations(): Promise<SavedLocation[]>`
- `upsertSavedLocation(location: SavedLocation): Promise<void>`
- `renameSavedLocation(id: string, newName: string): Promise<void>`
- `toggleFavoriteLocation(id: string): Promise<void>`
- `deleteSavedLocation(id: string): Promise<void>`
- `saveForecastCache(forecast: NormalizedForecast): Promise<void>`
- `getCachedForecast(latitude: number, longitude: number, maxDistanceKm?: number): Promise<ForecastCacheRecord | null>`
- `getLatestCachedForecast(): Promise<ForecastCacheRecord | null>`
- `saveWaypoint(waypoint: Waypoint): Promise<void>`, `getWaypoints(): Promise<Waypoint[]>`, `deleteWaypoint(id: string): Promise<void>`
- `saveTrackSession(track: TrackSession): Promise<void>`, `getTrackSessions(): Promise<TrackSession[]>`, `deleteTrackSession(id: string): Promise<void>`
- `saveOfflineTile(tile: OfflineTileRecord): Promise<void>`, `getOfflineTile(key: string): Promise<OfflineTileRecord | undefined>`, `getOfflineTilesCount(missionId?: string): Promise<number>`, `clearOfflineTiles(missionId?: string): Promise<void>`
- `logErrorToDb(record: Omit<ErrorLogRecord, 'id'>): Promise<void>`, `getRecentErrorLogs(limit?: number): Promise<ErrorLogRecord[]>`, `clearErrorLogs(): Promise<void>`
- `checkIndexedDbHealth(): Promise<boolean>`, `resetDatabaseForTests(): Promise<void>`

### 2.6. `src/services/httpClient.ts`
- `CircuitOpenError`
- `fetchWithCircuitBreaker<T>(options: HttpRequestOptions<T>): Promise<HttpClientResult<T>>` (timeout 10s `AbortController`, 2 retries com backoff exponencial, validação `zod`, abre após 3 falhas consecutivas e aciona fallback)
- `getEndpointHealthSnapshot(): Record<MonitoredServiceId, ServiceEndpointStatus>`
- `getServiceEndpointStatus(service: MonitoredServiceId): ServiceEndpointStatus`
- `getOverallEndpointsHealthLevel(): HealthLevel`
- `recordServiceSuccess`, `recordServiceFailure`, `markServiceDegraded`, `resetCircuitBreaker`

### 2.7. `src/services/openMeteoService.ts`
- `buildOpenMeteoForecastUrl(latitude: number, longitude: number, forecastDays?: number): string`
- `buildOpenMeteoMarineUrl(latitude: number, longitude: number, forecastDays?: number): string`
- `normalizeOpenMeteoForecast(params: NormalizeForecastParams): NormalizedForecast`
- `reapplyThresholdsToForecast(forecast: NormalizedForecast, thresholds: SafeWindowThresholds): NormalizedForecast`
- `fetchOpenMeteoForecast(latitude: number, longitude: number, options?: FetchForecastOptions): Promise<NormalizedForecast>`

### 2.8. `src/services/rainViewerService.ts`
- `buildRainViewerTileUrl(host: string, path: string, colorScheme?: number, smoothData?: string): string`
- `normalizeRainViewerResponse(raw: RainViewerResponse): RainViewerRadarState`
- `fetchRainViewerRadar(options?): Promise<RainViewerRadarState>` (degradação graciosa para estado `degraded` âmbar sem crash)

### 2.9. `src/services/geocodingService.ts`
- `buildNominatimSearchUrl(query: string, limit?: number): string`
- `searchLocationsNominatim(query: string, options?): Promise<GeocodingLocationResult[]>` (proteção de rate-limit >= 1000ms e sem header `User-Agent` customizado)
- `geocodingResultToSavedLocation(result: GeocodingLocationResult, isFavorite?: boolean): SavedLocation`
- `geocodingResultToActiveCoordinates(result: GeocodingLocationResult): ActiveCoordinates`
- `fetchIpApproximateLocation(options?): Promise<ActiveCoordinates>` (`https://ipwho.is/` sinalizado como `"Aproximado via IP"`)

---

## 3. Resultados da Validação (`tsc` & `vitest`)

- **TypeScript (`npx tsc --noEmit`):** `0 erros`
- **Vitest (`npx vitest run src/test/`):** `7 test files passed (7), 49 tests passed (49)`
  - `src/test/safeAction.test.ts` (4 tests)
  - `src/test/schemas.test.ts` (6 tests)
  - `src/test/ensembleMath.test.ts` (10 tests)
  - `src/test/confidenceIndex.test.ts` (5 tests)
  - `src/test/operationalAlerts.test.ts` (8 tests)
  - `src/test/exportersAndDb.test.ts` (7 tests)
  - `src/test/servicesAndFixtures.test.ts` (9 tests)
