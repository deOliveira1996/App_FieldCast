import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Anchor,
  BookOpen,
  CheckCircle2,
  Clock,
  Cloud,
  Compass,
  Eye,
  FileDown,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Gauge,
  Map as MapIcon,
  Navigation,
  Pencil,
  Plane,
  RefreshCw,
  Route,
  Share2,
  ShieldAlert,
  Sparkles,
  Table2,
  Trash2,
  Undo2,
  Upload,
  Waves,
  Wind,
  Zap,
} from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { useUnits } from '../../context/UnitsContext';
import { getTrackSessions } from '../../db/database';
import {
  buildFallbackKpDataset,
  classifyKpScale,
  fetchNoaaKpIndex,
  loadCachedKpDataset,
  loadManualKpOverride,
  type KpIndexDataset,
} from '../../services/kpIndexService';
import {
  exportAndDeliverFile,
  shareDeliveredPayload,
  type ExportDeliveryResult,
} from '../../services/platform/ShareService';
import {
  fetch4DRouteForecast,
  formatRouteBriefingCsv,
  formatRouteBriefingHtml,
  formatRouteBriefingMarkdown,
  generateRouteBriefingDocxBytes,
  generateRouteBriefingPdfBytes,
  ROUTE_AERIAL_DISCLAIMER_EN,
  ROUTE_AERIAL_DISCLAIMER_PT,
  ROUTE_DHN_DISCLAIMER_EN,
  ROUTE_DHN_DISCLAIMER_PT,
  type RouteForecast4DResult,
  type RouteMissionCategory,
} from '../../services/routeForecastService';
import type { ExportFormat, TrackSession } from '../../types/field';
import type { RoutePlanningTabProps } from '../../types/v4';
import { formatCardinalDirection } from '../../utils/exporters';
import {
  buildCheckpointsFromPoints,
  parseRouteFileContent,
  type ImportedRoutePoint,
} from '../../utils/routeImporter';
import { safeAction } from '../../utils/safeAction';
import {
  convertWaveHeight,
  convertWindSpeed,
  windSpeedToKmh,
} from '../../utils/units';
import { CollapsibleModule } from '../common/CollapsibleModule';
import { HelpPopover } from '../common/HelpPopover';
import { ModuleErrorBoundary } from '../common/ModuleErrorBoundary';
import { NumericInput } from '../common/NumericInput';
import { RouteMapCanvas } from './RouteMapCanvas';
import { RouteProfileChart } from './RouteProfileChart';
import {
  buildDefaultDepartureInputValue,
  buildQuickExampleRoute,
  formatAltitudeWithUnit,
  formatCompactDistance,
  formatDurationCompact,
  formatExactEtaDateTime,
  formatExactEtaHHMM,
  formatRelativeWindSummary,
  formatRouteDistance,
  formatRouteStatusLabel,
  getStatusBadgeClasses,
  parseDateTimeLocalToUnix,
  readUploadedRouteFile,
  slugifyRouteFilename,
  toDateTimeLocalInputValue,
} from './routeDisplayUtils';

const AERIAL_ALTITUDE_PRESETS_M: ReadonlyArray<10 | 50 | 80 | 120> = [10, 50, 80, 120];
const MAX_CHECKPOINTS = 18;

type RouteBriefingFormat = 'pdf' | 'docx' | 'html' | 'md' | 'csv';

interface RouteLastExportState {
  result: ExportDeliveryResult;
  data: string | Uint8Array;
  format: ExportFormat;
  title: string;
}

