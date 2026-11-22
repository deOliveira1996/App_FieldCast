import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Compass as CompassIcon,
  Download,
  FileCode,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  MapPin,
  MessageSquareShare,
  Navigation,
  Pause,
  Play,
  PlusCircle,
  Route,
  Share2,
  Smartphone,
  Square,
  Trash2,
  Waves,
  Wind,
} from 'lucide-react';
import { ModuleErrorBoundary } from '../common/ModuleErrorBoundary';
import {
  deleteTrackSession,
  deleteWaypoint,
  getTrackSessions,
  getWaypoints,
  saveWaypoint,
} from '../../db/database';
import {
  ANDROID_FOREGROUND_NOTIFICATION_TITLE,
  captureAndCompressPhoto,
  compressImageFile,
  type CompressedPhotoResult,
  type ExportDatasetKind,
  exportAndDeliverFile,
  buildExportArtifact,
  locationTrackerService,
  type LocationTrackerState,
  MAX_TRACK_ACCURACY_M,
  shareBulletinViaWhatsApp,
  TARGET_PHOTO_MAX_KB,
  WEB_WAKE_LOCK_WARNING_MESSAGE,
} from '../../services/platform';
import type {
  ActiveCoordinates,
  ConditionSnapshot,
  ExportFormat,
  TrackSession,
  Waypoint,
} from '../../types/field';
import type { ErrorLogRecord, ToastMessage } from '../../types/health';
import type { NormalizedForecast } from '../../types/weather';
import { safeAction } from '../../utils/safeAction';
import { WindCompass } from './WindCompass';

/**
 * Extrai automaticamente o snapshot meteorológico e oceanográfico (`ConditionSnapshot`)
 * da hora mais próxima na previsão normalizada (`NormalizedForecast`).
 */
export function extractConditionSnapshotFromForecast(
  forecast: NormalizedForecast | null,
  referenceDate: Date = new Date(),
): ConditionSnapshot {
  const refUnix = Math.floor(referenceDate.getTime() / 1000);
  const refIso = referenceDate.toISOString();

  if (!forecast || forecast.hours.length === 0) {
    return {
      timestampUnix: refUnix,
      timestampIso: refIso,
      windSpeed10mKmh: null,
      windDirection10mDeg: null,
      windGusts10mKmh: null,
      temperature2mC: null,
      surfacePressureHpa: null,
      precipitationMm: null,
      waveHeightM: null,
      wavePeriodS: null,
      waveDirectionDeg: null,
      confidenceTotal: null,
      safeWindow: null,
    };
  }

  let closestHour = forecast.hours[0]!;
  let minDiff = Math.abs(closestHour.timestampUnix - refUnix);

  for (const h of forecast.hours) {
    const diff = Math.abs(h.timestampUnix - refUnix);
    if (diff < minDiff) {
      minDiff = diff;
      closestHour = h;
    }
  }

  return {
    timestampUnix: closestHour.timestampUnix,
    timestampIso: closestHour.timestampIso,
    windSpeed10mKmh: closestHour.windSpeed10m.mean,
    windDirection10mDeg: closestHour.windDirection10m.degree,
    windGusts10mKmh: closestHour.windGusts10m.mean,
    temperature2mC: closestHour.temperature2mC.mean,
    surfacePressureHpa: closestHour.surfacePressureHpa.mean,
    precipitationMm: closestHour.precipitationMm.mean,
    waveHeightM: forecast.marineAvailable ? (closestHour.marine?.waveHeight ?? null) : null,
    wavePeriodS: forecast.marineAvailable ? (closestHour.marine?.wavePeriod ?? null) : null,
    waveDirectionDeg: forecast.marineAvailable
      ? (closestHour.marine?.waveDirection ?? null)
      : null,
    confidenceTotal: closestHour.confidence.total,
    safeWindow: closestHour.safeWindow,
  };
}

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

