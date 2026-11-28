import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cloud,
  CloudRain,
  CloudSun,
  Download,
  Gauge,
  HardDrive,
  Image as ImageIcon,
  MapPin,
  Scale,
  ShieldCheck,
  Sparkles,
  Sun,
  Thermometer,
  Trash2,
  Upload,
  Wind,
  X,
} from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { useUnits } from '../../context/UnitsContext';
import {
  deleteGroundTruthObservation,
  getGroundTruthObservations,
  mergeGroundTruthObservations,
  saveGroundTruthObservation,
} from '../../db/database';
import {
  captureAndCompressPhoto,
  compressImageFile,
  exportAndDeliverFile,
  TARGET_PHOTO_MAX_KB,
  type CompressedPhotoResult,
} from '../../services/platform';
import type { ActiveCoordinates } from '../../types/field';
import type { ErrorLogRecord, ToastMessage } from '../../types/health';
import type {
  GroundTruthObservation,
  GroundTruthRainClass,
  GroundTruthRelativeRating,
  GroundTruthSkyCoverClass,
} from '../../types/v4';
import { WEATHER_MODELS, type NormalizedForecast } from '../../types/weather';
import {
  checkGroundTruthCooldown,
  computeRegionalCalibration,
  createGroundTruthObservation,
  deriveWindFeelFromRelativeRating,
  extractT0ForecastReference,
  GROUND_TRUTH_COOLDOWN_MINUTES,
  loadUseCalibratedModelPref,
  MIN_CALIBRATION_SAMPLES,
  parseAndValidateGroundTruthPackage,
  saveUseCalibratedModelPref,
  serializeGroundTruthPackage,
} from '../../utils/groundTruthCalibration';
import { formatLocalHourBadge } from '../../utils/localTimeHour';
import { MODEL_COLORS, MODEL_DISPLAY_LABELS } from '../../utils/modelComparison';
import { safeAction } from '../../utils/safeAction';
import {
  convertWindSpeed,
  temperatureToC,
  waveHeightToM,
  windSpeedToKmh,
} from '../../utils/units';
import { HelpPopover } from './HelpPopover';
import { NumericInput } from './NumericInput';

export interface GroundTruthModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeLocation: ActiveCoordinates;
  forecast: NormalizedForecast | null;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
  onCalibrationChange?: () => void;
}

const RAIN_CLASS_OPTIONS: ReadonlyArray<{
  id: GroundTruthRainClass;
  labelPt: string;
  labelEn: string;
}> = [
  { id: 'none', labelPt: 'Sem chuva', labelEn: 'No rain' },
  { id: 'light', labelPt: 'Garoa / Leve', labelEn: 'Drizzle / Light' },
  { id: 'moderate', labelPt: 'Moderada', labelEn: 'Moderate' },
  { id: 'heavy', labelPt: 'Forte', labelEn: 'Heavy' },
];

const SKY_COVER_OPTIONS: ReadonlyArray<{
  id: GroundTruthSkyCoverClass;
  labelPt: string;
  labelEn: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'clear', labelPt: 'Ensolarado', labelEn: 'Clear / Sunny', Icon: Sun },
  {
    id: 'partly_cloudy',
    labelPt: 'Parcialmente Nublado',
    labelEn: 'Partly Cloudy',
    Icon: CloudSun,
  },
  { id: 'overcast', labelPt: 'Nublado', labelEn: 'Overcast', Icon: Cloud },
];

const RELATIVE_RATING_OPTIONS: ReadonlyArray<{
  value: GroundTruthRelativeRating;
  shortPt: string;
  shortEn: string;
  tag: string;
}> = [
  { value: -2, shortPt: 'Muito abaixo', shortEn: 'Much lower', tag: '-2' },
  { value: -1, shortPt: 'Abaixo', shortEn: 'Lower', tag: '-1' },
  { value: 0, shortPt: 'Conforme previsto', shortEn: 'As forecast', tag: '0' },
  { value: 1, shortPt: 'Acima', shortEn: 'Higher', tag: '+1' },
  { value: 2, shortPt: 'Muito acima', shortEn: 'Much higher', tag: '+2' },
];

function dispatchGroundTruthUpdated(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('fieldcast:ground-truth-updated'));
  }
}

async function readTextFromFile(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Falha ao ler arquivo JSON selecionado.'));
      }
    };
    reader.onerror = () => reject(new Error('Erro de leitura do arquivo JSON.'));
    reader.readAsText(file);
  });
}

function formatRainClassShort(cls: GroundTruthRainClass, locale: 'pt' | 'en'): string {
  const item = RAIN_CLASS_OPTIONS.find((o) => o.id === cls);
  if (!item) return cls;
  return locale === 'en' ? item.labelEn : item.labelPt;
}

function formatSkyCoverShort(cls: GroundTruthSkyCoverClass, locale: 'pt' | 'en'): string {
  const item = SKY_COVER_OPTIONS.find((o) => o.id === cls);
  if (!item) return cls;
  return locale === 'en' ? item.labelEn : item.labelPt;
}

function formatRatingTag(rating: GroundTruthRelativeRating): string {
  return rating > 0 ? `+${rating}` : String(rating);
}

function estimateObservationsBytes(observations: readonly GroundTruthObservation[]): number {
  if (observations.length === 0) return 0;
  try {
    const json = JSON.stringify(observations);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(json).byteLength;
    }
    return json.length;
  } catch {
    return 0;
  }
}

function formatStorageFootprint(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0.0 KB';
  const kb = bytes / 1024;
  if (kb >= 1024) {
    return `${(kb / 1024).toFixed(2)} MB`;
  }
  return `${kb.toFixed(1)} KB`;
}