export const RoutePlanningTab: React.FC<RoutePlanningTabProps> = ({
  activeLocation,
  isDark = false,
  onToast,
  onErrorLog,
}) => {
  const { locale, isEn, tr } = useLocale();
  const {
    units,
    windLabel,
    formatWindValue,
    formatTempValue,
    formatWaveValue,
    formatPrecipValue,
  } = useUnits();

  // Route ingestion state
  const [routeName, setRouteName] = useState<string>('');
  const [sourceTag, setSourceTag] = useState<string>('manual');
  const [rawPoints, setRawPoints] = useState<ImportedRoutePoint[]>([]);
  const [rawPointCount, setRawPointCount] = useState<number>(0);
  const [isDrawMode, setIsDrawMode] = useState<boolean>(true);
  const [fitTrigger, setFitTrigger] = useState<number>(0);
  const [selectedCheckpointIndex, setSelectedCheckpointIndex] = useState<number | null>(null);

  // Saved field tracks state
  const [savedTracks, setSavedTracks] = useState<TrackSession[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string>('');
  const [isLoadingTracks, setIsLoadingTracks] = useState<boolean>(false);

  // Mission category & dynamic parameters
  const [category, setCategory] = useState<RouteMissionCategory>('navigation');
  const [navSpeedKmh, setNavSpeedKmh] = useState<number>(18.5); // ~10 kt
  const [aerialSpeedKmh, setAerialSpeedKmh] = useState<number>(36); // ~19.4 kt / 10 m/s
  const [aerialAltitudeM, setAerialAltitudeM] = useState<number>(80);
  const [departureInput, setDepartureInput] = useState<string>(() =>
    buildDefaultDepartureInputValue(),
  );

  // 4D forecast & error state
  const [forecastResult, setForecastResult] = useState<RouteForecast4DResult | null>(null);
  const [isComputing, setIsComputing] = useState<boolean>(false);
  const [computeError, setComputeError] = useState<string | null>(null);

  // NOAA Kp geomagnetic index for Aerial mode
  const [kpDataset, setKpDataset] = useState<KpIndexDataset>(() => {
    const cached = loadCachedKpDataset();
    return cached ?? buildFallbackKpDataset();
  });
  const hasFetchedKpRef = useRef<boolean>(false);

  // Briefing export banner state
  const [lastExport, setLastExport] = useState<RouteLastExportState | null>(null);

  // Derived checkpoints (always <= 18 checkpoints, preserving P1 and Pn)
  const checkpoints = useMemo(
    () => buildCheckpointsFromPoints(rawPoints, MAX_CHECKPOINTS),
    [rawPoints],
  );

  const totalDistanceKm = useMemo(
    () => (checkpoints.length > 0 ? checkpoints[checkpoints.length - 1]!.cumulativeDistanceKm : 0),
    [checkpoints],
  );

  const activeSpeedKmh = category === 'navigation' ? navSpeedKmh : aerialSpeedKmh;

  const estimatedDurationHours = useMemo(() => {
    if (totalDistanceKm <= 0 || activeSpeedKmh <= 0) return 0;
    return totalDistanceKm / activeSpeedKmh;
  }, [activeSpeedKmh, totalDistanceKm]);

  const displayedSpeed = useMemo(() => {
    const converted = convertWindSpeed(activeSpeedKmh, units.wind);
    return converted !== null ? Number(converted.toFixed(1)) : activeSpeedKmh;
  }, [activeSpeedKmh, units.wind]);

  const speedMinDisplay = useMemo(
    () => Number((convertWindSpeed(1, units.wind) ?? 1).toFixed(1)),
    [units.wind],
  );
  const speedMaxDisplay = useMemo(
    () => Number((convertWindSpeed(300, units.wind) ?? 300).toFixed(0)),
    [units.wind],
  );

  const effectiveKp = useMemo(() => {
    const manual = loadManualKpOverride();
    if (manual.enabled) {
      return {
        kp: manual.kpValue,
        classification: classifyKpScale(manual.kpValue),
        isManual: true,
      };
    }
    return {
      kp: kpDataset.currentKp,
      classification: kpDataset.classification,
      isManual: false,
    };
  }, [kpDataset]);

  // Load saved GPS TrackSessions from Dexie on mount
  const loadSavedTracksList = useCallback(async () => {
    setIsLoadingTracks(true);
    try {
      const tracks = await getTrackSessions();
      const usable = tracks.filter((t) => Array.isArray(t.points) && t.points.length >= 2);
      setSavedTracks(usable);
      if (usable.length > 0) {
        setSelectedTrackId((prev) =>
          prev && usable.some((u) => u.id === prev) ? prev : usable[0]!.id,
        );
      } else {
        setSelectedTrackId('');
      }
    } catch {
      setSavedTracks([]);
    } finally {
      setIsLoadingTracks(false);
    }
  }, []);

  useEffect(() => {
    void loadSavedTracksList();
  }, [loadSavedTracksList]);

  // Fetch NOAA Kp non-blockingly when Aerial mode is active
  useEffect(() => {
    if (category !== 'aerial' || hasFetchedKpRef.current) {
      return;
    }
    hasFetchedKpRef.current = true;
    let cancelled = false;
    void fetchNoaaKpIndex()
      .then((dataset) => {
        if (!cancelled) {
          setKpDataset(dataset);
        }
      })
      .catch(() => {
        // Fallback silencioso já carregado
      });
    return () => {
      cancelled = true;
    };
  }, [category]);

  // Ingestion Path 1: File upload (.gpx, .kml, .kmz, .geojson, .json, .csv)
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    void safeAction(
      async () => {
        const content = await readUploadedRouteFile(file);
        const parsed = await parseRouteFileContent(file.name, content);
        const built = buildCheckpointsFromPoints(parsed.points, MAX_CHECKPOINTS);

        setRouteName(parsed.name);
        setSourceTag(parsed.format.toUpperCase());
        setRawPoints(parsed.points);
        setRawPointCount(parsed.rawPointCount);
        setForecastResult(null);
        setComputeError(null);
        setLastExport(null);
        setSelectedCheckpointIndex(null);
        setIsDrawMode(false);
        setFitTrigger((c) => c + 1);

        if (built.length < 2) {
          onToast?.({
            type: 'warning',
            title: tr('Rota importada com menos de 2 pontos', 'Route imported with fewer than 2 points'),
            message: tr(
              'Adicione mais pontos no mapa para calcular a previsão 4D.',
              'Add more points on the map to compute the 4D forecast.',
            ),
          });
        } else {
          onToast?.({
            type: 'success',
            title: tr('Rota importada com sucesso', 'Route imported successfully'),
            message: tr(
              `${parsed.name}: ${parsed.rawPointCount} pts → ${built.length} checkpoints (${formatRouteDistance(parsed.totalDistanceKm, category, units.wind)}).`,
              `${parsed.name}: ${parsed.rawPointCount} pts → ${built.length} checkpoints (${formatRouteDistance(parsed.totalDistanceKm, category, units.wind)}).`,
            ),
          });
        }
      },
      {
        actionKey: 'import_route_file',
        moduleName: 'RoutePlanningTab',
        errorTitle: tr('Erro ao importar arquivo de rota', 'Failed to import route file'),
        onToast,
        onErrorLog,
      },
    );
  };

  // Ingestion Path 2: Manual map click builder
  const handleAddMapPoint = useCallback(
    (lat: number, lon: number) => {
      setRawPoints((prev) => {
        const nextIdx = prev.length + 1;
        const next: ImportedRoutePoint[] = [
          ...prev,
          { latitude: lat, longitude: lon, name: `P${nextIdx}` },
        ];
        setRawPointCount(next.length);
        return next;
      });
      setSourceTag('MANUAL');
      setForecastResult(null);
      setComputeError(null);
      setLastExport(null);
    },
    [],
  );

  const handleUndoPoint = (): void => {
    setRawPoints((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      setRawPointCount(next.length);
      return next;
    });
    setForecastResult(null);
    setComputeError(null);
    setLastExport(null);
    setSelectedCheckpointIndex(null);
  };

  const handleClearRoute = (): void => {
    setRawPoints([]);
    setRawPointCount(0);
    setRouteName('');
    setSourceTag('manual');
    setForecastResult(null);
    setComputeError(null);
    setLastExport(null);
    setSelectedCheckpointIndex(null);
    setIsDrawMode(true);
  };

  const handleLoadQuickExample = (): void => {
    const example = buildQuickExampleRoute(activeLocation, category, isEn);
    setRouteName(example.name);
    setSourceTag(isEn ? 'EXAMPLE' : 'EXEMPLO');
    setRawPoints(example.points);
    setRawPointCount(example.points.length);
    setForecastResult(null);
    setComputeError(null);
    setLastExport(null);
    setSelectedCheckpointIndex(null);
    setIsDrawMode(false);
    setFitTrigger((c) => c + 1);

    onToast?.({
      type: 'info',
      title: tr('Rota de exemplo carregada', 'Example route loaded'),
      message: tr(
        `5 checkpoints criados em ${activeLocation.name}. Toque em "Calcular Previsão 4D da Rota".`,
        `5 checkpoints created around ${activeLocation.name}. Tap "Compute 4D Route Forecast".`,
      ),
    });
  };

  // Ingestion Path 3: Load saved GPS TrackSession from Dexie
  const handleLoadSavedTrack = (): void => {
    const chosen = savedTracks.find((t) => t.id === selectedTrackId);
    if (!chosen || chosen.points.length < 2) {
      onToast?.({
        type: 'warning',
        title: tr('Nenhuma trilha válida selecionada', 'No valid track selected'),
        message: tr(
          'Grave uma trilha GPS no módulo Campo com pelo menos 2 pontos.',
          'Record a GPS track in the Field module with at least 2 points.',
        ),
      });
      return;
    }

    // Estritamente latitude/longitude (altitude sempre via Open-Meteo DEM, nunca GPS)
    const importedPts: ImportedRoutePoint[] = chosen.points.map((pt) => ({
      latitude: pt.latitude,
      longitude: pt.longitude,
    }));
    const built = buildCheckpointsFromPoints(importedPts, MAX_CHECKPOINTS);

    setRouteName(chosen.name || tr('Trilha de Campo', 'Field Track'));
    setSourceTag('TRACK GPS');
    setRawPoints(importedPts);
    setRawPointCount(importedPts.length);
    setForecastResult(null);
    setComputeError(null);
    setLastExport(null);
    setSelectedCheckpointIndex(null);
    setIsDrawMode(false);
    setFitTrigger((c) => c + 1);

    onToast?.({
      type: 'success',
      title: tr('Trilha de campo carregada', 'Field track loaded'),
      message: tr(
        `${chosen.name}: ${importedPts.length} pts → ${built.length} checkpoints.`,
        `${chosen.name}: ${importedPts.length} pts → ${built.length} checkpoints.`,
      ),
    });
  };

  const handleSpeedCommit = (committedDisplay: number | null): void => {
    if (committedDisplay === null || !Number.isFinite(committedDisplay)) return;
    const kmh = Math.max(1, Math.min(300, windSpeedToKmh(committedDisplay, units.wind)));
    if (category === 'navigation') {
      setNavSpeedKmh(Number(kmh.toFixed(2)));
    } else {
      setAerialSpeedKmh(Number(kmh.toFixed(2)));
    }
  };

  const handleSelectQuickDeparture = (preset: 'now' | 'plus3h' | 'plus6h' | 'tomorrow07'): void => {
    const d = new Date();
    if (preset === 'now') {
      d.setSeconds(0, 0);
    } else if (preset === 'plus3h') {
      d.setHours(d.getHours() + 3, 0, 0, 0);
    } else if (preset === 'plus6h') {
      d.setHours(d.getHours() + 6, 0, 0, 0);
    } else {
      d.setDate(d.getDate() + 1);
      d.setHours(7, 0, 0, 0);
    }
    setDepartureInput(toDateTimeLocalInputValue(d));
  };

  // Compute 4D Route Forecast
  const handleCompute4D = (): void => {
    if (checkpoints.length < 2) {
      const msg = tr(
        'Adicione pelo menos 2 checkpoints (importe um arquivo, desenhe no mapa ou clique em "Exemplo Rápido").',
        'Add at least 2 checkpoints (import a file, draw on the map, or tap "Quick Example").',
      );
      setComputeError(msg);
      onToast?.({
        type: 'warning',
        title: tr('Rota incompleta', 'Incomplete route'),
        message: msg,
      });
      return;
    }

    setComputeError(null);

    void safeAction(
      async () => {
        const departureUnix = parseDateTimeLocalToUnix(departureInput);
        const effectiveName =
          routeName.trim() ||
          (category === 'navigation'
            ? tr(`Rota Náutica — ${activeLocation.name}`, `Marine Route — ${activeLocation.name}`)
            : tr(`Rota Aérea — ${activeLocation.name}`, `Aerial Route — ${activeLocation.name}`));

        const result = await fetch4DRouteForecast({
          routeName: effectiveName,
          category,
          checkpoints,
          departureUnix,
          avgSpeedKmh: activeSpeedKmh,
          altitudeM: category === 'aerial' ? aerialAltitudeM : 10,
        });

        setForecastResult(result);
        setLastExport(null);
        setIsDrawMode(false);
        setSelectedCheckpointIndex(result.worstCheckpointIndex);
        setFitTrigger((c) => c + 1);

        onToast?.({
          type: result.overallStatus === 'red' ? 'warning' : 'success',
          title: tr('Previsão 4D da rota concluída', '4D route forecast ready'),
          message: tr(
            `${result.checkpoints.length} checkpoints analisados • Status: ${formatRouteStatusLabel(result.overallStatus, false)}.`,
            `${result.checkpoints.length} checkpoints analyzed • Status: ${formatRouteStatusLabel(result.overallStatus, true)}.`,
          ),
        });
      },
      {
        actionKey: 'compute_route_4d_forecast',
        moduleName: 'RoutePlanningTab',
        errorTitle: tr(
          'Não foi possível calcular a previsão 4D da rota',
          'Failed to compute 4D route forecast',
        ),
        onLoadingChange: setIsComputing,
        onError: (err) => {
          setComputeError(
            tr(
              `Falha ao consultar Open-Meteo (verifique conexão ou tente novamente): ${err.message}`,
              `Failed to query Open-Meteo (check connectivity or retry): ${err.message}`,
            ),
          );
        },
        onToast,
        onErrorLog,
      },
    );
  };

  // Export 4D Briefing in 5 formats
  const handleExportBriefing = (format: RouteBriefingFormat): void => {
    if (!forecastResult) return;

    void safeAction(
      async () => {
        const slug = slugifyRouteFilename(forecastResult.routeName);
        const dateTag = forecastResult.departureIso.slice(0, 10);
        const base = `fieldcast-rota-4d-${slug}-${dateTag}`;
        const title = `FieldCast 4D — ${forecastResult.routeName} (${format.toUpperCase()})`;

        let filename: string;
        let content: string | Uint8Array;

        if (format === 'pdf') {
          filename = `${base}.pdf`;
          content = generateRouteBriefingPdfBytes(forecastResult, locale);
        } else if (format === 'docx') {
          filename = `${base}.docx`;
          content = generateRouteBriefingDocxBytes(forecastResult, locale);
        } else if (format === 'html') {
          filename = `${base}.html`;
          content = formatRouteBriefingHtml(forecastResult, locale);
        } else if (format === 'md') {
          filename = `${base}.md`;
          content = formatRouteBriefingMarkdown(forecastResult, locale);
        } else {
          filename = `${base}.csv`;
          content = formatRouteBriefingCsv(forecastResult);
        }

        const delivered = await exportAndDeliverFile({
          filename,
          content,
          format,
          title,
          text: tr(
            `Briefing Meteorológico de Rota 4D (${format.toUpperCase()}) — ${forecastResult.routeName}`,
            `4D Route Weather Briefing (${format.toUpperCase()}) — ${forecastResult.routeName}`,
          ),
          preferNativeShare: false,
        });

        setLastExport({
          result: delivered,
          data: content,
          format,
          title,
        });

        onToast?.({
          type: 'success',
          title: tr(`Briefing 4D salvo (${format.toUpperCase()})`, `4D Briefing saved (${format.toUpperCase()})`),
          message: tr(
            `Salvo em ${delivered.savedPathDisplay} (${(delivered.byteLength / 1024).toFixed(1)} KB).`,
            `Saved to ${delivered.savedPathDisplay} (${(delivered.byteLength / 1024).toFixed(1)} KB).`,
          ),
        });
      },
      {
        actionKey: `export_route_4d_${format}`,
        moduleName: 'RoutePlanningTab',
        errorTitle: tr(
          `Erro ao exportar briefing (${format.toUpperCase()})`,
          `Failed to export briefing (${format.toUpperCase()})`,
        ),
        onToast,
        onErrorLog,
      },
    );
  };

  const handleShareLastExport = (): void => {
    if (!lastExport) return;

    void safeAction(
      async () => {
        const shared = await shareDeliveredPayload({
          filename: lastExport.result.filename,
          format: lastExport.format,
          data: lastExport.data,
          title: lastExport.title,
          uri: lastExport.result.uri,
        });

        onToast?.({
          type: shared ? 'success' : 'info',
          title: shared
            ? tr('Folha de compartilhamento aberta', 'Share sheet opened')
            : tr('Arquivo salvo localmente', 'File downloaded locally'),
          message: lastExport.result.savedPathDisplay,
        });
      },
      {
        actionKey: 'share_route_4d_briefing',
        moduleName: 'RoutePlanningTab',
        errorTitle: tr('Erro ao compartilhar briefing 4D', 'Failed to share 4D briefing'),
        onToast,
        onErrorLog,
      },
    );
  };

  // Summary metrics derived from forecastResult
  const summaryStats = useMemo(() => {
    if (!forecastResult) return null;
    const cps = forecastResult.checkpoints;

    let maxWindKmh: number | null = null;
    let maxGustKmh: number | null = null;
    let maxWaveM: number | null = null;
    let maxTideMslM: number | null = null;
    let minTideMslM: number | null = null;
    let maxRainProb: number | null = null;
    let minVisKm: number | null = null;
    let maxShear: number | null = null;
    let maxCape: number | null = null;
    let maxLowCloud: number | null = null;
    let headwindCount = 0;
    let crosswindCount = 0;
    let tailwindCount = 0;

    for (const cp of cps) {
      if (cp.operationalWindKmh !== null) {
        maxWindKmh = maxWindKmh === null ? cp.operationalWindKmh : Math.max(maxWindKmh, cp.operationalWindKmh);
      }
      if (cp.windGusts10mKmh !== null) {
        maxGustKmh = maxGustKmh === null ? cp.windGusts10mKmh : Math.max(maxGustKmh, cp.windGusts10mKmh);
      }
      if (cp.waveHeightM !== null) {
        maxWaveM = maxWaveM === null ? cp.waveHeightM : Math.max(maxWaveM, cp.waveHeightM);
      }
      if (cp.seaLevelHeightMslM !== null) {
        maxTideMslM = maxTideMslM === null ? cp.seaLevelHeightMslM : Math.max(maxTideMslM, cp.seaLevelHeightMslM);
        minTideMslM = minTideMslM === null ? cp.seaLevelHeightMslM : Math.min(minTideMslM, cp.seaLevelHeightMslM);
      }
      if (cp.precipitationProbabilityPct !== null) {
        maxRainProb =
          maxRainProb === null
            ? cp.precipitationProbabilityPct
            : Math.max(maxRainProb, cp.precipitationProbabilityPct);
      }
      if (cp.visibilityM !== null) {
        const km = cp.visibilityM / 1000;
        minVisKm = minVisKm === null ? km : Math.min(minVisKm, km);
      }
      if (cp.windShearKtPer100ft !== null) {
        maxShear = maxShear === null ? cp.windShearKtPer100ft : Math.max(maxShear, cp.windShearKtPer100ft);
      }
      if (cp.capeJkg !== null) {
        maxCape = maxCape === null ? cp.capeJkg : Math.max(maxCape, cp.capeJkg);
      }
      if (cp.cloudCoverLowPct !== null) {
        maxLowCloud = maxLowCloud === null ? cp.cloudCoverLowPct : Math.max(maxLowCloud, cp.cloudCoverLowPct);
      }
      if (cp.relativeWind?.classification === 'headwind') headwindCount += 1;
      else if (cp.relativeWind?.classification === 'crosswind') crosswindCount += 1;
      else if (cp.relativeWind?.classification === 'tailwind') tailwindCount += 1;
    }

    const dominantRelWind =
      headwindCount >= crosswindCount && headwindCount >= tailwindCount && headwindCount > 0
        ? tr('Predomínio de Proa', 'Mostly Headwind')
        : tailwindCount >= crosswindCount && tailwindCount > 0
          ? tr('Predomínio de Popa', 'Mostly Tailwind')
          : crosswindCount > 0
            ? tr('Predomínio de Través', 'Mostly Crosswind')
            : '—';

    return {
      maxWindKmh,
      maxGustKmh,
      maxWaveM,
      maxTideMslM,
      minTideMslM,
      maxRainProb,
      minVisKm,
      maxShear,
      maxCape,
      maxLowCloud,
      dominantRelWind,
      worstCheckpoint: cps[forecastResult.worstCheckpointIndex] ?? cps[0] ?? null,
    };
  }, [forecastResult, tr]);

  const activeModeForDisplay = forecastResult?.category ?? category;
  const overallStyle = forecastResult ? getStatusBadgeClasses(forecastResult.overallStatus) : null;

  return (
    <section
      data-testid="route-planning-tab"
      aria-label={tr('Planejamento de Rotas 4D', '4D Route Planning')}
      className="space-y-4"
    >
      {/* Cabeçalho Principal */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-[#0080cd]/15 text-[#0080cd] dark:text-sky-300 shrink-0">
              <Route className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                  {tr('Planejamento de Rotas 4D', '4D Spatio-Temporal Route Planning')}
                </h2>
                <HelpPopover topic="route_planning_4d" align="left" />
              </div>
              <p className="text-xs text-slate-600 dark:text-sky-200/80 mt-0.5">
                {tr(
                  'Previsão meteorológica e oceanográfica ponto a ponto no horário exato de chegada (ETA) para rotas náuticas e aéreas.',
                  'Point-by-point weather and marine forecast matched to exact arrival time (ETA) for marine and aerial routes.',
                )}
              </p>
            </div>
          </div>

          {/* Resumo compacto da rota ativa */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-[#0f243d] border border-slate-200 dark:border-sky-800 font-semibold text-slate-700 dark:text-sky-200">
              {checkpoints.length} / {MAX_CHECKPOINTS} {tr('checkpoints', 'checkpoints')}
            </span>
            {totalDistanceKm > 0 && (
              <span className="px-2.5 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 font-bold text-[#0080cd] dark:text-sky-300">
                {formatRouteDistance(totalDistanceKm, category, units.wind)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 1. Ingestão de Rota (3 Caminhos) */}
      <CollapsibleModule
        testId="route-ingestion-module"
        storageKey="fieldcast_planner_ingestion_open_v43"
        defaultOpen={true}
        keepMounted={true}
        icon={<Upload className="w-4 h-4 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />}
        title={tr('1. Entrada de Rota (Arquivo, Mapa ou Trilha Salva)', '1. Route Input (File, Map, or Saved Track)')}
        subtitle={
          checkpoints.length > 0
            ? tr(
                `${routeName || 'Rota ativa'} • ${rawPointCount} pts → ${checkpoints.length} checkpoints (${formatRouteDistance(totalDistanceKm, category, units.wind)})`,
                `${routeName || 'Active route'} • ${rawPointCount} pts → ${checkpoints.length} checkpoints (${formatRouteDistance(totalDistanceKm, category, units.wind)})`,
              )
            : tr(
                'Importe GPX/KML/KMZ/GeoJSON/CSV, clique no mapa ou carregue uma trilha gravada em Campo.',
                'Import GPX/KML/KMZ/GeoJSON/CSV, click on the map, or load a recorded Field track.',
              )
        }
      >
        <div className="space-y-4">
          {/* Grade de 3 caminhos de ingestão */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Caminho A: Upload de Arquivo */}
            <div className="rounded-xl border border-slate-200 dark:border-sky-800/70 bg-slate-50/70 dark:bg-[#0f243d] p-3 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-white">
                <Upload className="w-4 h-4 text-[#0080cd]" aria-hidden="true" />
                <span>{tr('Importar Arquivo de Rota', 'Import Route File')}</span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                {tr(
                  'Suporta GPX, KML, KMZ, GeoJSON, JSON e CSV (reamostragem automática até 18 checkpoints).',
                  'Supports GPX, KML, KMZ, GeoJSON, JSON, and CSV (auto-resampled up to 18 checkpoints).',
                )}
              </p>
              <label className="min-h-[44px] w-full px-3.5 py-2 rounded-xl bg-[#0080cd] hover:bg-[#0369a1] text-white text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer shadow-sm transition-colors">
                <Upload className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{tr('Selecionar GPX / KML / KMZ / CSV', 'Select GPX / KML / KMZ / CSV')}</span>
                <input
                  type="file"
                  data-testid="route-file-input"
                  accept=".gpx,.kml,.kmz,.geojson,.json,.csv"
                  onChange={handleFileUpload}
                  className="sr-only"
                />
              </label>
            </div>

            {/* Caminho B: Construtor Manual no Mapa + Exemplo Rápido */}
            <div className="rounded-xl border border-slate-200 dark:border-sky-800/70 bg-slate-50/70 dark:bg-[#0f243d] p-3 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-white">
                <Pencil className="w-4 h-4 text-[#0080cd]" aria-hidden="true" />
                <span>{tr('Desenhar no Mapa / Exemplo', 'Map Builder / Example')}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="route-draw-mode-btn"
                  aria-pressed={isDrawMode}
                  onClick={() => setIsDrawMode((prev) => !prev)}
                  className={`min-h-[44px] px-2.5 py-1.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 border transition-colors ${
                    isDrawMode
                      ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-sky-700 hover:bg-sky-50 dark:hover:bg-sky-900/40'
                  }`}
                >
                  <Pencil className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{tr('Modo Desenhar Rota', 'Draw Route Mode')}</span>
                </button>

                <button
                  type="button"
                  data-testid="route-quick-example-btn"
                  onClick={handleLoadQuickExample}
                  className="min-h-[44px] px-2.5 py-1.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{tr('Exemplo Rápido', 'Quick Example')}</span>
                </button>

                <button
                  type="button"
                  data-testid="route-undo-point-btn"
                  disabled={rawPoints.length === 0}
                  onClick={handleUndoPoint}
                  className="min-h-[44px] px-2.5 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 border border-slate-300 dark:border-sky-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-sky-900/40 disabled:opacity-45 text-slate-700 dark:text-slate-200 transition-colors"
                >
                  <Undo2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{tr('Desfazer Último Ponto', 'Undo Last Point')}</span>
                </button>

                <button
                  type="button"
                  data-testid="route-clear-btn"
                  disabled={rawPoints.length === 0 && !forecastResult}
                  onClick={handleClearRoute}
                  className="min-h-[44px] px-2.5 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-45 text-rose-700 dark:text-rose-300 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{tr('Limpar Rota', 'Clear Route')}</span>
                </button>
              </div>
            </div>

            {/* Caminho C: Carregar Trilha GPS Salva no Campo */}
            <div className="rounded-xl border border-slate-200 dark:border-sky-800/70 bg-slate-50/70 dark:bg-[#0f243d] p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-white">
                  <FolderOpen className="w-4 h-4 text-[#0080cd]" aria-hidden="true" />
                  <span>{tr('Trilhas GPS Salvas (Campo)', 'Saved GPS Tracks (Field)')}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void loadSavedTracksList()}
                  aria-label={tr('Atualizar trilhas salvas', 'Refresh saved tracks')}
                  className="min-h-[44px] min-w-[44px] p-2 rounded-xl text-slate-500 hover:text-[#0080cd] hover:bg-white dark:hover:bg-slate-800 transition-colors inline-flex items-center justify-center"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingTracks ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {savedTracks.length > 0 ? (
                <div className="space-y-2">
                  <select
                    data-testid="route-saved-track-select"
                    value={selectedTrackId}
                    onChange={(e) => setSelectedTrackId(e.target.value)}
                    aria-label={tr('Selecionar trilha GPS salva', 'Select saved GPS track')}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-sky-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0080cd]/40"
                  >
                    {savedTracks.map((trk) => (
                      <option key={trk.id} value={trk.id}>
                        {trk.name} ({trk.points.length} pts · {trk.totalDistanceKm.toFixed(1)} km)
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    data-testid="route-load-track-btn"
                    onClick={handleLoadSavedTrack}
                    className="min-h-[44px] w-full px-3 py-2 rounded-xl border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-sky-900 dark:text-sky-200 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <FolderOpen className="w-4 h-4" aria-hidden="true" />
                    <span>{tr('Carregar Trilha na Rota', 'Load Track into Route')}</span>
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 py-2">
                  {tr(
                    'Nenhuma trilha GPS gravada ainda. Grave no módulo "Campo" ou use um arquivo GPX/KML/CSV.',
                    'No recorded GPS tracks yet. Record in "Field" or import a GPX/KML/CSV file.',
                  )}
                </p>
              )}
            </div>
          </div>

          {/* Barra de Resumo & Nome Editável da Rota */}
          <div className="rounded-xl border border-slate-200 dark:border-sky-800/70 bg-white dark:bg-slate-900/60 px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
              <label htmlFor="route-name-input" className="text-xs font-bold text-slate-700 dark:text-sky-200 shrink-0">
                {tr('Nome da Rota:', 'Route Name:')}
              </label>
              <input
                id="route-name-input"
                type="text"
                data-testid="route-name-input"
                value={routeName}
                onChange={(e) => setRouteName(e.target.value)}
                placeholder={tr(
                  `Ex.: Travessia ${activeLocation.name}`,
                  `E.g. Crossing ${activeLocation.name}`,
                )}
                className="flex-1 min-w-[180px] min-h-[44px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-sky-700 bg-slate-50 dark:bg-[#0f243d] text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0080cd]/40"
              />
            </div>

            <div
              data-testid="route-ingestion-summary"
              className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-700 dark:text-sky-200"
            >
              <span className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-sky-950/70 uppercase tracking-wide">
                {sourceTag}
              </span>
              <span>
                {rawPointCount > checkpoints.length
                  ? tr(
                      `${rawPointCount} pts → ${checkpoints.length} checkpoints`,
                      `${rawPointCount} pts → ${checkpoints.length} checkpoints`,
                    )
                  : tr(`${checkpoints.length} checkpoints`, `${checkpoints.length} checkpoints`)}
              </span>
              <span className="font-bold text-[#0080cd] dark:text-sky-300">
                {formatRouteDistance(totalDistanceKm, category, units.wind)}
              </span>
            </div>
          </div>
        </div>
      </CollapsibleModule>

      {/* 2. Categoria de Missão & Parâmetros Dinâmicos */}
      <CollapsibleModule
        testId="route-parameters-module"
        storageKey="fieldcast_planner_params_open_v43"
        defaultOpen={true}
        keepMounted={true}
        icon={<Gauge className="w-4 h-4 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />}
        title={tr('2. Categoria de Missão & Parâmetros 4D', '2. Mission Category & 4D Parameters')}
        subtitle={
          category === 'navigation'
            ? tr(
                'Navegação (0m): Vento relativo (Proa/Través/Popa), ondas Hs, corrente e maré MSL',
                'Navigation (0m): Relative wind (Head/Cross/Tail), wave Hs, current, and MSL tide',
              )
            : tr(
                `Atividades Aéreas (${formatAltitudeWithUnit(aerialAltitudeM, units.wave)} AGL): Vento em altitude, Shear, nuvens, CAPE e Kp`,
                `Aerial Activities (${formatAltitudeWithUnit(aerialAltitudeM, units.wave)} AGL): Altitude wind, Shear, clouds, CAPE & Kp`,
              )
        }
      >
        <div className="space-y-4">
          {/* Seletor de Categoria */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              data-testid="planner-mode-navigation"
              aria-pressed={category === 'navigation'}
              onClick={() => {
                setCategory('navigation');
                setForecastResult(null);
              }}
              className={`min-h-[52px] px-4 py-3 rounded-xl border text-left flex items-center gap-3 transition-all ${
                category === 'navigation'
                  ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-md'
                  : 'bg-slate-50 dark:bg-[#0f243d] text-slate-800 dark:text-slate-100 border-slate-200 dark:border-sky-800 hover:bg-sky-50 dark:hover:bg-sky-900/40'
              }`}
            >
              <Anchor className="w-5 h-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-bold">
                  {tr('Navegação (Marítima / Fluvial)', 'Navigation (Marine / River)')}
                </div>
                <div
                  className={`text-[11px] truncate ${
                    category === 'navigation' ? 'text-sky-100' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {tr(
                    'Nível 0m • Vento Relativo, Ondas, Corrente & Maré MSL',
                    '0m Sea Level • Relative Wind, Waves, Current & MSL Tide',
                  )}
                </div>
              </div>
            </button>

            <button
              type="button"
              data-testid="planner-mode-aerial"
              aria-pressed={category === 'aerial'}
              onClick={() => {
                setCategory('aerial');
                setForecastResult(null);
              }}
              className={`min-h-[52px] px-4 py-3 rounded-xl border text-left flex items-center gap-3 transition-all ${
                category === 'aerial'
                  ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-md'
                  : 'bg-slate-50 dark:bg-[#0f243d] text-slate-800 dark:text-slate-100 border-slate-200 dark:border-sky-800 hover:bg-sky-50 dark:hover:bg-sky-900/40'
              }`}
            >
              <Plane className="w-5 h-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-bold">
                  {tr('Atividades Aéreas (Drone / Parapente / Paraquedas)', 'Aerial Activities (Drone / Paragliding / Skydiving)')}
                </div>
                <div
                  className={`text-[11px] truncate ${
                    category === 'aerial' ? 'text-sky-100' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {tr(
                    '10m–1.000m AGL • Vento em Altitude, Shear, Nuvens, CAPE & Kp',
                    '10m–1,000m AGL • Altitude Wind, Shear, Clouds, CAPE & Kp',
                  )}
                </div>
              </div>
            </button>
          </div>

          {/* Parâmetros Dinâmicos */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Velocidade Média */}
            <div className="rounded-xl border border-slate-200 dark:border-sky-800/70 bg-slate-50/70 dark:bg-[#0f243d] p-3 space-y-1.5">
              <label
                htmlFor="route-speed-input"
                className="text-xs font-bold text-slate-800 dark:text-white flex items-center justify-between gap-2"
              >
                <span>
                  {category === 'navigation'
                    ? tr('Velocidade Média da Embarcação', 'Average Vessel Speed')
                    : tr('Velocidade Média de Voo', 'Average Flight Speed')}
                </span>
                <span className="text-[11px] font-mono text-[#0080cd] dark:text-sky-300">
                  {windLabel}
                </span>
              </label>
              <NumericInput
                id="route-speed-input"
                data-testid="route-speed-input"
                value={displayedSpeed}
                min={speedMinDisplay}
                max={speedMaxDisplay}
                decimals={1}
                allowEmpty={false}
                fallbackValue={displayedSpeed}
                onCommit={handleSpeedCommit}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-sky-700 bg-white dark:bg-slate-900 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0080cd]/40"
              />
              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
                <span>
                  {units.wind === 'kt'
                    ? `≈ ${activeSpeedKmh.toFixed(1)} km/h`
                    : `≈ ${(activeSpeedKmh / 1.852).toFixed(1)} kt`}
                </span>
                {estimatedDurationHours > 0 && (
                  <span className="font-semibold text-slate-700 dark:text-sky-200">
                    {tr('Duração est.:', 'Est. duration:')}{' '}
                    {formatDurationCompact(estimatedDurationHours, isEn)}
                  </span>
                )}
              </div>
            </div>

            {/* Data/Hora de Partida (ETD) */}
            <div className="rounded-xl border border-slate-200 dark:border-sky-800/70 bg-slate-50/70 dark:bg-[#0f243d] p-3 space-y-1.5">
              <label
                htmlFor="route-etd-input"
                className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5"
              >
                <Clock className="w-3.5 h-3.5 text-[#0080cd]" aria-hidden="true" />
                <span>{tr('Partida Estimada (ETD)', 'Estimated Departure (ETD)')}</span>
              </label>
              <input
                id="route-etd-input"
                data-testid="route-etd-input"
                type="datetime-local"
                value={departureInput}
                onChange={(e) => setDepartureInput(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-sky-700 bg-white dark:bg-slate-900 text-xs sm:text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0080cd]/40"
              />
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {(
                  [
                    ['now', tr('Agora', 'Now')],
                    ['plus3h', '+3h'],
                    ['plus6h', '+6h'],
                    ['tomorrow07', tr('Amanhã 07h', 'Tmrw 07h')],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleSelectQuickDeparture(key)}
                    className="min-h-[44px] min-w-[44px] px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-sky-800 text-slate-700 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-sky-900/40"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Coluna 3: Referência 0m (Navegação) OU Altitude Operacional (Aéreo) */}
            {category === 'navigation' ? (
              <div className="rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/70 dark:bg-sky-950/35 p-3 space-y-1.5 flex flex-col justify-between">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-sky-950 dark:text-sky-100 flex items-center gap-1.5">
                    <Waves className="w-4 h-4 text-[#0080cd]" aria-hidden="true" />
                    <span>{tr('Referência Superficial (0 m)', 'Surface Reference (0 m)')}</span>
                  </div>
                  <p className="text-[11px] text-sky-900/85 dark:text-sky-200/85">
                    {tr(
                      'Analisa vento 10m, rajadas, ângulo relativo à proa, ondas Hs/Tp, corrente oceânica, chuva, visibilidade e maré MSL.',
                      'Analyzes 10m wind, gusts, relative bow angle, Hs/Tp waves, ocean current, rain, visibility, and MSL tide.',
                    )}
                  </p>
                </div>
                <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                  {tr(
                    'Nota DHN: Maré MSL (~8 km) não substitui tábuas oficiais da Marinha do Brasil.',
                    'DHN Note: Estimated MSL tide (~8 km) does not replace official Brazilian Navy tide tables.',
                  )}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 dark:border-sky-800/70 bg-slate-50/70 dark:bg-[#0f243d] p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="aerial-altitude-input"
                    className="text-xs font-bold text-slate-800 dark:text-white"
                  >
                    {tr('Altitude de Voo (AGL)', 'Flight Altitude (AGL)')}
                  </label>
                  <span className="text-[11px] font-mono font-bold text-[#0080cd] dark:text-sky-300">
                    {units.wave === 'ft'
                      ? `${Math.round(convertWaveHeight(aerialAltitudeM, 'ft') ?? aerialAltitudeM * 3.28084)} ft`
                      : `${aerialAltitudeM} m`}
                  </span>
                </div>

                {/* Presets preferidos 10m / 50m / 80m / 120m */}
                <div className="grid grid-cols-4 gap-1.5">
                  {AERIAL_ALTITUDE_PRESETS_M.map((alt) => {
                    const isSelected = aerialAltitudeM === alt;
                    const ftVal = Math.round(convertWaveHeight(alt, 'ft') ?? alt * 3.28084);
                    return (
                      <button
                        key={alt}
                        type="button"
                        data-testid={`aerial-alt-preset-${alt}`}
                        aria-pressed={isSelected}
                        onClick={() => setAerialAltitudeM(alt)}
                        className={`min-h-[44px] px-1.5 py-1 rounded-xl text-xs font-bold border flex flex-col items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-sky-700 hover:bg-sky-50'
                        }`}
                      >
                        <span>{alt}m</span>
                        {units.wave === 'ft' && (
                          <span className="text-[9px] font-normal opacity-90">{ftVal}ft</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Altitude customizada (teto 1.000 m / 1 km) */}
                <div className="flex items-center gap-2">
                  <NumericInput
                    id="aerial-altitude-input"
                    data-testid="aerial-altitude-input"
                    value={aerialAltitudeM}
                    min={10}
                    max={1000}
                    decimals={0}
                    allowEmpty={false}
                    fallbackValue={100}
                    onValueChange={(_raw, parsed) => {
                      if (parsed !== null && parsed >= 10 && parsed <= 1000) {
                        setAerialAltitudeM(Math.round(parsed));
                      }
                    }}
                    onCommit={(val) => {
                      if (val !== null) {
                        setAerialAltitudeM(Math.max(10, Math.min(1000, Math.round(val))));
                      }
                    }}
                    className="w-28 min-h-[44px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-sky-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0080cd]/40"
                  />
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-tight">
                    <div>
                      {tr('Teto: 10–1.000 m (1 km)', 'Ceiling: 10–1,000 m (1 km)')}
                    </div>
                    {units.wave === 'ft' && (
                      <div className="font-semibold text-[#0080cd] dark:text-sky-300">
                        = {Math.round(convertWaveHeight(aerialAltitudeM, 'ft') ?? aerialAltitudeM * 3.28084)} ft AGL
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                  {tr(
                    'Nota DECEA/REDEMET: Apoio auxiliar; não substitui planejamento oficial de voo ou SARPAS.',
                    'DECEA/REDEMET Notice: Planning aid only; does not replace official flight briefings or SARPAS.',
                  )}
                </p>
              </div>
            )}
          </div>

          {/* Botão Principal: Calcular Previsão 4D da Rota */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-2">
              {category === 'aerial' && (
                <span
                  data-testid="route-kp-badge"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                    getStatusBadgeClasses(effectiveKp.classification.severity).pill
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    NOAA Kp {effectiveKp.kp.toFixed(1)} ({effectiveKp.classification.scale})
                  </span>
                </span>
              )}
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {tr(
                  'Consulta 100% client-side em chamada batch única Open-Meteo (altitude via DEM).',
                  '100% client-side single-batch Open-Meteo query (terrain elevation strictly via DEM).',
                )}
              </span>
            </div>

            <button
              type="button"
              data-testid="compute-route-4d-btn"
              disabled={isComputing}
              onClick={handleCompute4D}
              className="min-h-[48px] px-5 py-2.5 rounded-xl bg-[#0080cd] hover:bg-[#0369a1] disabled:opacity-60 text-white text-sm font-extrabold inline-flex items-center justify-center gap-2 shadow-md transition-colors shrink-0"
            >
              <RefreshCw
                className={`w-4 h-4 ${isComputing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>
                {isComputing
                  ? tr('Calculando Previsão 4D...', 'Computing 4D Forecast...')
                  : tr('Calcular Previsão 4D da Rota', 'Compute 4D Route Forecast')}
              </span>
            </button>
          </div>

          {/* Feedback de erro / offline */}
          {computeError && (
            <div
              role="alert"
              data-testid="route-error-banner"
              className="rounded-xl border border-rose-300 dark:border-rose-700/70 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 flex items-start gap-2.5 text-xs text-rose-900 dark:text-rose-200"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
              <span>{computeError}</span>
            </div>
          )}
        </div>
      </CollapsibleModule>

      {/* 3. Mapa Interativo & Colorido por Risco 4D (sempre visível para desenho + visualização) */}
      <CollapsibleModule
        testId="route-map-module"
        storageKey="fieldcast_planner_map_open_v43"
        defaultOpen={true}
        keepMounted={true}
        icon={<MapIcon className="w-4 h-4 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />}
        title={tr('Mapa Tático da Rota 4D', '4D Route Tactical Map')}
        subtitle={
          forecastResult
            ? tr(
                'Trechos coloridos por risco operacional (Verde / Âmbar / Vermelho) — toque nos marcadores P1..Pn para detalhes no ETA.',
                'Legs colored by operational risk (Green / Amber / Red) — tap P1..Pn markers for ETA metrics.',
              )
            : tr(
                'Ative "Modo Desenhar Rota" e toque no mapa para posicionar P1 → P2 → ... → Pn.',
                'Enable "Draw Route Mode" and tap the map to place P1 → P2 → ... → Pn.',
              )
        }
      >
        <ModuleErrorBoundary
          moduleName={tr('Mapa 4D de Rotas', '4D Route Map')}
          onErrorLog={onErrorLog}
        >
          <RouteMapCanvas
            centerLat={activeLocation.latitude}
            centerLon={activeLocation.longitude}
            checkpoints={checkpoints}
            forecastResult={forecastResult}
            category={activeModeForDisplay}
            isDrawMode={isDrawMode}
            isDark={isDark}
            selectedCheckpointIndex={selectedCheckpointIndex}
            fitTrigger={fitTrigger}
            onAddMapPoint={handleAddMapPoint}
            onSelectCheckpoint={setSelectedCheckpointIndex}
          />
        </ModuleErrorBoundary>
      </CollapsibleModule>

      {/* 4. Resultados 4D: Resumo Executivo, Avisos Obrigatórios, Gráfico, Matriz & Exportação */}
      {forecastResult && summaryStats && overallStyle && (
        <div data-testid="route-4d-results" className="space-y-4">
          {/* Card de Status Geral & KPIs da Rota */}
          <div
            className={`rounded-2xl border ${overallStyle.cardBorder} ${overallStyle.cardBg} p-4 sm:p-5 shadow-sm space-y-4`}
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    data-testid="route-overall-status-badge"
                    className={`px-3 py-1 rounded-full text-xs font-extrabold border inline-flex items-center gap-1.5 ${overallStyle.pill}`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${overallStyle.dot}`} />
                    {formatRouteStatusLabel(forecastResult.overallStatus, isEn)}
                  </span>
                  <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                    {forecastResult.routeName}
                  </h3>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-200">
                  {tr('Partida', 'Departure')}:{' '}
                  <strong>
                    {formatExactEtaDateTime(
                      forecastResult.departureUnix,
                      forecastResult.checkpoints[0]?.timezone,
                      locale,
                    )}
                  </strong>{' '}
                  → {tr('Chegada', 'Arrival')}:{' '}
                  <strong>
                    {formatExactEtaDateTime(
                      forecastResult.arrivalUnix,
                      forecastResult.checkpoints[forecastResult.checkpoints.length - 1]?.timezone,
                      locale,
                    )}
                  </strong>{' '}
                  •{' '}
                  <strong>
                    {formatRouteDistance(
                      forecastResult.totalDistanceKm,
                      forecastResult.category,
                      units.wind,
                    )}
                  </strong>{' '}
                  ({formatDurationCompact(forecastResult.estimatedDurationHours, isEn)})
                </p>
              </div>

              {summaryStats.worstCheckpoint && (
                <button
                  type="button"
                  onClick={() => setSelectedCheckpointIndex(forecastResult.worstCheckpointIndex)}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white/90 dark:bg-slate-900/80 border border-slate-200 dark:border-sky-800 text-left text-xs hover:bg-white transition-colors"
                >
                  <div className="font-bold text-slate-800 dark:text-white">
                    {tr('Trecho Crítico:', 'Critical Leg:')}{' '}
                    <span className="text-[#0080cd] dark:text-sky-300">
                      P{forecastResult.worstCheckpointIndex + 1} @{' '}
                      {formatExactEtaHHMM(
                        summaryStats.worstCheckpoint.etaUnix,
                        summaryStats.worstCheckpoint.timezone,
                      )}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate max-w-[280px]">
                    {summaryStats.worstCheckpoint.reasons[0]}
                  </div>
                </button>
              )}
            </div>

            {/* Grade de KPIs específicos por categoria */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <div className="rounded-xl bg-white/90 dark:bg-[#132a47] border border-slate-200/80 dark:border-sky-800/70 p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <Wind className="w-3.5 h-3.5 text-[#0080cd]" />
                  {forecastResult.category === 'aerial'
                    ? `${tr('Vento Máx.', 'Max Wind')} ${forecastResult.operationalAltitudeM}m`
                    : tr('Vento Máx. 10m', 'Max 10m Wind')}
                </div>
                <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">
                  {formatWindValue(summaryStats.maxWindKmh, 1)}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  {tr('Rajada máx.:', 'Max gust:')} {formatWindValue(summaryStats.maxGustKmh, 1)}
                </div>
              </div>

              <div className="rounded-xl bg-white/90 dark:bg-[#132a47] border border-slate-200/80 dark:border-sky-800/70 p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <Compass className="w-3.5 h-3.5 text-[#0080cd]" />
                  {tr('Vento Relativo', 'Relative Wind')}
                </div>
                <div className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">
                  {summaryStats.dominantRelWind}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  {tr('Ângulo à proa/rumo', 'Relative to course')}
                </div>
              </div>

              <div className="rounded-xl bg-white/90 dark:bg-[#132a47] border border-slate-200/80 dark:border-sky-800/70 p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5 text-[#0080cd]" />
                  {tr('Chuva / Visib. Mín.', 'Rain / Min Vis.')}
                </div>
                <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">
                  {summaryStats.maxRainProb !== null ? `${Math.round(summaryStats.maxRainProb)}%` : '—'}{' '}
                  · {summaryStats.minVisKm !== null ? `${summaryStats.minVisKm.toFixed(1)} km` : '—'}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  {tr('Pico prob. / menor visib.', 'Peak prob. / min vis.')}
                </div>
              </div>

              {forecastResult.category === 'navigation' ? (
                <>
                  <div className="rounded-xl bg-white/90 dark:bg-[#132a47] border border-slate-200/80 dark:border-sky-800/70 p-2.5">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <Waves className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                      {tr('Onda Máx. Hs', 'Max Wave Hs')}
                    </div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">
                      {forecastResult.marineCoveredCount > 0
                        ? formatWaveValue(summaryStats.maxWaveM, 2)
                        : tr('Continental', 'Inland')}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {tr(
                        `Grade marinha: ${forecastResult.marineCoveredCount}/${forecastResult.checkpoints.length}`,
                        `Marine grid: ${forecastResult.marineCoveredCount}/${forecastResult.checkpoints.length}`,
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl bg-white/90 dark:bg-[#132a47] border border-slate-200/80 dark:border-sky-800/70 p-2.5">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <Navigation className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                      {tr('Maré Est. MSL', 'Est. Tide MSL')}
                    </div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">
                      {summaryStats.minTideMslM !== null && summaryStats.maxTideMslM !== null
                        ? `${formatWaveValue(summaryStats.minTideMslM, 2)} → ${formatWaveValue(summaryStats.maxTideMslM, 2)}`
                        : '—'}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {tr('Grade ~8 km (ref. MSL)', '~8 km grid (MSL ref.)')}
                    </div>
                  </div>

                  <div className="rounded-xl bg-white/90 dark:bg-[#132a47] border border-slate-200/80 dark:border-sky-800/70 p-2.5">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {tr('Velocidade / Pontos', 'Speed / Points')}
                    </div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">
                      {formatWindValue(forecastResult.avgSpeedKmh, 1)}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {forecastResult.checkpoints.length} {tr('checkpoints 4D', '4D checkpoints')}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-xl bg-white/90 dark:bg-[#132a47] border border-slate-200/80 dark:border-sky-800/70 p-2.5">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {tr('Wind Shear Máx.', 'Max Wind Shear')}
                    </div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">
                      {summaryStats.maxShear !== null
                        ? `${summaryStats.maxShear.toFixed(1)} kt/100ft`
                        : '—'}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {tr('Cisalhamento vertical', 'Vertical shear')}
                    </div>
                  </div>

                  <div className="rounded-xl bg-white/90 dark:bg-[#132a47] border border-slate-200/80 dark:border-sky-800/70 p-2.5">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <Cloud className="w-3.5 h-3.5 text-sky-500" />
                      {tr('Nuvem Baixa / CAPE', 'Low Cloud / CAPE')}
                    </div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">
                      {summaryStats.maxLowCloud !== null ? `${Math.round(summaryStats.maxLowCloud)}%` : '—'}{' '}
                      · {summaryStats.maxCape !== null ? `${Math.round(summaryStats.maxCape)} J/kg` : '—'}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {tr('Teto baixo / convecção', 'Low ceiling / convection')}
                    </div>
                  </div>

                  <div className="rounded-xl bg-white/90 dark:bg-[#132a47] border border-slate-200/80 dark:border-sky-800/70 p-2.5">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5 text-amber-500" />
                      NOAA Kp
                    </div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">
                      Kp {effectiveKp.kp.toFixed(1)} ({effectiveKp.classification.scale})
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {effectiveKp.classification.label}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Avisos Operacionais Obrigatórios (DHN / Marinha do Brasil ou DECEA / REDEMET) */}
            <div
              data-testid="route-mandatory-disclaimer"
              className="rounded-xl border border-amber-300/90 dark:border-amber-700/70 bg-amber-50/95 dark:bg-amber-950/40 px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-amber-950 dark:text-amber-100"
            >
              <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1">
                {(forecastResult.category === 'navigation' || forecastResult.hasMarineTideData) && (
                  <p>{isEn ? ROUTE_DHN_DISCLAIMER_EN : ROUTE_DHN_DISCLAIMER_PT}</p>
                )}
                {forecastResult.category === 'aerial' && (
                  <p>{isEn ? ROUTE_AERIAL_DISCLAIMER_EN : ROUTE_AERIAL_DISCLAIMER_PT}</p>
                )}
              </div>
            </div>
          </div>

          {/* Gráfico de Perfil 4D (ECharts dentro de CollapsibleModule + ModuleErrorBoundary) */}
          <RouteProfileChart
            forecastResult={forecastResult}
            isDark={isDark}
            selectedCheckpointIndex={selectedCheckpointIndex}
            onSelectCheckpoint={setSelectedCheckpointIndex}
            onErrorLog={onErrorLog}
          />

          {/* Matriz de Checkpoints P1 → Pn */}
          <CollapsibleModule
            testId="route-checkpoint-matrix-module"
            storageKey="fieldcast_planner_table_open_v43"
            defaultOpen={true}
            keepMounted={true}
            icon={<Table2 className="w-4 h-4 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />}
            title={tr('Matriz 4D de Checkpoints (P1 → Pn)', '4D Checkpoint Matrix (P1 → Pn)')}
            subtitle={tr(
              'Toque em uma linha para destacar o checkpoint correspondente no mapa.',
              'Tap any row to highlight the corresponding checkpoint on the map.',
            )}
          >
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-sky-800/70">
              <table
                data-testid="route-checkpoint-table"
                className="w-full text-left border-collapse text-xs"
              >
                <thead>
                  <tr className="bg-slate-100 dark:bg-[#0f243d] text-slate-700 dark:text-sky-200 border-b border-slate-200 dark:border-sky-800">
                    <th className="py-2.5 px-3 font-bold whitespace-nowrap">{tr('Ponto', 'Point')}</th>
                    <th className="py-2.5 px-2.5 font-bold whitespace-nowrap text-right">{tr('Dist.', 'Dist.')}</th>
                    <th className="py-2.5 px-2.5 font-bold whitespace-nowrap">ETA</th>
                    <th className="py-2.5 px-2.5 font-bold whitespace-nowrap text-right">
                      {forecastResult.category === 'aerial'
                        ? `${tr('Vento', 'Wind')} ${forecastResult.operationalAltitudeM}m`
                        : tr('Vento 10m', '10m Wind')}
                    </th>
                    <th className="py-2.5 px-2.5 font-bold whitespace-nowrap text-right">
                      {tr('Rajada', 'Gust')}
                    </th>
                    <th className="py-2.5 px-2.5 font-bold whitespace-nowrap">
                      {tr('Vento Rel.', 'Rel. Wind')}
                    </th>
                    <th className="py-2.5 px-2.5 font-bold whitespace-nowrap text-right">
                      {tr('Chuva', 'Rain')}
                    </th>
                    <th className="py-2.5 px-2.5 font-bold whitespace-nowrap text-right">
                      {tr('Visib.', 'Vis.')}
                    </th>
                    {forecastResult.category === 'navigation' ? (
                      <>
                        <th className="py-2.5 px-2.5 font-bold whitespace-nowrap text-right">
                          {tr('Onda Hs / Tp', 'Wave Hs / Tp')}
                        </th>
                        <th className="py-2.5 px-2.5 font-bold whitespace-nowrap text-right">
                          {tr('Corrente', 'Current')}
                        </th>
                        <th className="py-2.5 px-2.5 font-bold whitespace-nowrap text-right">
                          {tr('Maré MSL', 'Tide MSL')}
                        </th>
                      </>
                    ) : (
                      <>
                        <th className="py-2.5 px-2.5 font-bold whitespace-nowrap text-right">Shear</th>
                        <th className="py-2.5 px-2.5 font-bold whitespace-nowrap text-right">
                          {tr('Nuv. B/M/A', 'Cld L/M/H')}
                        </th>
                        <th className="py-2.5 px-2.5 font-bold whitespace-nowrap text-right">CAPE</th>
                        <th className="py-2.5 px-2.5 font-bold whitespace-nowrap text-right">DEM</th>
                      </>
                    )}
                    <th className="py-2.5 px-3 font-bold whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-sky-900/60">
                  {forecastResult.checkpoints.map((cp, idx) => {
                    const statusStyle = getStatusBadgeClasses(cp.status);
                    const relWind = formatRelativeWindSummary(cp.relativeWind, isEn);
                    const isSelected = selectedCheckpointIndex === idx;
                    return (
                      <tr
                        key={`row-cp-${idx}`}
                        onClick={() => setSelectedCheckpointIndex(idx)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-sky-50 dark:bg-sky-900/40'
                            : 'bg-white dark:bg-[#132a47] hover:bg-slate-50 dark:hover:bg-sky-950/40'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                          <div>
                            {cp.checkpoint.label === `P${idx + 1}`
                              ? cp.checkpoint.label
                              : `P${idx + 1} · ${cp.checkpoint.label}`}
                          </div>
                          {cp.checkpoint.bearingDeg !== null && (
                            <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400">
                              {Math.round(cp.checkpoint.bearingDeg)}°{' '}
                              {formatCardinalDirection(cp.checkpoint.bearingDeg)} ·{' '}
                              {formatTempValue(cp.temperature2mC, 1)}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-200">
                          {formatCompactDistance(
                            cp.checkpoint.cumulativeDistanceKm,
                            forecastResult.category,
                            units.wind,
                          )}
                        </td>
                        <td className="py-2.5 px-2.5 font-mono whitespace-nowrap text-slate-800 dark:text-sky-200 font-semibold">
                          {formatExactEtaDateTime(cp.etaUnix, cp.timezone, locale)}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap text-slate-900 dark:text-white font-semibold">
                          {formatWindValue(cp.operationalWindKmh, 1)}{' '}
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-sans">
                            {cp.operationalWindDirDeg !== null
                              ? formatCardinalDirection(cp.operationalWindDirDeg)
                              : ''}
                          </span>
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-200">
                          {formatWindValue(cp.windGusts10mKmh, 1)}
                        </td>
                        <td className="py-2.5 px-2.5 whitespace-nowrap">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold border ${relWind.badgeClass}`}
                          >
                            {relWind.shortLabel}
                          </span>
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-200">
                          {formatPrecipValue(cp.precipitationMm, 1)}{' '}
                          <span className="text-[10px] text-slate-500 dark:text-slate-400">
                            (
                            {cp.precipitationProbabilityPct !== null
                              ? `${Math.round(cp.precipitationProbabilityPct)}%`
                              : '—'}
                            )
                          </span>
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-200">
                          {cp.visibilityM !== null ? `${(cp.visibilityM / 1000).toFixed(1)} km` : '—'}
                        </td>

                        {forecastResult.category === 'navigation' ? (
                          <>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap text-slate-800 dark:text-slate-100">
                              {cp.marineAvailable
                                ? `${formatWaveValue(cp.waveHeightM, 2)} / ${cp.wavePeriodS !== null ? `${cp.wavePeriodS.toFixed(0)}s` : '—'}`
                                : '—'}
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-200">
                              {cp.marineAvailable ? formatWindValue(cp.oceanCurrentVelocityKmh, 1) : '—'}
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-200">
                              {cp.seaLevelHeightMslM !== null
                                ? formatWaveValue(cp.seaLevelHeightMslM, 2)
                                : '—'}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap text-slate-800 dark:text-slate-100">
                              {cp.windShearKtPer100ft !== null
                                ? `${cp.windShearKtPer100ft.toFixed(1)}`
                                : '—'}
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-200">
                              {cp.cloudCoverLowPct !== null ? Math.round(cp.cloudCoverLowPct) : '—'}/
                              {cp.cloudCoverMidPct !== null ? Math.round(cp.cloudCoverMidPct) : '—'}/
                              {cp.cloudCoverHighPct !== null ? Math.round(cp.cloudCoverHighPct) : '—'}%
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-200">
                              {cp.capeJkg !== null ? `${Math.round(cp.capeJkg)}` : '—'}
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-200">
                              {formatAltitudeWithUnit(cp.elevationDemM, units.wave)}
                            </td>
                          </>
                        )}

                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusStyle.pill}`}
                            title={cp.reasons.join(' • ')}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                            {formatRouteStatusLabel(cp.status, isEn)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CollapsibleModule>

          {/* Exportar Briefing da Rota (5 Formatos via ShareService) */}
          <CollapsibleModule
            testId="route-export-module"
            storageKey="fieldcast_planner_export_open_v43"
            defaultOpen={true}
            keepMounted={true}
            icon={<FileDown className="w-4 h-4 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />}
            title={tr('Exportar Briefing 4D da Rota', 'Export 4D Route Briefing')}
            subtitle={tr(
              'Geração 100% offline/client-side com avisos obrigatórios em 5 formatos.',
              '100% offline/client-side export with mandatory disclaimers in 5 formats.',
            )}
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="export-route-pdf"
                  onClick={() => handleExportBriefing('pdf')}
                  className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-colors"
                >
                  <FileDown className="w-4 h-4" aria-hidden="true" />
                  <span>PDF</span>
                </button>

                <button
                  type="button"
                  data-testid="export-route-docx"
                  onClick={() => handleExportBriefing('docx')}
                  className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-sky-700 hover:bg-sky-600 text-white shadow-sm transition-colors"
                >
                  <FileText className="w-4 h-4" aria-hidden="true" />
                  <span>DOCX</span>
                </button>

                <button
                  type="button"
                  data-testid="export-route-html"
                  onClick={() => handleExportBriefing('html')}
                  className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition-colors"
                >
                  <FileText className="w-4 h-4" aria-hidden="true" />
                  <span>HTML5</span>
                </button>

                <button
                  type="button"
                  data-testid="export-route-md"
                  onClick={() => handleExportBriefing('md')}
                  className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border border-slate-300 dark:border-sky-700 bg-slate-50 dark:bg-[#0f243d] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-slate-800 dark:text-sky-100 transition-colors"
                >
                  <BookOpen className="w-4 h-4 text-indigo-500" aria-hidden="true" />
                  <span>Markdown</span>
                </button>

                <button
                  type="button"
                  data-testid="export-route-csv"
                  onClick={() => handleExportBriefing('csv')}
                  className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border border-slate-300 dark:border-sky-700 bg-slate-50 dark:bg-[#0f243d] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-slate-800 dark:text-sky-100 transition-colors"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                  <span>CSV</span>
                </button>
              </div>

              {/* Banner visível com caminho salvo + Compartilhar / Enviar */}
              {lastExport && (
                <div
                  role="status"
                  data-testid="route-export-saved-banner"
                  className="rounded-xl border border-emerald-300 dark:border-emerald-700/70 bg-emerald-50/90 dark:bg-emerald-950/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 text-xs text-emerald-950 dark:text-emerald-100 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-bold truncate">
                        {tr('Briefing salvo em:', 'Briefing saved to:')}{' '}
                        <span className="font-mono">{lastExport.result.savedPathDisplay}</span>
                      </div>
                      <div className="text-[11px] opacity-85">
                        {lastExport.format.toUpperCase()} •{' '}
                        {(lastExport.result.byteLength / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    data-testid="share-route-briefing-btn"
                    onClick={handleShareLastExport}
                    className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors"
                  >
                    <Share2 className="w-4 h-4" aria-hidden="true" />
                    <span>{tr('Compartilhar / Enviar', 'Share / Send')}</span>
                  </button>
                </div>
              )}
            </div>
          </CollapsibleModule>
        </div>
      )}
    </section>
  );
};

export default RoutePlanningTab;