export const FieldDataTab: React.FC<FieldDataTabProps> = ({
  forecast,
  activeLocation,
  waypoints: externalWaypoints,
  tracks: externalTracks,
  onWaypointsChange,
  onTracksChange,
  onToast,
  onErrorLog,
  simulatedCompassHeadingDeg,
}) => {
  // Estado do GPS Tracker
  const [trackerState, setTrackerState] = useState<LocationTrackerState>(() =>
    locationTrackerService.getState(),
  );
  const [routeNameInput, setRouteNameInput] = useState<string>('');
  const [savedTracks, setSavedTracks] = useState<TrackSession[]>(externalTracks ?? []);

  // Estado dos Waypoints Georreferenciados
  const [savedWaypoints, setSavedWaypoints] = useState<Waypoint[]>(externalWaypoints ?? []);
  const [wpName, setWpName] = useState<string>('');
  const [wpNote, setWpNote] = useState<string>('');
  const [wpPhoto, setWpPhoto] = useState<CompressedPhotoResult | null>(null);
  const [isCompressingPhoto, setIsCompressingPhoto] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Estado da Central de Exportação
  const [selectedDataset, setSelectedDataset] = useState<ExportDatasetKind>('mission_bundle');

  const refreshStoredFieldData = useCallback(async () => {
    const [wps, trks] = await Promise.all([getWaypoints(), getTrackSessions()]);
    setSavedWaypoints(wps);
    setSavedTracks(trks);
    onWaypointsChange?.(wps);
    onTracksChange?.(trks);
  }, [onTracksChange, onWaypointsChange]);

  useEffect(() => {
    void refreshStoredFieldData();
  }, [refreshStoredFieldData]);

  useEffect(() => {
    if (externalWaypoints) {
      setSavedWaypoints(externalWaypoints);
    }
  }, [externalWaypoints]);

  useEffect(() => {
    if (externalTracks) {
      setSavedTracks(externalTracks);
    }
  }, [externalTracks]);

  useEffect(() => {
    const unsubscribe = locationTrackerService.subscribe((nextState) => {
      setTrackerState(nextState);
    });
    return unsubscribe;
  }, []);

  // ============================================================================
  // Handlers: GPS Tracker Adaptativo
  // ============================================================================

  const handleStartTracking = (): void => {
    void safeAction(
      async () => {
        const session = await locationTrackerService.startTracking(routeNameInput);
        setRouteNameInput('');
        await refreshStoredFieldData();
        onToast?.({
          type: 'info',
          title: 'Gravação de rota iniciada',
          message: `${session.name} — filtro de acurácia <= ${MAX_TRACK_ACCURACY_M}m ativo.`,
        });
      },
      {
        actionKey: 'tracker_start',
        moduleName: 'FieldDataTab/GpsTracker',
        errorTitle: 'Erro ao iniciar gravação GPS',
        onToast,
        onErrorLog,
      },
    );
  };

  const handlePauseTracking = (): void => {
    void safeAction(
      async () => {
        await locationTrackerService.pauseTracking();
        await refreshStoredFieldData();
        onToast?.({
          type: 'info',
          title: 'Rota pausada',
          message: 'Você pode retomar ou encerrar a rota a qualquer momento.',
        });
      },
      {
        actionKey: 'tracker_pause',
        moduleName: 'FieldDataTab/GpsTracker',
        errorTitle: 'Erro ao pausar rota GPS',
        onToast,
        onErrorLog,
      },
    );
  };

  const handleResumeTracking = (): void => {
    void safeAction(
      async () => {
        await locationTrackerService.resumeTracking();
        await refreshStoredFieldData();
        onToast?.({
          type: 'info',
          title: 'Gravação retomada',
        });
      },
      {
        actionKey: 'tracker_resume',
        moduleName: 'FieldDataTab/GpsTracker',
        errorTitle: 'Erro ao retomar rota GPS',
        onToast,
        onErrorLog,
      },
    );
  };

  const handleStopTracking = (): void => {
    void safeAction(
      async () => {
        const completed = await locationTrackerService.stopTracking();
        await refreshStoredFieldData();
        if (completed) {
          onToast?.({
            type: 'success',
            title: 'Rota salva no banco offline',
            message: `${completed.name}: ${completed.totalDistanceKm.toFixed(3)} km (${completed.points.length} pts aceitos).`,
          });
        }
      },
      {
        actionKey: 'tracker_stop',
        moduleName: 'FieldDataTab/GpsTracker',
        errorTitle: 'Erro ao encerrar rota GPS',
        onToast,
        onErrorLog,
      },
    );
  };

  const handleDeleteTrack = (trackId: string, trackName: string): void => {
    void safeAction(
      async () => {
        await deleteTrackSession(trackId);
        await refreshStoredFieldData();
        onToast?.({
          type: 'info',
          title: 'Rota removida',
          message: trackName,
        });
      },
      {
        actionKey: `delete_track_${trackId}`,
        moduleName: 'FieldDataTab/GpsTracker',
        errorTitle: 'Erro ao excluir rota',
        onToast,
        onErrorLog,
      },
    );
  };

  // ============================================================================
  // Handlers: Waypoints Georreferenciados & Foto (~200 KB)
  // ============================================================================

  const handleCaptureNativeOrWebPhoto = (): void => {
    void safeAction(
      async () => {
        const compressed = await captureAndCompressPhoto({
          targetMaxKb: TARGET_PHOTO_MAX_KB,
          source: 'camera',
        });
        setWpPhoto(compressed);
        onToast?.({
          type: 'success',
          title: 'Foto capturada e comprimida',
          message: `${compressed.sizeKb.toFixed(1)} KB (${compressed.mimeType})`,
        });
      },
      {
        actionKey: 'waypoint_capture_photo',
        moduleName: 'FieldDataTab/Waypoints',
        errorTitle: 'Não foi possível capturar a foto',
        onLoadingChange: setIsCompressingPhoto,
        onToast,
        onErrorLog,
      },
    );
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;

    void safeAction(
      async () => {
        const compressed = await compressImageFile(file, {
          targetMaxKb: TARGET_PHOTO_MAX_KB,
        });
        setWpPhoto(compressed);
        onToast?.({
          type: 'success',
          title: 'Imagem comprimida via Canvas',
          message: `${compressed.sizeKb.toFixed(1)} KB (${compressed.width}x${compressed.height}px)`,
        });
      },
      {
        actionKey: 'waypoint_file_compress',
        moduleName: 'FieldDataTab/Waypoints',
        errorTitle: 'Falha ao comprimir imagem selecionada',
        onLoadingChange: setIsCompressingPhoto,
        onToast,
        onErrorLog,
      },
    );
    e.target.value = '';
  };

  const handleCreateWaypoint = (e: React.FormEvent): void => {
    e.preventDefault();
    void safeAction(
      async () => {
        const now = new Date();
        const nowIso = now.toISOString();
        const lastTrackPt = trackerState.lastAcceptedPoint;
        const lat = lastTrackPt ? lastTrackPt.latitude : activeLocation.latitude;
        const lon = lastTrackPt ? lastTrackPt.longitude : activeLocation.longitude;

        const snapshot = extractConditionSnapshotFromForecast(forecast, now);
        const defaultName = `WPT ${nowIso.slice(11, 16)} UTC`;

        const waypoint: Waypoint = {
          id: `wpt-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
          name: wpName.trim() || defaultName,
          latitude: lat,
          longitude: lon,
          timestampUtcIso: nowIso,
          note: wpNote.trim(),
          photoDataUrl: wpPhoto?.dataUrl,
          photoMimeType: wpPhoto?.mimeType,
          photoSizeKb: wpPhoto?.sizeKb,
          conditions: snapshot,
          trackId: trackerState.activeSession?.id,
        };

        await saveWaypoint(waypoint);
        setWpName('');
        setWpNote('');
        setWpPhoto(null);
        await refreshStoredFieldData();

        onToast?.({
          type: 'success',
          title: 'Waypoint georreferenciado salvo',
          message: `${waypoint.name} (${lat.toFixed(4)}, ${lon.toFixed(4)}) com snapshot meteorológico.`,
        });
      },
      {
        actionKey: 'create_waypoint',
        moduleName: 'FieldDataTab/Waypoints',
        errorTitle: 'Falha ao salvar Waypoint',
        onToast,
        onErrorLog,
      },
    );
  };

  const handleDeleteWaypoint = (waypointId: string, waypointName: string): void => {
    void safeAction(
      async () => {
        await deleteWaypoint(waypointId);
        await refreshStoredFieldData();
        onToast?.({
          type: 'info',
          title: 'Waypoint excluído',
          message: waypointName,
        });
      },
      {
        actionKey: `delete_waypoint_${waypointId}`,
        moduleName: 'FieldDataTab/Waypoints',
        errorTitle: 'Erro ao excluir Waypoint',
        onToast,
        onErrorLog,
      },
    );
  };

  // ============================================================================
  // Handlers: Central de Exportação & Compartilhamento
  // ============================================================================

  const handleExportFormat = (dataset: ExportDatasetKind, format: ExportFormat): void => {
    void safeAction(
      async () => {
        const artifact = buildExportArtifact({
          dataset,
          format,
          forecast,
          waypoints: savedWaypoints,
          tracks: savedTracks,
          locationName: activeLocation.name,
        });

        const delivery = await exportAndDeliverFile({
          filename: artifact.filename,
          content: artifact.content,
          format: artifact.format,
          title: `FieldCast — ${artifact.filename}`,
          text: `Exportação ${format.toUpperCase()} gerada pelo FieldCast (${activeLocation.name})`,
          preferNativeShare: false,
        });

        onToast?.({
          type: 'success',
          title: `Exportado em ${format.toUpperCase()}`,
          message: `${delivery.filename} (${(delivery.byteLength / 1024).toFixed(1)} KB)`,
        });
      },
      {
        actionKey: `export_${dataset}_${format}`,
        moduleName: 'FieldDataTab/ExportHub',
        errorTitle: `Falha ao exportar ${format.toUpperCase()}`,
        onToast,
        onErrorLog,
      },
    );
  };

  const handleShareWhatsApp = (): void => {
    void safeAction(
      async () => {
        const result = shareBulletinViaWhatsApp({
          forecast,
          locationName: activeLocation.name,
          latitude: activeLocation.latitude,
          longitude: activeLocation.longitude,
          waypointsCount: savedWaypoints.length,
          tracksCount: savedTracks.length,
          openWindow: true,
        });

        onToast?.({
          type: 'success',
          title: 'Boletim preparado para WhatsApp',
          message: `Link wa.me gerado para ${activeLocation.name} (${result.text.length} caracteres).`,
        });
      },
      {
        actionKey: 'share_whatsapp_bulletin',
        moduleName: 'FieldDataTab/ExportHub',
        errorTitle: 'Falha ao gerar link do WhatsApp',
        onToast,
        onErrorLog,
      },
    );
  };

  const currentSnapshot = extractConditionSnapshotFromForecast(forecast);
  const activeSession = trackerState.activeSession;

  return (
    <div className="space-y-6 pb-8">
      {/* 1. Bússola de Vento e Onda Relativa (Oculta automaticamente em Desktop/Sem sensor) */}
      <ModuleErrorBoundary
        moduleName="Bússola de Vento e Onda Relativa"
        onErrorLog={onErrorLog}
      >
        <WindCompass
          windDirection10mDeg={currentSnapshot.windDirection10mDeg}
          windSpeed10mKmh={currentSnapshot.windSpeed10mKmh}
          waveDirectionDeg={currentSnapshot.waveDirectionDeg}
          waveHeightM={currentSnapshot.waveHeightM}
          marineAvailable={forecast?.marineAvailable ?? false}
          simulatedHeadingDeg={simulatedCompassHeadingDeg}
          onToast={onToast}
          onErrorLog={onErrorLog}
        />
      </ModuleErrorBoundary>

      {/* 2. Painel GPS Tracker Adaptativo */}
      <ModuleErrorBoundary
        moduleName="Painel GPS Tracker Adaptativo"
        onErrorLog={onErrorLog}
      >
        <section
          aria-label="Painel GPS Tracker Adaptativo"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Route className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base md:text-lg font-bold text-slate-900 dark:text-white">
                  GPS Tracker Adaptativo
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Filtro estrito de acurácia (&le; {MAX_TRACK_ACCURACY_M}m) &bull; Cálculo geodésico
                  Haversine
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {trackerState.isRecording && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                  GRAVANDO ROTA
                </span>
              )}
              {trackerState.isPaused && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  PAUSADO
                </span>
              )}
            </div>
          </div>

          {/* Banner Web Wake Lock ou Notificação Foreground Service Android */}
          {trackerState.keepScreenOnWarning && (
            <div
              role="status"
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 flex items-center gap-3 text-xs sm:text-sm text-amber-900 dark:text-amber-200"
            >
              <Smartphone className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <div>
                <p className="font-bold">
                  {trackerState.wakeLockBannerMessage ?? WEB_WAKE_LOCK_WARNING_MESSAGE}
                </p>
                <p className="text-xs opacity-90">
                  Screen Wake Lock API:{' '}
                  {trackerState.wakeLockActive
                    ? 'Ativo (bloqueio automático de tela suspenso)'
                    : 'Modo padrão do navegador — evite bloquear a tela'}
                </p>
              </div>
            </div>
          )}

          {trackerState.foregroundServiceActive && (
            <div
              role="status"
              className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3.5 flex items-center gap-3 text-xs sm:text-sm text-emerald-900 dark:text-emerald-200"
            >
              <Navigation className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <p className="font-bold">
                  {trackerState.foregroundNotificationTitle ??
                    ANDROID_FOREGROUND_NOTIFICATION_TITLE}
                </p>
                <p className="text-xs opacity-90">
                  Serviço nativo Android em primeiro plano ativo com recepção contínua.
                </p>
              </div>
            </div>
          )}

          {/* Métricas em Tempo Real */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Distância Haversine
              </div>
              <div className="text-lg font-black font-mono text-slate-900 dark:text-white mt-0.5">
                {(activeSession?.totalDistanceKm ?? 0).toFixed(3)} km
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Acurácia GPS Atual
              </div>
              <div className="text-lg font-black font-mono text-slate-900 dark:text-white mt-0.5">
                {trackerState.lastAccuracyM !== null
                  ? `±${trackerState.lastAccuracyM.toFixed(1)} m`
                  : activeLocation.accuracyM
                    ? `±${activeLocation.accuracyM.toFixed(0)} m`
                    : 'Aguardando'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Pontos Aceitos (&le;20m)
              </div>
              <div className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                {activeSession?.points.length ?? 0}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Descartados (&gt;20m)
              </div>
              <div className="text-lg font-black font-mono text-amber-600 dark:text-amber-400 mt-0.5">
                {activeSession?.discardedLowAccuracyCount ?? 0}
              </div>
            </div>
          </div>

          {/* Controles de Gravação (>= 44x44px) */}
          {!activeSession ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={routeNameInput}
                onChange={(e) => setRouteNameInput(e.target.value)}
                placeholder="Nome da rota / missão (opcional)"
                aria-label="Nome da rota GPS"
                className="min-h-[44px] flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="button"
                onClick={handleStartTracking}
                className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl font-bold text-sm inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors"
              >
                <Play className="w-4 h-4" aria-hidden="true" />
                <span>Iniciar Gravação de Rota</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {trackerState.isRecording ? (
                <button
                  type="button"
                  onClick={handlePauseTracking}
                  className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white shadow-sm transition-colors"
                >
                  <Pause className="w-4 h-4" aria-hidden="true" />
                  <span>Pausar Rota</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleResumeTracking}
                  className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors"
                >
                  <Play className="w-4 h-4" aria-hidden="true" />
                  <span>Retomar Rota</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleStopTracking}
                className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-colors"
              >
                <Square className="w-4 h-4" aria-hidden="true" />
                <span>Encerrar e Salvar Rota</span>
              </button>
            </div>
          )}

          {/* Lista de Rotas Gravadas */}
          {savedTracks.length > 0 && (
            <div className="pt-2 space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Rotas Gravadas no Dispositivo ({savedTracks.length})
              </h3>
              <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                {savedTracks.map((trk) => (
                  <div
                    key={trk.id}
                    className="p-3 bg-slate-50/60 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        {trk.name}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 font-mono">
                        {trk.totalDistanceKm.toFixed(3)} km &bull; {trk.points.length} pts aceitos
                        &bull; {trk.discardedLowAccuracyCount} descartados (&gt;20m) &bull;{' '}
                        {trk.startedAtIso.slice(0, 16).replace('T', ' ')} UTC
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteTrack(trk.id, trk.name)}
                      aria-label={`Excluir rota ${trk.name}`}
                      className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 inline-flex items-center justify-center transition-colors"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </ModuleErrorBoundary>

      {/* 3. Waypoints Georreferenciados + Foto (~200 KB) + Snapshot Automático */}
      <ModuleErrorBoundary
        moduleName="Waypoints Georreferenciados & Galeria Offline"
        onErrorLog={onErrorLog}
      >
        <section
          aria-label="Waypoints Georreferenciados"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                <MapPin className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base md:text-lg font-bold text-slate-900 dark:text-white">
                  Waypoints com Foto Georreferenciada
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Compressão Canvas (~{TARGET_PHOTO_MAX_KB} KB) + Snapshot meteorológico/marinho
                  instantâneo
                </p>
              </div>
            </div>

            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              Lat {activeLocation.latitude.toFixed(4)}, Lon {activeLocation.longitude.toFixed(4)}
            </span>
          </div>

          {/* Preview do Snapshot Automático de Condições */}
          <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-sky-800 dark:text-sky-300">
              <span>Snapshot Automático de Condições (Anexado ao Waypoint)</span>
              <span className="font-mono">
                Confiança:{' '}
                {currentSnapshot.confidenceTotal !== null
                  ? `${currentSnapshot.confidenceTotal}/100`
                  : 'N/D'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-700 dark:text-slate-300">
              <div className="flex items-center gap-1.5">
                <Wind className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                <span>
                  Vento:{' '}
                  {currentSnapshot.windSpeed10mKmh !== null
                    ? `${currentSnapshot.windSpeed10mKmh.toFixed(1)} km/h`
                    : 'N/D'}
                </span>
              </div>
              <div>
                Rajada 10m:{' '}
                {currentSnapshot.windGusts10mKmh !== null
                  ? `${currentSnapshot.windGusts10mKmh.toFixed(1)} km/h`
                  : 'N/D'}
              </div>
              <div>
                Temp / Pressão:{' '}
                {currentSnapshot.temperature2mC !== null
                  ? `${currentSnapshot.temperature2mC.toFixed(1)}°C`
                  : 'N/D'}{' '}
                /{' '}
                {currentSnapshot.surfacePressureHpa !== null
                  ? `${currentSnapshot.surfacePressureHpa.toFixed(0)} hPa`
                  : 'N/D'}
              </div>
              <div className="flex items-center gap-1.5">
                <Waves className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                <span>
                  Onda:{' '}
                  {currentSnapshot.waveHeightM !== null
                    ? `${currentSnapshot.waveHeightM.toFixed(2)} m`
                    : 'Continental'}
                </span>
              </div>
            </div>
          </div>

          {/* Formulário de Novo Waypoint */}
          <form onSubmit={handleCreateWaypoint} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={wpName}
                onChange={(e) => setWpName(e.target.value)}
                placeholder="Título do Waypoint (ex.: Ponto de Fundeio / Parcel)"
                aria-label="Título do Waypoint"
                className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <input
                type="text"
                value={wpNote}
                onChange={(e) => setWpNote(e.target.value)}
                placeholder="Observação de campo (correnteza, abrigo, fundo, etc.)"
                aria-label="Observação de campo"
                className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileInputChange}
              className="hidden"
              aria-label="Selecionar foto de campo"
            />

            {wpPhoto && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img
                    src={wpPhoto.dataUrl}
                    alt="Pré-visualização comprimida"
                    className="w-12 h-12 rounded-lg object-cover border border-slate-300 dark:border-slate-700"
                  />
                  <div className="text-xs">
                    <div className="font-bold text-slate-900 dark:text-white">
                      Foto anexada e comprimida ({wpPhoto.sizeKb.toFixed(1)} KB)
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">
                      {wpPhoto.mimeType} &bull; {wpPhoto.width}x{wpPhoto.height}px
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setWpPhoto(null)}
                  className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                >
                  Remover
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleCaptureNativeOrWebPhoto}
                disabled={isCompressingPhoto}
                className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm inline-flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 transition-colors"
              >
                <Camera className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <span>{isCompressingPhoto ? 'Comprimindo...' : 'Câmera (~200 KB)'}</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isCompressingPhoto}
                className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm inline-flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 transition-colors"
              >
                <ImageIcon className="w-4 h-4 text-teal-500" aria-hidden="true" />
                <span>Anexar Arquivo</span>
              </button>

              <button
                type="submit"
                className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition-colors ml-auto"
              >
                <PlusCircle className="w-4 h-4" aria-hidden="true" />
                <span>Registrar Waypoint</span>
              </button>
            </div>
          </form>

          {/* Galeria Offline de Waypoints */}
          <div className="space-y-2.5 pt-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Galeria Offline de Waypoints ({savedWaypoints.length})
            </h3>

            {savedWaypoints.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-800 p-6 text-center text-xs sm:text-sm text-slate-500">
                Nenhum waypoint registrado ainda. Crie pontos acima para salvar coordenadas, foto
                comprimida e condições meteorológicas no IndexedDB.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {savedWaypoints.map((wp) => (
                  <article
                    key={wp.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3.5 flex gap-3.5 justify-between"
                  >
                    <div className="flex gap-3 min-w-0">
                      {wp.photoDataUrl && (
                        <img
                          src={wp.photoDataUrl}
                          alt={wp.name}
                          className="w-16 h-16 rounded-lg object-cover border border-slate-300 dark:border-slate-700 shrink-0"
                        />
                      )}
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {wp.name}
                          </h4>
                          <span className="text-[11px] font-mono text-slate-500">
                            {wp.timestampUtcIso.slice(0, 16).replace('T', ' ')} UTC
                          </span>
                        </div>
                        <div className="text-xs font-mono text-slate-600 dark:text-slate-400">
                          {wp.latitude.toFixed(5)}, {wp.longitude.toFixed(5)}
                          {wp.photoSizeKb ? ` • Foto ${wp.photoSizeKb.toFixed(0)} KB` : ''}
                        </div>
                        {wp.note && (
                          <p className="text-xs text-slate-700 dark:text-slate-300 break-words">
                            {wp.note}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                          {wp.conditions.windSpeed10mKmh !== null && (
                            <span className="px-2 py-0.5 rounded bg-sky-500/10 text-sky-700 dark:text-sky-300">
                              Vento {wp.conditions.windSpeed10mKmh.toFixed(1)} km/h
                            </span>
                          )}
                          {wp.conditions.waveHeightM !== null && (
                            <span className="px-2 py-0.5 rounded bg-teal-500/10 text-teal-700 dark:text-teal-300">
                              Onda {wp.conditions.waveHeightM.toFixed(2)} m
                            </span>
                          )}
                          {wp.conditions.temperature2mC !== null && (
                            <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800">
                              {wp.conditions.temperature2mC.toFixed(1)}°C
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteWaypoint(wp.id, wp.name)}
                      aria-label={`Excluir waypoint ${wp.name}`}
                      className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 inline-flex items-center justify-center shrink-0 self-start"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </ModuleErrorBoundary>

      {/* 4. Central de Exportação & Compartilhamento (Zero Servidor) */}
      <ModuleErrorBoundary
        moduleName="Central de Exportação & Compartilhamento"
        onErrorLog={onErrorLog}
      >
        <section
          aria-label="Central de Exportação e Compartilhamento"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                <Share2 className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base md:text-lg font-bold text-slate-900 dark:text-white">
                  Central de Exportação &amp; Compartilhamento
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  CSV (UTF-8 BOM), JSON, GPX 1.1, GeoJSON (RFC 7946) e Boletim WhatsApp
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleShareWhatsApp}
              className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors"
            >
              <MessageSquareShare className="w-4 h-4" aria-hidden="true" />
              <span>Compartilhar Boletim via WhatsApp</span>
            </button>
          </div>

          {/* Seletor de Escopo de Dados */}
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'mission_bundle', label: 'Missão Completa (Tudo)' },
                { id: 'forecast', label: 'Previsão Horária (168h)' },
                { id: 'waypoints', label: `Waypoints (${savedWaypoints.length})` },
                { id: 'tracks', label: `Rotas GPS (${savedTracks.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedDataset(tab.id)}
                className={`min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors ${
                  selectedDataset === tab.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Grade de Formatos: CSV (BOM UTF-8), JSON, GPX e GeoJSON */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={() => handleExportFormat(selectedDataset, 'csv')}
              className="min-h-[44px] min-w-[44px] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-indigo-500/50 flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-5 h-5 text-emerald-500 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    Exportar CSV
                  </div>
                  <div className="text-[11px] text-slate-500">Excel / BOM UTF-8 (\uFEFF)</div>
                </div>
              </div>
              <Download className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => handleExportFormat(selectedDataset, 'json')}
              className="min-h-[44px] min-w-[44px] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-indigo-500/50 flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <FileCode className="w-5 h-5 text-amber-500 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    Exportar JSON
                  </div>
                  <div className="text-[11px] text-slate-500">Estrutura Completa</div>
                </div>
              </div>
              <Download className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => handleExportFormat(selectedDataset, 'gpx')}
              className="min-h-[44px] min-w-[44px] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-indigo-500/50 flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <CompassIcon className="w-5 h-5 text-sky-500 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    Exportar GPX
                  </div>
                  <div className="text-[11px] text-slate-500">Garmin / OpenCPN / Navionics</div>
                </div>
              </div>
              <Download className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => handleExportFormat(selectedDataset, 'geojson')}
              className="min-h-[44px] min-w-[44px] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-indigo-500/50 flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <FileText className="w-5 h-5 text-indigo-500 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    Exportar GeoJSON
                  </div>
                  <div className="text-[11px] text-slate-500">QGIS / SIG (RFC 7946)</div>
                </div>
              </div>
              <Download className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 pt-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>
              Operação 100% local e offline. No Android nativo aciona o menu Capacitor Share; no
              Desktop realiza download imediato do arquivo.
            </span>
          </div>
        </section>
      </ModuleErrorBoundary>
    </div>
  );
};
