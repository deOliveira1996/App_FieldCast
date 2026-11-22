# Handoff Sprint 3B — Operações de Campo, Adaptadores Híbridos, GPS Tracker, Waypoints & Bússola

**Status:** `CONCLUÍDA`
**Validação TypeScript (`npx tsc --noEmit`):** `0 erros`
**Validação Vitest (`npx vitest run src/test/fieldOps.test.ts`):** `13 passed (13)`

---

## 1. Inventário de Arquivos Criados (Write-Scope Estrito 3B)

### 1.1. Adaptadores Híbridos de Plataforma (`src/services/platform/`)
- `src/services/platform/LocationTrackerService.ts`
  - `MAX_TRACK_ACCURACY_M = 20`
  - `ANDROID_FOREGROUND_NOTIFICATION_TITLE = 'FieldCast: Gravando rota...'`
  - `ANDROID_FOREGROUND_NOTIFICATION_BODY`
  - `ANDROID_REQUIRED_PERMISSIONS` (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`)
  - `WEB_WAKE_LOCK_WARNING_MESSAGE = 'Mantenha a tela ligada durante a gravação no navegador'`
  - `detectRuntimePlatform(): PlatformKind` (`Capacitor.isNativePlatform()` -> `'android' | 'ios' | 'web'`)
  - `isTrackAccuracyAcceptable(accuracyM: number | null | undefined, maxAccuracyM?: number): boolean`
  - `applyReadingToTrackSession(session: TrackSession, reading: RawGpsReading, maxAccuracyM?: number)`
  - `LocationTrackerService` & singleton `locationTrackerService`:
    - `startTracking(customName?: string): Promise<TrackSession>`
    - `pauseTracking(): Promise<TrackSession | null>`
    - `resumeTracking(): Promise<TrackSession | null>`
    - `stopTracking(): Promise<TrackSession | null>`
    - `ingestPositionReading(reading: RawGpsReading): Promise<{ accepted: boolean; point?: TrackPoint; session: TrackSession | null }>`
    - `getState(): LocationTrackerState`
    - `subscribe(listener: (state: LocationTrackerState) => void): () => void`
- `src/services/platform/CameraService.ts`
  - `TARGET_PHOTO_MAX_KB = 200`
  - `DEFAULT_MAX_PHOTO_DIMENSION_PX = 1280`
  - `estimateDataUrlSizeKb(dataUrl: string): number`
  - `computeScaledDimensions(srcWidth: number, srcHeight: number, maxDimensionPx?: number): { width: number; height: number }`
  - `readFileAsDataUrl(file: Blob): Promise<string>`
  - `compressImageDataUrl(sourceDataUrl: string, options?: CompressImageOptions): Promise<CompressedPhotoResult>`
  - `compressImageFile(file: File, options?: CompressImageOptions): Promise<CompressedPhotoResult>`
  - `pickAndCompressImageFromWebInput(options?): Promise<CompressedPhotoResult>`
  - `captureAndCompressPhoto(options?: CapturePhotoOptions): Promise<CompressedPhotoResult>` (`@capacitor/camera` no Android/iOS nativo; `<input type="file" accept="image/*" capture="environment">` na Web + compressão `<canvas>` para ~200 KB WebP/JPEG).
- `src/services/platform/ShareService.ts`
  - `getMimeTypeForFormat(format: ExportFormat): string`
  - `getFileExtensionForFormat(format: ExportFormat): string`
  - `triggerBrowserFileDownload(filename: string, content: string, mimeType: string): void`
  - `exportAndDeliverFile(payload: ExportDeliveryPayload): Promise<ExportDeliveryResult>` (`@capacitor/filesystem` + `@capacitor/share` no mobile nativo, Web Share API no mobile web, download local `Blob` + `<a download>` no desktop).
  - `buildExportArtifact(params): { filename: string; content: string; format: ExportFormat }`
  - `shareBulletinViaWhatsApp(params): { text: string; url: string }` (`https://wa.me/?text=...`)
- `src/services/platform/index.ts` — Barrel export de `src/services/platform/`.

### 1.2. Hook de Geolocalização Inteligente em Cascata (`src/hooks/useSmartLocation.ts`)
- `GPS_TIMEOUT_MS = 8000`
- `acquireDeviceGpsFix(timeoutMs?: number, isNativePlatformFn?: () => boolean): Promise<RawGpsFix>`
- `resolveDexieCachedCoordinates(): Promise<ActiveCoordinates>`
- `resolveCascadingLocation(options?: ResolveCascadingLocationOptions): Promise<SmartLocationResolution>`:
  1. **Nível 1 (GPS 8s):** `@capacitor/geolocation` ou `navigator.geolocation.getCurrentPosition` com timeout de `8000ms` (`origin: 'gps'`, `gpsStatus: 'granted'`).
  2. **Nível 2 (Fallback IP):** `https://ipwho.is/` via `fetchIpApproximateLocation` sinalizado como *"Aproximado via IP"* (`origin: 'ip'`, `isApproximateIp: true`, `gpsStatus: 'fallback_ip'`).
  3. **Nível 3 (Cache Offline Dexie):** última previsão em cache (`getLatestCachedForecast`) ou local salvo (`getSavedLocations`) no IndexedDB (`origin: 'cached'`, `gpsStatus: 'offline_cache'`).
- `useSmartLocation(options?: UseSmartLocationOptions): UseSmartLocationReturn`

### 1.3. Componentes da Aba Campo & Dados (`src/components/field/`)
- `src/components/field/WindCompass.tsx`
  - `normalizeCompassDeg(angleDeg: number): number`
  - `computeRelativeBearingDeg(targetDirectionDeg: number | null | undefined, deviceHeadingDeg: number): number | null`
  - `extractHeadingFromOrientationEvent(event): { headingDeg: number; source: CompassReading['source'] } | null`
  - `requiresIosOrientationPermission(): boolean`
  - `<WindCompass />`:
    - **iOS:** botão explícito (`>= 44x44px`, `safeAction`) chamando `DeviceOrientationEvent.requestPermission()` + leitura de `webkitCompassHeading`.
    - **Android/Web:** leitura de `deviceorientationabsolute` / `deviceorientation` (`360 - alpha`).
    - **Desktop / Sem sensor:** oculta automaticamente (`return null`), conforme Seção 4.6 de `docs/SPEC.md`.
- `src/components/field/FieldDataTab.tsx`
  - `extractConditionSnapshotFromForecast(forecast: NormalizedForecast | null, referenceDate?: Date): ConditionSnapshot`
  - `<FieldDataTab />` com `<ModuleErrorBoundary>` isolando cada sub-módulo:
    1. **Bússola de Vento e Onda Relativa** (`<WindCompass />`)
    2. **Painel GPS Tracker Adaptativo** (Iniciar/Pausar/Retomar/Encerrar, distância Haversine em tempo real, acurácia atual, pontos aceitos `<= 20m` vs descartados `> 20m`, banner Web Wake Lock *"Mantenha a tela ligada durante a gravação no navegador"*, lista e exclusão de rotas gravadas).
    3. **Waypoints com Foto Georreferenciada** (formulário com título, observação, captura/upload de foto comprimida via `<canvas>` ~200 KB, snapshot automático de condições meteorológicas/marinhas da hora e galeria offline com exclusão).
    4. **Central de Exportação & Compartilhamento** (exportação de Previsão 168h, Waypoints, Rotas GPS e Missão Completa em **CSV com BOM UTF-8 `\uFEFF`**, **JSON**, **GPX 1.1** e **GeoJSON RFC 7946**, além de compartilhamento de boletim operacional via WhatsApp `wa.me`).
- `src/components/field/index.ts` — Barrel export de `src/components/field/`.

### 1.4. Testes Unitários (`src/test/fieldOps.test.ts`)
- 13 testes cobrindo filtro de acurácia (`<= 20m` aceito, `> 20m` descartado + contagem `discardedLowAccuracyCount` + distância Haversine), cascata de localização (GPS -> `ipwho.is` -> Dexie), snapshot automático de waypoint, compressão/estimativa de foto `< 200 KB`, matemática da bússola relativa (`webkitCompassHeading` e `360 - alpha`) e geração de artefatos CSV BOM / JSON / GPX / GeoJSON / link `wa.me`.

---

## 2. Contratos de Integração para a Sprint 3C (`src/App.tsx`)

### `FieldDataTabProps` (`src/components/field/FieldDataTab.tsx`)
```ts
export interface FieldDataTabProps {
  forecast: NormalizedForecast | null;
  activeLocation: ActiveCoordinates;
  waypoints?: Waypoint[];
  tracks?: TrackSession[];
  onWaypointsChange?: (waypoints: Waypoint[]) => void;
  onTracksChange?: (tracks: TrackSession[]) => void;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
  simulatedCompassHeadingDeg?: number | null;
}
```

### Exemplo de Uso em `src/App.tsx`
```tsx
import { FieldDataTab } from './components/field';
import { useSmartLocation } from './hooks/useSmartLocation';

// Na inicialização do App:
const {
  activeLocation,
  gpsStatus,
  isLocating,
  resolveLocation,
  setManualLocation,
} = useSmartLocation({ autoResolveOnMount: true });

// Na renderização da aba 'field':
<FieldDataTab
  forecast={forecast}
  activeLocation={activeLocation}
  waypoints={waypoints}
  tracks={tracks}
  onWaypointsChange={setWaypoints}
  onTracksChange={setTracks}
  onToast={addToast}
  onErrorLog={logErrorToDb}
/>
```