export const GroundTruthModal: React.FC<GroundTruthModalProps> = ({
  isOpen,
  onClose,
  activeLocation,
  forecast,
  onToast,
  onErrorLog,
  onCalibrationChange,
}) => {
  const { locale, tr } = useLocale();
  const {
    units,
    windLabel,
    tempLabel,
    waveLabel,
    formatTempValue,
    formatWindValue,
    formatPrecipValue,
  } = useUnits();
  const intlLocale = locale === 'en' ? 'en-US' : 'pt-BR';

  const t0Reference = useMemo(() => extractT0ForecastReference(forecast), [forecast]);

  const [observations, setObservations] = useState<GroundTruthObservation[]>([]);
  const [useCalibratedModel, setUseCalibratedModel] = useState<boolean>(() =>
    loadUseCalibratedModelPref(),
  );

  // Check-in form states (anchored to t0 reference; zero instrument required!)
  const [rainClass, setRainClass] = useState<GroundTruthRainClass>('none');
  const [skyCoverClass, setSkyCoverClass] = useState<GroundTruthSkyCoverClass>(
    () => t0Reference?.skyCoverClass ?? 'partly_cloudy',
  );
  const [tempRelativeRating, setTempRelativeRating] = useState<GroundTruthRelativeRating>(0);
  const [windRelativeRating, setWindRelativeRating] = useState<GroundTruthRelativeRating>(0);

  // Secondary / collapsed optional exact instrument inputs
  const [showInstrumentInputs, setShowInstrumentInputs] = useState<boolean>(false);
  const [measuredWindDisplay, setMeasuredWindDisplay] = useState<number | null>(null);
  const [measuredTempDisplay, setMeasuredTempDisplay] = useState<number | null>(null);
  const [measuredWaveDisplay, setMeasuredWaveDisplay] = useState<number | null>(null);
  const [note, setNote] = useState<string>('');
  const [photo, setPhoto] = useState<CompressedPhotoResult | null>(null);

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isCompressingPhoto, setIsCompressingPhoto] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [isClearingAll, setIsClearingAll] = useState<boolean>(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState<boolean>(false);

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const reloadObservations = useCallback(async () => {
    const list = await getGroundTruthObservations();
    setObservations(list);
    setUseCalibratedModel(loadUseCalibratedModelPref());
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setSkyCoverClass(t0Reference?.skyCoverClass ?? 'partly_cloudy');
    setTempRelativeRating(0);
    setWindRelativeRating(0);
    setConfirmClearOpen(false);
    void (async () => {
      const list = await getGroundTruthObservations();
      if (!cancelled) {
        setObservations(list);
        setUseCalibratedModel(loadUseCalibratedModelPref());
      }
    })();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelled = true;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, t0Reference?.skyCoverClass]);

  const calibration = useMemo(
    () =>
      computeRegionalCalibration(
        observations,
        activeLocation.latitude,
        activeLocation.longitude,
      ),
    [observations, activeLocation.latitude, activeLocation.longitude],
  );

  const cooldown = useMemo(
    () =>
      checkGroundTruthCooldown(
        observations,
        activeLocation.latitude,
        activeLocation.longitude,
      ),
    [observations, activeLocation.latitude, activeLocation.longitude],
  );

  const storageFootprintBytes = useMemo(
    () => estimateObservationsBytes(observations),
    [observations],
  );
  const storageFootprintText = useMemo(
    () => formatStorageFootprint(storageFootprintBytes),
    [storageFootprintBytes],
  );
  const photoAttachmentsCount = useMemo(
    () => observations.filter((obs) => Boolean(obs.photoDataUrl)).length,
    [observations],
  );

  if (!isOpen) {
    return null;
  }

  const progressPct = Math.min(
    100,
    Math.round((calibration.sampleCount / Math.max(1, calibration.minRequiredSamples)) * 100),
  );

  const t0HourBadge =
    t0Reference && forecast
      ? formatLocalHourBadge(t0Reference.timestampUnix, forecast.timezone)
      : tr('Agora', 'Now');

  const handleCaptureCameraPhoto = () => {
    void safeAction(
      async () => {
        const compressed = await captureAndCompressPhoto({
          targetMaxKb: TARGET_PHOTO_MAX_KB,
          source: 'camera',
        });
        setPhoto(compressed);
        onToast?.({
          type: 'success',
          title: tr('Foto anexada (opcional)', 'Photo attached (optional)'),
          message: `${compressed.sizeKb.toFixed(1)} KB (${compressed.mimeType})`,
        });
      },
      {
        actionKey: 'ground_truth_capture_photo',
        moduleName: 'GroundTruthModal',
        errorTitle: tr('Não foi possível capturar a foto', 'Could not capture photo'),
        onLoadingChange: setIsCompressingPhoto,
        onToast,
        onErrorLog,
      },
    );
  };

  const handlePhotoFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    void safeAction(
      async () => {
        const compressed = await compressImageFile(file, {
          targetMaxKb: TARGET_PHOTO_MAX_KB,
        });
        setPhoto(compressed);
        onToast?.({
          type: 'success',
          title: tr('Foto comprimida', 'Photo compressed'),
          message: `${compressed.sizeKb.toFixed(1)} KB (${compressed.width}×${compressed.height}px)`,
        });
      },
      {
        actionKey: 'ground_truth_compress_photo',
        moduleName: 'GroundTruthModal',
        errorTitle: tr('Não foi possível processar a imagem', 'Could not process image'),
        onLoadingChange: setIsCompressingPhoto,
        onToast,
        onErrorLog,
      },
    );
  };

  const handleSubmitObservation = (event: React.FormEvent) => {
    event.preventDefault();
    if (cooldown.isCoolingDown) {
      onToast?.({
        type: 'warning',
        title: tr('Intervalo de segurança ativo (30 min)', '30-minute safety cooldown active'),
        message: tr(
          `Aguarde ${cooldown.remainingMinutes} min para registrar novamente nesta coordenada.`,
          `Please wait ${cooldown.remainingMinutes} min before logging again at this coordinate.`,
        ),
      });
      return;
    }

    void safeAction(
      async () => {
        const measuredWindKmh =
          measuredWindDisplay !== null ? windSpeedToKmh(measuredWindDisplay, units.wind) : null;
        const measuredTempC =
          measuredTempDisplay !== null
            ? temperatureToC(measuredTempDisplay, units.temperature)
            : null;
        const measuredWaveM =
          measuredWaveDisplay !== null ? waveHeightToM(measuredWaveDisplay, units.wave) : null;

        const derivedWindFeel = deriveWindFeelFromRelativeRating(
          t0Reference?.windSpeed10mKmh,
          windRelativeRating,
        );

        const obs = createGroundTruthObservation({
          latitude: activeLocation.latitude,
          longitude: activeLocation.longitude,
          locationName: activeLocation.name,
          rainClass,
          skyCoverClass,
          windFeel: derivedWindFeel,
          tempRelativeRating,
          windRelativeRating,
          measuredWindKmh,
          measuredTempC,
          measuredWaveM,
          note: note.trim() || undefined,
          photoDataUrl: photo?.dataUrl,
          photoMimeType: photo?.mimeType,
          photoSizeKb: photo?.sizeKb,
          forecast,
        });

        await saveGroundTruthObservation(obs);
        await reloadObservations();
        dispatchGroundTruthUpdated();
        onCalibrationChange?.();

        setMeasuredWindDisplay(null);
        setMeasuredTempDisplay(null);
        setMeasuredWaveDisplay(null);
        setNote('');
        setPhoto(null);

        onToast?.({
          type: 'success',
          title: tr('Validação de campo registrada', 'Field validation saved'),
          message: tr(
            `Condição pareada com ECMWF/GFS/ICON/GEM em ${activeLocation.name}.`,
            `Observation paired with ECMWF/GFS/ICON/GEM at ${activeLocation.name}.`,
          ),
        });
      },
      {
        actionKey: 'ground_truth_save_observation',
        moduleName: 'GroundTruthModal',
        errorTitle: tr('Erro ao salvar validação de campo', 'Failed to save field validation'),
        onLoadingChange: setIsSaving,
        onToast,
        onErrorLog,
      },
    );
  };

  const handleToggleCalibrated = () => {
    if (!calibration.calibrationEligible) {
      return;
    }
    const next = saveUseCalibratedModelPref(!useCalibratedModel);
    setUseCalibratedModel(next);
    dispatchGroundTruthUpdated();
    onCalibrationChange?.();
    onToast?.({
      type: 'info',
      title: next
        ? tr('Modelo Calibrado Local ativado', 'Locally Calibrated Model enabled')
        : tr('FieldCast Ensemble padrão restaurado', 'Standard FieldCast Ensemble restored'),
      message: next
        ? tr(
            `Pesos Bayesianos aplicados com base em ${calibration.sampleCount} registros regionais.`,
            `Bayesian weights applied from ${calibration.sampleCount} regional records.`,
          )
        : tr(
            'Consenso uniforme dos 4 modelos globais restabelecido.',
            'Equal-weight 4-model consensus restored.',
          ),
    });
  };

  const handleExportJson = () => {
    void safeAction(
      async () => {
        const json = serializeGroundTruthPackage(observations, activeLocation.name);
        const dateTag = new Date().toISOString().slice(0, 10);
        const delivery = await exportAndDeliverFile({
          format: 'json',
          filename: `fieldcast-ground-truth-${dateTag}.json`,
          content: json,
          title: tr('Dataset Ground-Truth FieldCast', 'FieldCast Ground-Truth Dataset'),
          text: tr(
            `${observations.length} observação(ões) pareadas para troca peer-to-peer.`,
            `${observations.length} paired observation(s) for peer-to-peer sharing.`,
          ),
        });
        onToast?.({
          type: 'success',
          title: tr('Dataset Ground-Truth exportado', 'Ground-Truth dataset exported'),
          message: `${observations.length} ${tr('registro(s)', 'record(s)')} • ${delivery.savedPathDisplay}`,
        });
      },
      {
        actionKey: 'ground_truth_export_json',
        moduleName: 'GroundTruthModal',
        errorTitle: tr('Erro ao exportar dataset JSON', 'Failed to export JSON dataset'),
        onLoadingChange: setIsExporting,
        onToast,
        onErrorLog,
      },
    );
  };

  const handleImportJsonChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    void safeAction(
      async () => {
        const raw = await readTextFromFile(file);
        const pkg = parseAndValidateGroundTruthPackage(raw);
        const result = await mergeGroundTruthObservations(pkg.observations);
        await reloadObservations();
        dispatchGroundTruthUpdated();
        onCalibrationChange?.();

        onToast?.({
          type: 'success',
          title: tr('Dataset Ground-Truth mesclado', 'Ground-Truth dataset merged'),
          message: tr(
            `${result.added} registro(s) adicionado(s) e ${result.skipped} duplicado(s) ignorado(s) (total: ${result.total}).`,
            `${result.added} record(s) added and ${result.skipped} duplicate(s) skipped (total: ${result.total}).`,
          ),
        });
      },
      {
        actionKey: 'ground_truth_import_json',
        moduleName: 'GroundTruthModal',
        errorTitle: tr('Falha ao importar JSON Ground-Truth', 'Failed to import Ground-Truth JSON'),
        onLoadingChange: setIsImporting,
        onToast,
        onErrorLog,
      },
    );
  };

  const handleDeleteObservation = (id: string) => {
    void safeAction(
      async () => {
        await deleteGroundTruthObservation(id);
        await reloadObservations();
        dispatchGroundTruthUpdated();
        onCalibrationChange?.();
        onToast?.({
          type: 'info',
          title: tr('Registro excluído', 'Record deleted'),
          message: tr(
            'Métricas regionais e armazenamento local atualizados.',
            'Regional metrics and local storage updated.',
          ),
        });
      },
      {
        actionKey: 'ground_truth_delete_observation',
        moduleName: 'GroundTruthModal',
        errorTitle: tr('Erro ao remover registro', 'Failed to delete record'),
        onToast,
        onErrorLog,
      },
    );
  };

  const handleConfirmClearAll = () => {
    void safeAction(
      async () => {
        const countBefore = observations.length;
        const freedLabel = storageFootprintText;
        for (const obs of observations) {
          await deleteGroundTruthObservation(obs.id);
        }
        saveUseCalibratedModelPref(false);
        setUseCalibratedModel(false);
        setConfirmClearOpen(false);
        await reloadObservations();
        dispatchGroundTruthUpdated();
        onCalibrationChange?.();
        onToast?.({
          type: 'success',
          title: tr('Histórico de validação limpo', 'Validation history cleared'),
          message: tr(
            `${countBefore} registro(s) removido(s) (${freedLabel} liberados no dispositivo).`,
            `${countBefore} record(s) removed (${freedLabel} freed on device).`,
          ),
        });
      },
      {
        actionKey: 'ground_truth_clear_all',
        moduleName: 'GroundTruthModal',
        errorTitle: tr(
          'Erro ao limpar histórico de validação',
          'Failed to clear validation history',
        ),
        onLoadingChange: setIsClearingAll,
        onToast,
        onErrorLog,
      },
    );
  };

  const formatSkillWind = (kmh: number | null, signed = false): string => {
    if (kmh === null || !Number.isFinite(kmh)) return '—';
    const conv = convertWindSpeed(kmh, units.wind) ?? kmh;
    const prefix = signed && conv > 0 ? '+' : '';
    return `${prefix}${conv.toFixed(1)} ${windLabel}`;
  };

  const formatSkillTemp = (degC: number | null, signed = false): string => {
    if (degC === null || !Number.isFinite(degC)) return '—';
    const delta = units.temperature === 'f' ? degC * (9 / 5) : degC;
    const prefix = signed && delta > 0 ? '+' : '';
    return `${prefix}${delta.toFixed(1)} ${tempLabel}`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ground-truth-modal-title"
      data-testid="ground-truth-modal"
      className="fixed inset-0 z-[80] flex items-center justify-center p-2.5 sm:p-5 bg-sky-950/55 dark:bg-slate-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-[#132a47] text-slate-800 dark:text-sky-50 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-sky-100 dark:border-sky-800 bg-gradient-to-r from-sky-50 via-blue-50/50 to-white dark:from-[#0f243d] dark:to-[#132a47]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-2xl bg-[#0080cd] text-white shadow-sm shrink-0">
              <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2
                  id="ground-truth-modal-title"
                  className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white truncate"
                >
                  {tr('Validação de Campo (Ground-Truth)', 'Field Validation (Ground-Truth)')}
                </h2>
                <HelpPopover topic="ground_truth_validation" />
              </div>
              <p className="text-xs text-slate-600 dark:text-sky-200/80 flex flex-wrap items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400 shrink-0" aria-hidden="true" />
                <span className="font-bold text-slate-800 dark:text-white truncate">
                  {activeLocation.name}
                </span>
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-sky-100/80 dark:bg-[#0d1f36] text-[#0070b8] dark:text-sky-300">
                  {activeLocation.latitude.toFixed(4)}, {activeLocation.longitude.toFixed(4)}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Fechar Validação de Campo', 'Close Field Validation')}
            className="min-h-[44px] min-w-[44px] rounded-xl inline-flex items-center justify-center text-slate-600 dark:text-sky-200 hover:bg-slate-200/80 dark:hover:bg-sky-900/60 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 shrink-0"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-5 overflow-y-auto scrollbar-thin space-y-4 flex-1">
          {/* 1. Field Observation Check-In Form */}
          <form
            onSubmit={handleSubmitObservation}
            className="rounded-2xl border border-sky-200/80 dark:border-sky-800/80 bg-[#f8fbff] dark:bg-[#0d1f36]/80 p-3.5 sm:p-4 space-y-3.5"
          >
            {/* Pre-populated t0 Reference Card */}
            <div
              data-testid="gt-t0-reference-card"
              className="rounded-xl border border-sky-200/90 dark:border-sky-700/80 bg-white dark:bg-[#132a47] p-3 space-y-2 shadow-2xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                  {tr(
                    `Previsão FieldCast Agora (${t0HourBadge}) — Referência para Comparação`,
                    `Current FieldCast Forecast (${t0HourBadge}) — Comparison Anchor`,
                  )}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950/70 text-[#0070b8] dark:text-sky-300 border border-sky-200/80 dark:border-sky-800">
                  ECMWF • GFS • ICON • GEM
                </span>
              </div>

              {t0Reference ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="rounded-lg bg-sky-50/70 dark:bg-[#0d1f36] px-2.5 py-1.5 border border-sky-100 dark:border-sky-800/70">
                    <span className="text-[10px] font-semibold text-slate-500 dark:text-sky-300/75 block">
                      {tr('Temperatura', 'Temperature')}
                    </span>
                    <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                      {formatTempValue(t0Reference.temperature2mC, 1)}
                    </span>
                  </div>

                  <div className="rounded-lg bg-sky-50/70 dark:bg-[#0d1f36] px-2.5 py-1.5 border border-sky-100 dark:border-sky-800/70">
                    <span className="text-[10px] font-semibold text-slate-500 dark:text-sky-300/75 block">
                      {tr('Velocidade do Vento', 'Wind Speed')}
                    </span>
                    <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                      {formatWindValue(t0Reference.windSpeed10mKmh, 0)}
                    </span>
                  </div>

                  <div className="rounded-lg bg-sky-50/70 dark:bg-[#0d1f36] px-2.5 py-1.5 border border-sky-100 dark:border-sky-800/70">
                    <span className="text-[10px] font-semibold text-slate-500 dark:text-sky-300/75 block">
                      {tr('Chuva', 'Rain')}
                    </span>
                    <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                      {formatPrecipValue(t0Reference.precipitationMm ?? 0, 1)}/h{' '}
                      <span className="text-[11px] font-bold text-[#0070b8] dark:text-sky-300">
                        ({t0Reference.precipitationProbPct !== null
                          ? `${Math.round(t0Reference.precipitationProbPct)}%`
                          : '0%'})
                      </span>
                    </span>
                  </div>

                  <div className="rounded-lg bg-sky-50/70 dark:bg-[#0d1f36] px-2.5 py-1.5 border border-sky-100 dark:border-sky-800/70">
                    <span className="text-[10px] font-semibold text-slate-500 dark:text-sky-300/75 block">
                      {tr('Cobertura / Céu', 'Cloud / Sky')}
                    </span>
                    <span className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                      {formatSkyCoverShort(t0Reference.skyCoverClass, locale)}
                      {t0Reference.cloudCoverPct !== null ? ` (${t0Reference.cloudCoverPct}%)` : ''}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-sky-300/80">
                  {tr(
                    'Previsão horária ainda não carregada para este ponto; o registro será salvo com suas coordenadas.',
                    'Hourly forecast not loaded yet for this coordinate; check-in will still save with active coordinates.',
                  )}
                </p>
              )}
            </div>

            {/* 30-Minute Per-Location Cooldown Notice */}
            {cooldown.isCoolingDown && (
              <div
                role="status"
                data-testid="gt-cooldown-banner"
                className="rounded-xl border border-amber-300 dark:border-amber-700/80 bg-amber-50/90 dark:bg-amber-950/50 px-3 py-2 flex items-center gap-2 text-xs text-amber-950 dark:text-amber-100"
              >
                <Clock className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0" aria-hidden="true" />
                <span>
                  {tr(
                    `Intervalo anti-duplicidade (${GROUND_TRUTH_COOLDOWN_MINUTES} min por ponto): aguarde ~${cooldown.remainingMinutes} min para novo check-in nesta coordenada.`,
                    `Anti-duplicate cooldown (${GROUND_TRUTH_COOLDOWN_MINUTES} min per location): wait ~${cooldown.remainingMinutes} min before logging again here.`,
                  )}
                </span>
              </div>
            )}

            {/* Objective Visual Selectors: Sky Cover + Rain (Full Evidence Weight 1.0) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Sky Cover / Clouds */}
              <div className="space-y-1.5" data-testid="gt-sky-group">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-slate-700 dark:text-sky-200 inline-flex items-center gap-1.5">
                    <CloudSun className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                    {tr('Céu / Nuvens Observados', 'Observed Sky / Clouds')}
                  </span>
                  <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                    {tr('Visual • Peso 1.0', 'Visual • Wt 1.0')}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {SKY_COVER_OPTIONS.map(({ id, labelPt, labelEn, Icon }) => {
                    const selected = skyCoverClass === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        data-testid={`gt-sky-${id}`}
                        aria-pressed={selected}
                        onClick={() => setSkyCoverClass(id)}
                        className={`min-h-[44px] px-2 py-1.5 rounded-xl text-[11px] font-bold border inline-flex flex-col sm:flex-row items-center justify-center gap-1 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                          selected
                            ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-xs'
                            : 'bg-white dark:bg-[#132a47] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50 dark:hover:bg-sky-900/50'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span className="leading-tight">{tr(labelPt, labelEn)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Objective Rain Class */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-slate-700 dark:text-sky-200 inline-flex items-center gap-1.5">
                    <CloudRain className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                    {tr('Chuva Observada', 'Observed Rain')}
                  </span>
                  <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                    {tr('Visual • Peso 1.0', 'Visual • Wt 1.0')}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {RAIN_CLASS_OPTIONS.map((opt) => {
                    const selected = rainClass === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        data-testid={`gt-rain-${opt.id}`}
                        aria-pressed={selected}
                        onClick={() => setRainClass(opt.id)}
                        className={`min-h-[44px] px-2 py-1.5 rounded-xl text-[11px] font-bold border transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                          selected
                            ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-xs'
                            : 'bg-white dark:bg-[#132a47] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50 dark:hover:bg-sky-900/50'
                        }`}
                      >
                        {tr(opt.labelPt, opt.labelEn)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Anchored 5-Level Relative Ordinal Classifiers (Zero Instrument Required, Evidence Weight 0.5) */}
            <div className="space-y-3 pt-1 border-t border-sky-100 dark:border-sky-800/70">
              {/* Temperature Relative Ordinal */}
              <div className="space-y-1.5" data-testid="gt-temp-rating-group">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-xs font-bold text-slate-700 dark:text-sky-200 inline-flex items-center gap-1.5">
                    <Thermometer className="w-3.5 h-3.5 text-orange-500" aria-hidden="true" />
                    <span>
                      {tr('Temperatura Real vs. Prevista', 'Actual vs. Forecast Temperature')}
                      {t0Reference?.temperature2mC !== null &&
                        t0Reference?.temperature2mC !== undefined && (
                          <strong className="ml-1 text-[#0070b8] dark:text-sky-300">
                            ({formatTempValue(t0Reference.temperature2mC, 1)})
                          </strong>
                        )}
                    </span>
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-sky-300/80">
                    {tr('Ordinal direcional • Peso 0.5', 'Directional ordinal • Wt 0.5')}
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {RELATIVE_RATING_OPTIONS.map((opt) => {
                    const selected = tempRelativeRating === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        data-testid={`gt-temp-rating-${opt.value}`}
                        aria-pressed={selected}
                        onClick={() => setTempRelativeRating(opt.value)}
                        className={`min-h-[44px] px-1.5 py-1.5 rounded-xl text-[10px] sm:text-[11px] font-bold border flex flex-col items-center justify-center leading-tight text-center transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                          selected
                            ? opt.value === 0
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                              : opt.value < 0
                                ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                                : 'bg-orange-500 text-white border-orange-500 shadow-xs'
                            : 'bg-white dark:bg-[#132a47] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50 dark:hover:bg-sky-900/50'
                        }`}
                      >
                        <span>{tr(opt.shortPt, opt.shortEn)}</span>
                        <span className="text-[10px] font-mono opacity-85">({opt.tag})</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Wind Relative Ordinal */}
              <div className="space-y-1.5" data-testid="gt-wind-rating-group">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-xs font-bold text-slate-700 dark:text-sky-200 inline-flex items-center gap-1.5">
                    <Wind className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                    <span>
                      {tr('Vento Real vs. Previsto', 'Actual vs. Forecast Wind')}
                      {t0Reference?.windSpeed10mKmh !== null &&
                        t0Reference?.windSpeed10mKmh !== undefined && (
                          <strong className="ml-1 text-[#0070b8] dark:text-sky-300">
                            ({formatWindValue(t0Reference.windSpeed10mKmh, 0)})
                          </strong>
                        )}
                    </span>
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-sky-300/80">
                    {tr('Ordinal direcional • Peso 0.5', 'Directional ordinal • Wt 0.5')}
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {RELATIVE_RATING_OPTIONS.map((opt) => {
                    const selected = windRelativeRating === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        data-testid={`gt-wind-rating-${opt.value}`}
                        aria-pressed={selected}
                        onClick={() => setWindRelativeRating(opt.value)}
                        className={`min-h-[44px] px-1.5 py-1.5 rounded-xl text-[10px] sm:text-[11px] font-bold border flex flex-col items-center justify-center leading-tight text-center transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                          selected
                            ? opt.value === 0
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                              : opt.value < 0
                                ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                                : 'bg-amber-600 text-white border-amber-600 shadow-xs'
                            : 'bg-white dark:bg-[#132a47] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50 dark:hover:bg-sky-900/50'
                        }`}
                      >
                        <span>{tr(opt.shortPt, opt.shortEn)}</span>
                        <span className="text-[10px] font-mono opacity-85">({opt.tag})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Collapsed / Secondary Optional Exact Instrument Measurements (Weight 1.0) */}
            <div className="rounded-xl border border-slate-200/85 dark:border-sky-800/75 bg-white/75 dark:bg-[#132a47]/65">
              <button
                type="button"
                data-testid="gt-instrument-toggle"
                aria-expanded={showInstrumentInputs}
                onClick={() => setShowInstrumentInputs((prev) => !prev)}
                className="w-full min-h-[44px] px-3 py-2 flex items-center justify-between gap-2 text-xs font-bold text-slate-700 dark:text-sky-200 hover:bg-sky-50/70 dark:hover:bg-sky-900/30 rounded-xl transition-colors"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                  <span>
                    {tr(
                      'Medições Instrumentais Exatas — Peso 1.0 (Opcional)',
                      'Exact Instrument Readings — Weight 1.0 (Optional)',
                    )}
                  </span>
                </span>
                {showInstrumentInputs ? (
                  <ChevronUp className="w-4 h-4 shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
                )}
              </button>

              {showInstrumentInputs && (
                <div className="px-3 pb-3 pt-1 grid grid-cols-1 sm:grid-cols-3 gap-2.5 border-t border-slate-100 dark:border-sky-800/60">
                  <label className="space-y-1 text-xs">
                    <span className="font-semibold text-slate-600 dark:text-sky-200 block">
                      {tr(`Vento Medido (${windLabel})`, `Measured Wind (${windLabel})`)}
                    </span>
                    <NumericInput
                      data-testid="gt-measured-wind"
                      value={measuredWindDisplay}
                      min={0}
                      max={300}
                      decimals={1}
                      placeholder="—"
                      onValueChange={(_raw, parsed) => setMeasuredWindDisplay(parsed)}
                      onCommit={(committed) => setMeasuredWindDisplay(committed)}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-sky-800 bg-white dark:bg-[#0d1f36] text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </label>

                  <label className="space-y-1 text-xs">
                    <span className="font-semibold text-slate-600 dark:text-sky-200 block">
                      {tr(`Temperatura (${tempLabel})`, `Temperature (${tempLabel})`)}
                    </span>
                    <NumericInput
                      data-testid="gt-measured-temp"
                      value={measuredTempDisplay}
                      min={-60}
                      max={140}
                      decimals={1}
                      allowNegative={true}
                      placeholder="—"
                      onValueChange={(_raw, parsed) => setMeasuredTempDisplay(parsed)}
                      onCommit={(committed) => setMeasuredTempDisplay(committed)}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-sky-800 bg-white dark:bg-[#0d1f36] text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </label>

                  <label className="space-y-1 text-xs">
                    <span className="font-semibold text-slate-600 dark:text-sky-200 block">
                      {tr(`Onda (${waveLabel})`, `Wave (${waveLabel})`)}
                    </span>
                    <NumericInput
                      data-testid="gt-measured-wave"
                      value={measuredWaveDisplay}
                      min={0}
                      max={40}
                      decimals={1}
                      placeholder="—"
                      onValueChange={(_raw, parsed) => setMeasuredWaveDisplay(parsed)}
                      onCommit={(committed) => setMeasuredWaveDisplay(committed)}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-sky-800 bg-white dark:bg-[#0d1f36] text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Optional Note + Strictly Optional Photo */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end">
              <label className="md:col-span-7 space-y-1 text-xs">
                <span className="font-semibold text-slate-600 dark:text-sky-200 block">
                  {tr('Observação de Campo (Opcional)', 'Field Note (Optional)')}
                </span>
                <input
                  type="text"
                  data-testid="gt-note-input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={240}
                  placeholder={tr(
                    'Ex.: Neblina fechando na costa, rajadas entrando de Sul...',
                    'e.g., Coastal fog rolling in, sudden south gusts...',
                  )}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-sky-800 bg-white dark:bg-[#132a47] text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </label>

              <div className="md:col-span-5 space-y-1">
                <span className="text-xs font-semibold text-slate-600 dark:text-sky-200 block">
                  {tr('Foto (Opcional)', 'Photo (Optional)')}
                </span>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  data-testid="gt-photo-file-input"
                  onChange={handlePhotoFileChange}
                  className="hidden"
                  aria-label={tr('Anexar foto opcional de campo', 'Attach optional field photo')}
                />
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isCompressingPhoto}
                    onClick={handleCaptureCameraPhoto}
                    className="flex-1 min-h-[44px] px-2.5 py-1.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 border border-slate-200 dark:border-sky-800 bg-white dark:bg-[#132a47] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-slate-700 dark:text-sky-100 transition-colors"
                  >
                    <Camera className="w-4 h-4 text-[#0080cd] dark:text-sky-400 shrink-0" aria-hidden="true" />
                    <span>{tr('Câmera', 'Camera')}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isCompressingPhoto}
                    onClick={() => photoInputRef.current?.click()}
                    className="flex-1 min-h-[44px] px-2.5 py-1.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 border border-slate-200 dark:border-sky-800 bg-white dark:bg-[#132a47] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-slate-700 dark:text-sky-100 transition-colors"
                  >
                    <ImageIcon className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" aria-hidden="true" />
                    <span>{tr('Galeria', 'Upload')}</span>
                  </button>
                </div>
              </div>
            </div>

            {photo && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-[#132a47] p-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={photo.dataUrl}
                    alt={tr('Prévia da foto opcional', 'Optional photo preview')}
                    className="w-12 h-12 rounded-lg object-cover border border-slate-200 dark:border-sky-700 shrink-0"
                  />
                  <div className="text-xs min-w-0">
                    <p className="font-bold text-slate-900 dark:text-white truncate">
                      {tr('Foto anexada (Opcional)', 'Photo attached (Optional)')}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-sky-300/80">
                      {photo.sizeKb.toFixed(1)} KB • {photo.mimeType}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  className="min-h-[44px] px-3 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                >
                  {tr('Remover', 'Remove')}
                </button>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                data-testid="gt-submit-btn"
                disabled={isSaving || cooldown.isCoolingDown}
                className="min-h-[44px] px-5 py-2 rounded-xl text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-2 bg-[#0080cd] hover:bg-[#006bb3] text-white shadow-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                <span>
                  {isSaving
                    ? tr('Salvando...', 'Saving...')
                    : cooldown.isCoolingDown
                      ? tr(
                          `Aguarde ${cooldown.remainingMinutes} min`,
                          `Wait ${cooldown.remainingMinutes} min`,
                        )
                      : tr('Registrar Validação em Campo', 'Save Field Validation')}
                </span>
              </button>
            </div>
          </form>

          {/* 2. Regional Skill Score & Bayesian Calibration Unlock */}
          <section className="rounded-2xl border border-slate-200/90 dark:border-sky-800/80 bg-white dark:bg-[#0d1f36]/65 p-3.5 sm:p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Scale className="w-4 h-4 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                  {tr(
                    `Skill Score Regional (Raio ${calibration.radiusKm} km)`,
                    `Regional Skill Score (${calibration.radiusKm} km Radius)`,
                  )}
                </h3>
              </div>
              <span
                data-testid="gt-sample-progress"
                className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-sky-50 dark:bg-sky-950/70 text-[#0070b8] dark:text-sky-200 border border-sky-200 dark:border-sky-800"
              >
                {calibration.sampleCount} / {MIN_CALIBRATION_SAMPLES}{' '}
                {tr('registros independentes', 'independent records')}
              </span>
            </div>

            {/* Progress Bar toward MIN_CALIBRATION_SAMPLES */}
            <div className="space-y-1">
              <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-[#132a47] overflow-hidden border border-slate-200/70 dark:border-sky-800">
                <div
                  className={`h-full rounded-full transition-all ${
                    calibration.calibrationEligible ? 'bg-emerald-500' : 'bg-[#0080cd]'
                  }`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-sky-300/80">
                <span>
                  {calibration.calibrationEligible
                    ? tr(
                        `Calibração Bayesiana desbloqueada (λ = ${Math.round(calibration.shrinkageFactor * 100)}%, limites [10%–50%], evidência 1.0 visual/instrumental vs. 0.5 ordinal).`,
                        `Bayesian calibration unlocked (λ = ${Math.round(calibration.shrinkageFactor * 100)}%, bounds [10%–50%], 1.0 visual/instrument vs. 0.5 ordinal weight).`,
                      )
                    : tr(
                        `Faltam ${Math.max(0, MIN_CALIBRATION_SAMPLES - calibration.sampleCount)} registro(s) independentes (cooldown 30 min/ponto) para desbloquear calibração.`,
                        `${Math.max(0, MIN_CALIBRATION_SAMPLES - calibration.sampleCount)} more independent record(s) (30-min/site cooldown) needed to unlock calibration.`,
                      )}
                </span>
                {calibration.bestModel && (
                  <span className="font-bold text-emerald-700 dark:text-emerald-300">
                    {tr('Melhor modelo local:', 'Top local model:')}{' '}
                    {MODEL_DISPLAY_LABELS[calibration.bestModel]}
                  </span>
                )}
              </div>
            </div>

            {/* Model Skill Table */}
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full border-collapse text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-sky-800 bg-slate-50 dark:bg-[#132a47] text-slate-600 dark:text-sky-200">
                    <th className="py-2 px-2.5 font-bold">{tr('Modelo', 'Model')}</th>
                    <th className="py-2 px-2.5 font-bold">Skill</th>
                    <th className="py-2 px-2.5 font-bold">{tr('Alinh. Ord.', 'Ord. Align')}</th>
                    <th className="py-2 px-2.5 font-bold">{tr('MAE Vento', 'Wind MAE')}</th>
                    <th className="py-2 px-2.5 font-bold">{tr('Viés Vento', 'Wind Bias')}</th>
                    <th className="py-2 px-2.5 font-bold">{tr('MAE Temp', 'Temp MAE')}</th>
                    <th className="py-2 px-2.5 font-bold">Brier</th>
                    <th className="py-2 px-2.5 font-bold">{tr('Peso', 'Weight')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-sky-800/60">
                  {WEATHER_MODELS.map((modelId) => {
                    const m = calibration.metricsByModel[modelId];
                    const isBest = calibration.bestModel === modelId;
                    return (
                      <tr key={modelId} className="text-slate-800 dark:text-sky-100">
                        <th className="py-2 px-2.5 font-bold whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: MODEL_COLORS[modelId] }}
                              aria-hidden="true"
                            />
                            <span>{MODEL_DISPLAY_LABELS[modelId]}</span>
                            {isBest && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200">
                                ★
                              </span>
                            )}
                          </span>
                        </th>
                        <td className="py-2 px-2.5 font-extrabold">
                          {m.sampleCount > 0 ? `${m.compositeSkillScore}/100` : '—'}
                        </td>
                        <td className="py-2 px-2.5 font-mono text-[11px]">
                          {m.ordinalAlignmentPct !== null && m.ordinalAlignmentPct !== undefined
                            ? `${m.ordinalAlignmentPct}%`
                            : '—'}
                        </td>
                        <td className="py-2 px-2.5 font-mono text-[11px]">
                          {formatSkillWind(m.windMaeKmh)}
                        </td>
                        <td className="py-2 px-2.5 font-mono text-[11px]">
                          {formatSkillWind(m.windBiasKmh, true)}
                        </td>
                        <td className="py-2 px-2.5 font-mono text-[11px]">
                          {formatSkillTemp(m.tempMaeC)}
                        </td>
                        <td className="py-2 px-2.5 font-mono text-[11px]">
                          {m.rainBrierScore !== null ? m.rainBrierScore.toFixed(3) : '—'}
                        </td>
                        <td className="py-2 px-2.5 font-extrabold text-[#0070b8] dark:text-sky-300">
                          {Math.round(m.weight * 100)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Optional Calibrated Model Toggle */}
            <div
              className={`rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                calibration.calibrationEligible
                  ? 'border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/35'
                  : 'border-slate-200 dark:border-sky-800/70 bg-slate-50/80 dark:bg-[#132a47]/70'
              }`}
            >
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                  <span className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                    {tr(
                      'Usar Modelo Calibrado Localmente (Bayesiano)',
                      'Use Locally Calibrated Model (Bayesian)',
                    )}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-sky-200/85">
                  {calibration.calibrationEligible
                    ? tr(
                        'Opcional — o padrão permanece FieldCast Ensemble (pesos iguais). Ative para aplicar os pesos regionais calibrados.',
                        'Optional — default remains standard FieldCast Ensemble (equal weights). Enable to apply calibrated regional weights.',
                      )
                    : tr(
                        'Necessário mínimo de 10 registros na região para evitar sobreajuste',
                        'Minimum of 10 regional records required to avoid overfitting',
                      )}
                </p>
              </div>

              <button
                type="button"
                role="switch"
                data-testid="toggle-calibrated-model"
                aria-checked={calibration.calibrationEligible && useCalibratedModel}
                disabled={!calibration.calibrationEligible}
                onClick={handleToggleCalibrated}
                className={`min-h-[44px] min-w-[124px] px-3.5 py-2 rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-1.5 shrink-0 border transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                  !calibration.calibrationEligible
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-700 cursor-not-allowed opacity-70'
                    : useCalibratedModel
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 shadow-xs'
                      : 'bg-white dark:bg-[#132a47] hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
                }`}
              >
                <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  {!calibration.calibrationEligible
                    ? tr('Bloqueado', 'Locked')
                    : useCalibratedModel
                      ? tr('Calibrado Ativo', 'Calibrated On')
                      : tr('Ativar Calibrado', 'Enable Calibrated')}
                </span>
              </button>
            </div>
          </section>

          {/* 3. Offline Peer-to-Peer JSON Export / Import */}
          <section className="rounded-2xl border border-slate-200/90 dark:border-sky-800/80 bg-slate-50/70 dark:bg-[#0d1f36]/65 p-3.5 sm:p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                  {tr(
                    'Troca Offline Peer-to-Peer (.json)',
                    'Offline Peer-to-Peer Exchange (.json)',
                  )}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-sky-300/80">
                  {tr(
                    `Exporte ou mescle registros validados (schema fieldcast-gt-v1) sem servidor. Total salvo: ${observations.length}.`,
                    `Export or merge validated records (schema fieldcast-gt-v1) with zero backend. Saved total: ${observations.length}.`,
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  data-testid="export-ground-truth-json"
                  disabled={isExporting || observations.length === 0}
                  onClick={handleExportJson}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-white dark:bg-[#132a47] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-[#0070b8] dark:text-sky-200 border border-sky-200 dark:border-sky-700 disabled:opacity-50 transition-colors"
                >
                  <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{tr('Exportar Dataset (.json)', 'Export Dataset (.json)')}</span>
                </button>

                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json,.json"
                  data-testid="import-ground-truth-file-input"
                  onChange={handleImportJsonChange}
                  className="hidden"
                  aria-label={tr(
                    'Selecionar arquivo JSON Ground-Truth para importar',
                    'Select Ground-Truth JSON file to import',
                  )}
                />
                <button
                  type="button"
                  data-testid="import-ground-truth-json"
                  disabled={isImporting}
                  onClick={() => importInputRef.current?.click()}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-[#0080cd] hover:bg-[#006bb3] text-white shadow-xs disabled:opacity-60 transition-colors"
                >
                  <Upload className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{tr('Importar / Mesclar JSON', 'Import / Merge JSON')}</span>
                </button>
              </div>
            </div>
          </section>

          {/* 4. Local Storage Management Panel */}
          <section
            data-testid="ground-truth-storage-panel"
            aria-label={tr('Gestão de Armazenamento Local', 'Local Storage Management')}
            className="rounded-2xl border border-slate-200/90 dark:border-sky-800/80 bg-white dark:bg-[#0d1f36]/65 p-3.5 sm:p-4 space-y-3"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-start gap-2 min-w-0">
                <div className="p-2 rounded-xl bg-slate-100 dark:bg-[#132a47] text-[#0080cd] dark:text-sky-300 border border-slate-200/80 dark:border-sky-800 shrink-0">
                  <HardDrive className="w-4 h-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                    {tr('Gestão de Armazenamento Local', 'Local Storage Management')}
                  </h3>
                  <p className="text-[11px] text-slate-600 dark:text-sky-300/85">
                    <strong data-testid="ground-truth-storage-count">{observations.length}</strong>{' '}
                    {tr('registro(s)', 'record(s)')} •{' '}
                    <strong data-testid="ground-truth-storage-size">{storageFootprintText}</strong>{' '}
                    {tr(
                      `(${photoAttachmentsCount} foto(s) anexada(s))`,
                      `(${photoAttachmentsCount} attached photo(s))`,
                    )}
                  </p>
                </div>
              </div>

              <button
                type="button"
                data-testid="clear-ground-truth-btn"
                disabled={observations.length === 0 || isClearingAll}
                onClick={() => setConfirmClearOpen(true)}
                className="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 border border-rose-200 dark:border-rose-800/80 bg-rose-50/85 dark:bg-rose-950/45 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-200 disabled:opacity-45 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  {tr('Limpar Histórico de Validação', 'Clear Validation History')}
                </span>
              </button>
            </div>

            {/* Inline 2-step confirmation for clearing all observations */}
            {confirmClearOpen && observations.length > 0 && (
              <div
                role="alert"
                data-testid="clear-ground-truth-confirm-box"
                className="rounded-xl border border-rose-300 dark:border-rose-700 bg-rose-50/95 dark:bg-rose-950/60 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-rose-950 dark:text-rose-100"
              >
                <p className="font-semibold">
                  {tr(
                    `Remover todos os ${observations.length} registro(s) locais (${storageFootprintText})? Exporte o JSON antes se desejar manter backup.`,
                    `Delete all ${observations.length} local record(s) (${storageFootprintText})? Export JSON first if you want a backup.`,
                  )}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    data-testid="cancel-clear-ground-truth-btn"
                    onClick={() => setConfirmClearOpen(false)}
                    className="min-h-[44px] px-3 py-1.5 rounded-xl text-xs font-bold bg-white dark:bg-[#132a47] text-slate-700 dark:text-sky-100 border border-slate-200 dark:border-sky-700 hover:bg-slate-50 transition-colors"
                  >
                    {tr('Cancelar', 'Cancel')}
                  </button>
                  <button
                    type="button"
                    data-testid="confirm-clear-ground-truth-btn"
                    disabled={isClearingAll}
                    onClick={handleConfirmClearAll}
                    className="min-h-[44px] px-3.5 py-1.5 rounded-xl text-xs font-extrabold bg-rose-600 hover:bg-rose-700 text-white shadow-xs disabled:opacity-60 transition-colors"
                  >
                    {isClearingAll
                      ? tr('Limpando...', 'Clearing...')
                      : tr('Confirmar Limpeza', 'Confirm Clear')}
                  </button>
                </div>
              </div>
            )}

            {/* Compact Recent Observations List with per-record Delete */}
            {observations.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-sky-300/75 text-center py-2">
                {tr(
                  'Nenhum registro salvo localmente ainda.',
                  'No validation records saved locally yet.',
                )}
              </p>
            ) : (
              <div className="space-y-1.5 pt-1 border-t border-slate-200/80 dark:border-sky-800/70">
                <p className="text-[11px] font-bold text-slate-600 dark:text-sky-300">
                  {tr('Observações salvas recentes', 'Recent saved observations')} (
                  {Math.min(observations.length, 8)}/{observations.length})
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {observations.slice(0, 8).map((obs) => (
                    <div
                      key={obs.id}
                      className="rounded-xl border border-slate-200/80 dark:border-sky-800 bg-slate-50/70 dark:bg-[#132a47] p-2.5 flex items-start justify-between gap-2 text-xs"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        {obs.photoDataUrl && (
                          <img
                            src={obs.photoDataUrl}
                            alt={obs.locationName}
                            className="w-10 h-10 rounded-lg object-cover border border-slate-200 dark:border-sky-700 shrink-0"
                          />
                        )}
                        <div className="min-w-0 space-y-0.5">
                          <p className="font-bold text-slate-900 dark:text-white truncate">
                            {obs.locationName}
                          </p>
                          <p className="text-[11px] text-slate-600 dark:text-sky-200">
                            {formatRainClassShort(obs.rainClass, locale)}
                            {obs.skyCoverClass
                              ? ` • ${formatSkyCoverShort(obs.skyCoverClass, locale)}`
                              : ''}
                            {obs.tempRelativeRating !== undefined &&
                            obs.tempRelativeRating !== null
                              ? ` • T(${formatRatingTag(obs.tempRelativeRating)})`
                              : ''}
                            {obs.windRelativeRating !== undefined &&
                            obs.windRelativeRating !== null
                              ? ` • V(${formatRatingTag(obs.windRelativeRating)})`
                              : ''}
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-sky-300/75 font-mono">
                            {new Date(obs.timestampUtcIso).toLocaleString(intlLocale, {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })}
                            {typeof obs.photoSizeKb === 'number' && obs.photoSizeKb > 0
                              ? ` • 📷 ${obs.photoSizeKb.toFixed(0)} KB`
                              : ''}
                          </p>
                          {obs.note && (
                            <p className="text-[11px] italic text-slate-500 dark:text-sky-200/80 truncate">
                              “{obs.note}”
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid={`delete-ground-truth-${obs.id}`}
                        onClick={() => handleDeleteObservation(obs.id)}
                        aria-label={tr(
                          `Excluir registro ${obs.locationName}`,
                          `Delete record ${obs.locationName}`,
                        )}
                        className="min-h-[44px] px-2.5 rounded-xl inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 border border-transparent hover:border-rose-200 dark:hover:border-rose-800 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{tr('Excluir', 'Delete')}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3 border-t border-slate-200 dark:border-sky-800 bg-slate-50 dark:bg-[#0d1f36] flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500 dark:text-sky-300/80">
            {tr(
              '100% offline no dispositivo (IndexedDB) • Sem envio a servidores externos',
              '100% offline on-device (IndexedDB) • Zero external server uploads',
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 py-2 rounded-xl text-xs sm:text-sm font-bold bg-slate-900 dark:bg-sky-600 text-white hover:opacity-95 transition-opacity"
          >
            {tr('Fechar', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
};
