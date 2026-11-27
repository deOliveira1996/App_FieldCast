import React, { useCallback, useEffect, useState } from 'react';
import {
  AlarmClock,
  AlertTriangle,
  BatteryCharging,
  Bell,
  BellRing,
  CheckCircle2,
  Clock,
  Compass,
  Gauge,
  Moon,
  Navigation,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Sliders,
  Smartphone,
  Sun,
  Trash2,
  Waves,
  X,
} from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { useUnits } from '../../context/UnitsContext';
import { useTheme, type ThemeMode } from '../../hooks/useTheme';
import {
  DHN_TIDE_DISCLAIMER_EN,
  DHN_TIDE_DISCLAIMER_PT,
  dispatchSystemNotification,
  getNativeBackgroundAlertStatus,
  getSystemNotificationPermissionState,
  loadNotificationPreferences,
  openNativeExactAlarmSettings,
  requestNativeBatteryExemption,
  requestSystemNotificationPermission,
  saveNotificationPreferences,
  type NativeBackgroundAlertStatus,
} from '../../services/notificationService';
import {
  getBackgroundTrackingConsent,
  setBackgroundTrackingConsent,
} from '../../services/platform/LocationTrackerService';
import type { ErrorLogRecord, ToastMessage } from '../../types/health';
import { SafeWindowThresholdsSchema } from '../../types/schemas';
import type {
  ActivityQualityThresholds,
  CoastalNavThresholdKey,
  CustomNotificationConditions,
  CustomNotificationRule,
  DailyFieldThresholdKey,
  NotificationRecurrenceConfig,
  UserNotificationPreferences,
} from '../../types/v4';
import {
  DEFAULT_SAFE_WINDOW_THRESHOLDS,
  type NormalizedForecast,
  type SafeWindowThresholdKey,
  type SafeWindowThresholds,
} from '../../types/weather';
import {
  DEFAULT_ACTIVITY_QUALITY_THRESHOLDS,
  loadActivityQualityThresholds,
  saveActivityQualityThresholds,
} from '../../utils/qualityScores';
import { safeAction } from '../../utils/safeAction';
import {
  convertTemperature,
  convertWaveHeight,
  convertWindSpeed,
  getTempUnitLabel,
  getWaveUnitLabel,
  getWindUnitLabel,
  temperatureToC,
  waveHeightToM,
  windSpeedToKmh,
  type PrecipitationUnit,
  type PressureUnit,
  type TemperatureUnit,
  type UnitPreferences,
  type WaveHeightUnit,
  type WindSpeedUnit,
} from '../../utils/units';
import { CollapsibleModule, HelpPopover, NumericInput } from '../common';

const SAFE_WINDOW_STORAGE_KEY = 'fieldcast_safe_window_thresholds';

function loadFallbackSafeWindowThresholds(): SafeWindowThresholds {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(SAFE_WINDOW_STORAGE_KEY);
      if (raw) {
        const parsed = SafeWindowThresholdsSchema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          return parsed.data;
        }
      }
    }
  } catch {
    // Fallback seguro
  }
  return DEFAULT_SAFE_WINDOW_THRESHOLDS;
}

export interface SettingsTabProps {
  forecast?: NormalizedForecast | null;
  theme?: ThemeMode;
  isDark?: boolean;
  onToggleTheme?: () => void;
  thresholds?: SafeWindowThresholds;
  onSaveThresholds?: (next: SafeWindowThresholds) => void | Promise<void>;
  onNotificationPreferencesChange?: (prefs: UserNotificationPreferences) => void;
  onActivityQualityThresholdsChange?: (thresholds: ActivityQualityThresholds) => void;
  onBackgroundGpsConsentChange?: (enabled: boolean) => void;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
}

interface RuleBuilderDraft {
  name: string;
  startHHMM: string;
  endHHMM: string;
  notifyFromHHMM: string;
  minTempC: string;
  maxTempC: string;
  minPrecipProbPct: string;
  maxWindKmh: string;
  maxGustKmh: string;
  maxCloudCoverPct: string;
  maxWaveM: string;
  minTideMslM: string;
  maxTideMslM: string;
  maxKpIndex: string;
  recurrenceMode: NotificationRecurrenceConfig['mode'];
  recurrenceMaxTriggers: string;
  recurrenceIntervalHours: string;
  customTitle: string;
  customMessage: string;
}

const INITIAL_RULE_DRAFT: RuleBuilderDraft = {
  name: '',
  startHHMM: '06:00',
  endHHMM: '18:00',
  notifyFromHHMM: '',
  minTempC: '',
  maxTempC: '',
  minPrecipProbPct: '',
  maxWindKmh: '',
  maxGustKmh: '',
  maxCloudCoverPct: '',
  maxWaveM: '',
  minTideMslM: '',
  maxTideMslM: '',
  maxKpIndex: '',
  recurrenceMode: 'once',
  recurrenceMaxTriggers: '2',
  recurrenceIntervalHours: '3',
  customTitle: '',
  customMessage: '',
};

type RuleConditionKey =
  | 'minTempC'
  | 'maxTempC'
  | 'minPrecipProbPct'
  | 'maxWindKmh'
  | 'maxGustKmh'
  | 'maxCloudCoverPct'
  | 'maxWaveM'
  | 'minTideMslM'
  | 'maxTideMslM'
  | 'maxKpIndex';

const DEFAULT_ENABLED_RULE_FIELDS: Record<RuleConditionKey, boolean> = {
  minTempC: false,
  maxTempC: false,
  minPrecipProbPct: false,
  maxWindKmh: false,
  maxGustKmh: false,
  maxCloudCoverPct: false,
  maxWaveM: false,
  minTideMslM: false,
  maxTideMslM: false,
  maxKpIndex: false,
};

function parseOptionalInputNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function formatRuleConditionChips(
  conditions: CustomNotificationConditions,
  units?: UnitPreferences,
): string[] {
  const chips: string[] = [];
  const tempLabel = units ? getTempUnitLabel(units.temperature) : '°C';
  const windLabel = units ? getWindUnitLabel(units.wind) : 'km/h';
  const waveLabel = units ? getWaveUnitLabel(units.wave) : 'm';

  const fmtTemp = (c: number) =>
    units ? Number((convertTemperature(c, units.temperature) ?? c).toFixed(1)) : c;
  const fmtWind = (kmh: number) =>
    units ? Number((convertWindSpeed(kmh, units.wind) ?? kmh).toFixed(1)) : kmh;
  const fmtWave = (m: number) =>
    units ? Number((convertWaveHeight(m, units.wave) ?? m).toFixed(2)) : m;

  if (conditions.minTempC !== undefined && conditions.minTempC !== null) {
    chips.push(`Temp < ${fmtTemp(conditions.minTempC)} ${tempLabel}`);
  }
  if (conditions.maxTempC !== undefined && conditions.maxTempC !== null) {
    chips.push(`Temp > ${fmtTemp(conditions.maxTempC)} ${tempLabel}`);
  }
  if (conditions.minPrecipProbPct !== undefined && conditions.minPrecipProbPct !== null) {
    chips.push(`Chuva >= ${conditions.minPrecipProbPct}%`);
  }
  if (conditions.maxWindKmh !== undefined && conditions.maxWindKmh !== null) {
    chips.push(`Vento >= ${fmtWind(conditions.maxWindKmh)} ${windLabel}`);
  }
  if (conditions.maxGustKmh !== undefined && conditions.maxGustKmh !== null) {
    chips.push(`Rajada >= ${fmtWind(conditions.maxGustKmh)} ${windLabel}`);
  }
  if (conditions.maxCloudCoverPct !== undefined && conditions.maxCloudCoverPct !== null) {
    chips.push(`Nuvens >= ${conditions.maxCloudCoverPct}%`);
  }
  if (conditions.maxWaveM !== undefined && conditions.maxWaveM !== null) {
    chips.push(`Onda >= ${fmtWave(conditions.maxWaveM)} ${waveLabel}`);
  }
  if (conditions.minTideMslM !== undefined && conditions.minTideMslM !== null) {
    chips.push(`Maré MSL <= ${fmtWave(conditions.minTideMslM)} ${waveLabel}`);
  }
  if (conditions.maxTideMslM !== undefined && conditions.maxTideMslM !== null) {
    chips.push(`Maré MSL >= ${fmtWave(conditions.maxTideMslM)} ${waveLabel}`);
  }
  if (conditions.maxKpIndex !== undefined && conditions.maxKpIndex !== null) {
    chips.push(`Kp >= ${conditions.maxKpIndex}`);
  }
  return chips;
}

function formatRuleRecurrenceLabel(
  recurrence: NotificationRecurrenceConfig | undefined,
  tr: (pt: string, en: string) => string,
): string {
  const mode = recurrence?.mode ?? 'once';
  if (mode === 'times_per_window') {
    const count = recurrence?.maxTriggersPerWindow ?? 2;
    return tr(`${count}x na janela`, `${count}x per window`);
  }
  if (mode === 'interval_hours') {
    const hours = recurrence?.intervalHours ?? 2;
    const maxCount = recurrence?.maxTriggersPerWindow ?? 6;
    return tr(`A cada ${hours}h (máx ${maxCount}x)`, `Every ${hours}h (max ${maxCount}x)`);
  }
  return tr('1x na janela', '1x per window');
}

export function SettingsTab({
  theme: externalTheme,
  onToggleTheme,
  thresholds: externalThresholds,
  onSaveThresholds,
  onNotificationPreferencesChange,
  onActivityQualityThresholdsChange,
  onBackgroundGpsConsentChange,
  onToast,
  onErrorLog,
}: SettingsTabProps): React.ReactElement {
  const { tr } = useLocale();
  const {
    units,
    setWindUnit,
    setTemperatureUnit,
    setWaveUnit,
    setPressureUnit,
    setPrecipitationUnit,
    resetUnits,
  } = useUnits();
  const fallbackThemeHook = useTheme('light');
  const activeTheme: ThemeMode = externalTheme ?? fallbackThemeHook.theme;
  const handleThemeSwitch = onToggleTheme ?? fallbackThemeHook.toggleTheme;

  const [prefs, setPrefs] = useState<UserNotificationPreferences>(() =>
    loadNotificationPreferences(),
  );
  const [permissionState, setPermissionState] = useState<
    'granted' | 'denied' | 'default' | 'unsupported'
  >('default');
  const [bgStatus, setBgStatus] = useState<NativeBackgroundAlertStatus>({
    supported: false,
    notificationsGranted: false,
    exactAlarmAllowed: false,
    ignoringBatteryOptimizations: false,
  });
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  const [ruleDraft, setRuleDraft] = useState<RuleBuilderDraft>(INITIAL_RULE_DRAFT);
  const [enabledRuleFields, setEnabledRuleFields] = useState<Record<RuleConditionKey, boolean>>(
    DEFAULT_ENABLED_RULE_FIELDS,
  );
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [isAlertBuilderOpen, setIsAlertBuilderOpen] = useState<boolean>(false);

  const [bgGpsConsent, setBgGpsConsent] = useState<boolean>(() =>
    getBackgroundTrackingConsent(),
  );

  const [qualityDraft, setQualityDraft] = useState<ActivityQualityThresholds>(() =>
    loadActivityQualityThresholds(),
  );

  const [safeWindowDraft, setSafeWindowDraft] = useState<SafeWindowThresholds>(() =>
    externalThresholds ?? loadFallbackSafeWindowThresholds(),
  );

  useEffect(() => {
    if (externalThresholds) {
      setSafeWindowDraft(externalThresholds);
    }
  }, [externalThresholds]);

  useEffect(() => {
    const handlePrefsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<UserNotificationPreferences | undefined>).detail;
      const refreshed = detail ?? loadNotificationPreferences();
      setPrefs(refreshed);
      onNotificationPreferencesChange?.(refreshed);
    };
    window.addEventListener('fieldcast:notification-prefs-updated', handlePrefsUpdated);
    return () => {
      window.removeEventListener('fieldcast:notification-prefs-updated', handlePrefsUpdated);
    };
  }, [onNotificationPreferencesChange]);

  const refreshNativeBgStatus = useCallback(async () => {
    const [permRes, nativeBg] = await Promise.all([
      getSystemNotificationPermissionState(),
      getNativeBackgroundAlertStatus(),
    ]);
    setPermissionState(permRes);
    setBgStatus(nativeBg);
  }, []);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      getSystemNotificationPermissionState(),
      getNativeBackgroundAlertStatus(),
    ]).then(([permRes, nativeBg]) => {
      if (mounted) {
        setPermissionState(permRes);
        setBgStatus(nativeBg);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const persistPrefs = useCallback(
    (next: UserNotificationPreferences) => {
      const saved = saveNotificationPreferences(next);
      setPrefs(saved);
      onNotificationPreferencesChange?.(saved);
      return saved;
    },
    [onNotificationPreferencesChange],
  );

  const handleToggleMasterNotifications = useCallback(() => {
    void safeAction(
      async () => {
        const nextEnabled = !prefs.masterEnabled;
        const saved = persistPrefs({
          ...prefs,
          masterEnabled: nextEnabled,
        });
        setStatusFeedback(
          nextEnabled
            ? 'Central de alertas ativada pelo usuário.'
            : 'Notificações desativadas globalmente.',
        );
        onToast?.({
          type: nextEnabled ? 'success' : 'info',
          title: nextEnabled
            ? 'Notificações ativadas'
            : 'Notificações pausadas globalmente',
          message: nextEnabled
            ? 'Alertas respeitarão suas janelas horárias e regras ativas.'
            : 'Nenhum alerta automático ou personalizado será disparado.',
        });
        return saved;
      },
      {
        actionKey: 'settings-toggle-master-notifications',
        moduleName: 'SettingsTab',
        onToast,
        onErrorLog,
      },
    );
  }, [onErrorLog, onToast, persistPrefs, prefs]);

  const handleAuthorizeDeviceNotifications = useCallback(() => {
    void safeAction(
      async () => {
        const result = await requestSystemNotificationPermission();
        setPermissionState(result);
        void refreshNativeBgStatus();

        if (result === 'granted') {
          if (!prefs.masterEnabled) {
            persistPrefs({ ...prefs, masterEnabled: true });
          }
          setStatusFeedback('Permissão concedida no dispositivo.');
          onToast?.({
            type: 'success',
            title: 'Notificações autorizadas no dispositivo',
            message: 'Canal operacional pronto para alertas em campo.',
          });
        } else if (result === 'denied') {
          setStatusFeedback(
            'Permissão negada no sistema operacional. Libere nas configurações do aparelho/navegador.',
          );
          onToast?.({
            type: 'warning',
            title: 'Permissão de notificação bloqueada',
            message: 'Ative as notificações nas configurações do Android ou navegador.',
          });
        } else {
          setStatusFeedback(
            'API de notificações indisponível neste ambiente; alertas permanecem visíveis no painel.',
          );
          onToast?.({
            type: 'info',
            title: 'Ambiente sem suporte nativo a Push/Notification',
            message: 'Os alertas continuarão exibidos dentro do aplicativo.',
          });
        }
      },
      {
        actionKey: 'settings-authorize-notifications',
        moduleName: 'SettingsTab',
        onToast,
        onErrorLog,
      },
    );
  }, [onErrorLog, onToast, persistPrefs, prefs, refreshNativeBgStatus]);

  const handleToggleExtremeEventsAuto = useCallback(() => {
    const nextVal = !prefs.extremeEventsAutoEnabled;
    persistPrefs({
      ...prefs,
      extremeEventsAutoEnabled: nextVal,
    });
    onToast?.({
      type: 'info',
      title: nextVal
        ? 'Eventos Extremos Automáticos ativados'
        : 'Eventos Extremos Automáticos desativados',
    });
  }, [onToast, persistPrefs, prefs]);

  const handleChangeExtremeRecurrence = useCallback(
    (field: 'minPerDay' | 'urgentIntervalMinutes', value: number) => {
      if (!Number.isFinite(value)) return;
      const current = prefs.extremeAlertsRecurrence ?? {
        enabled: true,
        minPerDay: 2,
        urgentIntervalMinutes: 180,
      };
      const nextConfig = {
        enabled: true,
        minPerDay:
          field === 'minPerDay'
            ? Math.max(2, Math.min(12, Math.floor(value)))
            : Math.max(2, current.minPerDay),
        urgentIntervalMinutes:
          field === 'urgentIntervalMinutes'
            ? Math.max(15, Math.min(360, Math.floor(value)))
            : Math.max(15, current.urgentIntervalMinutes),
      };
      persistPrefs({
        ...prefs,
        extremeAlertsRecurrence: nextConfig,
      });
    },
    [persistPrefs, prefs],
  );

  const handleToggleBackgroundSyncEnabled = useCallback(() => {
    const nextEnabled = prefs.backgroundSyncEnabled === false;
    persistPrefs({
      ...prefs,
      backgroundSyncEnabled: nextEnabled,
    });
    onToast?.({
      type: nextEnabled ? 'success' : 'info',
      title: nextEnabled
        ? tr('Monitoramento em segundo plano ativado', 'Background monitoring enabled')
        : tr('Monitoramento em segundo plano pausado', 'Background monitoring paused'),
    });
  }, [onToast, persistPrefs, prefs, tr]);

  const handleOpenExactAlarmSettings = useCallback(() => {
    void safeAction(
      async () => {
        const opened = await openNativeExactAlarmSettings();
        await refreshNativeBgStatus();
        onToast?.({
          type: opened ? 'info' : 'warning',
          title: opened
            ? tr('Configurações de Alarmes Exatos abertas', 'Exact Alarm settings opened')
            : tr('Disponível apenas no APK Android', 'Available on Android APK only'),
          message: opened
            ? tr(
                'Autorize "Alarmes e lembretes" para entregas pontuais em modo economia.',
                'Allow "Alarms & reminders" for timely alerts during Doze mode.',
              )
            : tr(
                'No navegador Web/PWA, os alertas são avaliados enquanto o app está aberto.',
                'In Web/PWA browsers, alerts run while the app tab is open.',
              ),
        });
      },
      {
        actionKey: 'settings-open-exact-alarm',
        moduleName: 'SettingsTab',
        onToast,
        onErrorLog,
      },
    );
  }, [onErrorLog, onToast, refreshNativeBgStatus, tr]);

  const handleRequestBatteryExemption = useCallback(() => {
    void safeAction(
      async () => {
        const requested = await requestNativeBatteryExemption();
        await refreshNativeBgStatus();
        onToast?.({
          type: requested ? 'info' : 'warning',
          title: requested
            ? tr('Isenção de bateria solicitada', 'Battery exemption requested')
            : tr('Disponível apenas no APK Android', 'Available on Android APK only'),
          message: requested
            ? tr(
                'Permita que o FieldCast opere sem restrição de bateria para alertas com o app fechado.',
                'Allow unrestricted battery usage so FieldCast can fire alerts while closed.',
              )
            : tr(
                'No modo Web/PWA não há otimização Doze do Android.',
                'Web/PWA mode does not require Android Doze battery exemption.',
              ),
        });
      },
      {
        actionKey: 'settings-request-battery-exemption',
        moduleName: 'SettingsTab',
        onToast,
        onErrorLog,
      },
    );
  }, [onErrorLog, onToast, refreshNativeBgStatus, tr]);

  const handleToggleGlobalWindow = useCallback(() => {
    const nextVal = !prefs.globalActiveWindow.enabled;
    persistPrefs({
      ...prefs,
      globalActiveWindow: {
        ...prefs.globalActiveWindow,
        enabled: nextVal,
      },
    });
  }, [persistPrefs, prefs]);

  const handleChangeGlobalWindowTime = useCallback(
    (field: 'startHHMM' | 'endHHMM', value: string) => {
      if (!value) return;
      persistPrefs({
        ...prefs,
        globalActiveWindow: {
          ...prefs.globalActiveWindow,
          [field]: value,
        },
      });
    },
    [persistPrefs, prefs],
  );

  const handleSendTestNotification = useCallback(() => {
    void safeAction(
      async () => {
        const dispatched = await dispatchSystemNotification({
          title: 'FieldCast — Notificação Operacional de Teste',
          message:
            'Canal verificado com sucesso! Alertas meteorológicos, náuticos e de campo respeitam suas janelas horárias.',
          sourceLabel: 'FieldCast V4 (Open-Meteo / NOAA SWPC)',
          tag: `fieldcast-test-${Date.now()}`,
        });

        setStatusFeedback(
          dispatched
            ? 'Notificação de teste enviada ao sistema!'
            : 'Teste processado (autorize notificações no dispositivo para exibição na bandeja do sistema).',
        );

        onToast?.({
          type: dispatched ? 'success' : 'info',
          title: dispatched
            ? 'Notificação de teste disparada'
            : 'Simulação de teste concluída',
          message: dispatched
            ? 'Verifique a barra de notificações do Android ou navegador.'
            : 'Conceda permissão no dispositivo para receber notificações externas.',
        });
      },
      {
        actionKey: 'settings-send-test-notification',
        moduleName: 'SettingsTab',
        onToast,
        onErrorLog,
      },
    );
  }, [onErrorLog, onToast]);

  const handleStartEditRule = useCallback(
    (rule: CustomNotificationRule) => {
      const c = rule.conditions;
      const fmtVal = (
        val: number | null | undefined,
        convertFn?: (n: number) => number | null,
        decimals = 1,
      ) => {
        if (val === undefined || val === null) return '';
        const converted = convertFn ? convertFn(val) : val;
        return converted !== null ? String(Number(converted.toFixed(decimals))) : '';
      };

      setEditingRuleId(rule.id);
      setRuleDraft({
        name: rule.name,
        startHHMM: rule.timeWindow.startHHMM,
        endHHMM: rule.timeWindow.endHHMM,
        notifyFromHHMM: rule.timeWindow.notifyFromHHMM ?? '',
        minTempC: fmtVal(c.minTempC, (n) => convertTemperature(n, units.temperature)),
        maxTempC: fmtVal(c.maxTempC, (n) => convertTemperature(n, units.temperature)),
        minPrecipProbPct: fmtVal(c.minPrecipProbPct),
        maxWindKmh: fmtVal(c.maxWindKmh, (n) => convertWindSpeed(n, units.wind)),
        maxGustKmh: fmtVal(c.maxGustKmh, (n) => convertWindSpeed(n, units.wind)),
        maxCloudCoverPct: fmtVal(c.maxCloudCoverPct),
        maxWaveM: fmtVal(c.maxWaveM, (n) => convertWaveHeight(n, units.wave)),
        minTideMslM: fmtVal(c.minTideMslM, (n) => convertWaveHeight(n, units.wave), 2),
        maxTideMslM: fmtVal(c.maxTideMslM, (n) => convertWaveHeight(n, units.wave), 2),
        maxKpIndex: fmtVal(c.maxKpIndex),
        recurrenceMode: rule.recurrence?.mode ?? 'once',
        recurrenceMaxTriggers: String(rule.recurrence?.maxTriggersPerWindow ?? 2),
        recurrenceIntervalHours: String(rule.recurrence?.intervalHours ?? 3),
        customTitle: rule.customTitle,
        customMessage: rule.customMessage,
      });

      setEnabledRuleFields({
        minTempC: c.minTempC !== undefined && c.minTempC !== null,
        maxTempC: c.maxTempC !== undefined && c.maxTempC !== null,
        minPrecipProbPct: c.minPrecipProbPct !== undefined && c.minPrecipProbPct !== null,
        maxWindKmh: c.maxWindKmh !== undefined && c.maxWindKmh !== null,
        maxGustKmh: c.maxGustKmh !== undefined && c.maxGustKmh !== null,
        maxCloudCoverPct: c.maxCloudCoverPct !== undefined && c.maxCloudCoverPct !== null,
        maxWaveM: c.maxWaveM !== undefined && c.maxWaveM !== null,
        minTideMslM: c.minTideMslM !== undefined && c.minTideMslM !== null,
        maxTideMslM: c.maxTideMslM !== undefined && c.maxTideMslM !== null,
        maxKpIndex: c.maxKpIndex !== undefined && c.maxKpIndex !== null,
      });

      setIsAlertBuilderOpen(true);
      setStatusFeedback(
        tr(
          `Editando regra "${rule.name}". Ajuste os campos e clique em Salvar Alterações.`,
          `Editing rule "${rule.name}". Adjust fields and click Save Changes.`,
        ),
      );
    },
    [tr, units.temperature, units.wave, units.wind],
  );

  const handleCancelEditRule = useCallback(() => {
    setEditingRuleId(null);
    setRuleDraft(INITIAL_RULE_DRAFT);
    setEnabledRuleFields(DEFAULT_ENABLED_RULE_FIELDS);
    setStatusFeedback(null);
  }, []);

  const handleSaveCustomRule = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      void safeAction(
        async () => {
          const readNum = (key: RuleConditionKey, raw: string) =>
            enabledRuleFields[key] ? parseOptionalInputNumber(raw) : null;

          const minTempRaw = readNum('minTempC', ruleDraft.minTempC);
          const maxTempRaw = readNum('maxTempC', ruleDraft.maxTempC);
          const maxWindRaw = readNum('maxWindKmh', ruleDraft.maxWindKmh);
          const maxGustRaw = readNum('maxGustKmh', ruleDraft.maxGustKmh);
          const maxWaveRaw = readNum('maxWaveM', ruleDraft.maxWaveM);
          const minTideRaw = readNum('minTideMslM', ruleDraft.minTideMslM);
          const maxTideRaw = readNum('maxTideMslM', ruleDraft.maxTideMslM);

          const conditions: CustomNotificationConditions = {
            minTempC:
              minTempRaw !== null
                ? Number(temperatureToC(minTempRaw, units.temperature).toFixed(1))
                : null,
            maxTempC:
              maxTempRaw !== null
                ? Number(temperatureToC(maxTempRaw, units.temperature).toFixed(1))
                : null,
            minPrecipProbPct: readNum('minPrecipProbPct', ruleDraft.minPrecipProbPct),
            maxWindKmh:
              maxWindRaw !== null
                ? Number(windSpeedToKmh(maxWindRaw, units.wind).toFixed(1))
                : null,
            maxGustKmh:
              maxGustRaw !== null
                ? Number(windSpeedToKmh(maxGustRaw, units.wind).toFixed(1))
                : null,
            maxCloudCoverPct: readNum('maxCloudCoverPct', ruleDraft.maxCloudCoverPct),
            maxWaveM:
              maxWaveRaw !== null ? Number(waveHeightToM(maxWaveRaw, units.wave).toFixed(2)) : null,
            minTideMslM:
              minTideRaw !== null ? Number(waveHeightToM(minTideRaw, units.wave).toFixed(2)) : null,
            maxTideMslM:
              maxTideRaw !== null ? Number(waveHeightToM(maxTideRaw, units.wave).toFixed(2)) : null,
            maxKpIndex: readNum('maxKpIndex', ruleDraft.maxKpIndex),
          };

          const parsedMaxTriggers = parseOptionalInputNumber(ruleDraft.recurrenceMaxTriggers);
          const parsedIntervalHours = parseOptionalInputNumber(ruleDraft.recurrenceIntervalHours);
          const nextRecurrence: NotificationRecurrenceConfig =
            ruleDraft.recurrenceMode === 'once'
              ? { mode: 'once', maxTriggersPerWindow: 1 }
              : ruleDraft.recurrenceMode === 'times_per_window'
                ? {
                    mode: 'times_per_window',
                    maxTriggersPerWindow: Math.max(
                      1,
                      Math.min(24, Math.floor(parsedMaxTriggers ?? 2)),
                    ),
                  }
                : {
                    mode: 'interval_hours',
                    maxTriggersPerWindow: Math.max(
                      1,
                      Math.min(24, Math.floor(parsedMaxTriggers ?? 6)),
                    ),
                    intervalHours: Math.max(
                      1,
                      Math.min(24, Math.floor(parsedIntervalHours ?? 3)),
                    ),
                  };

          const resolvedName =
            ruleDraft.name.trim() ||
            ruleDraft.customTitle.trim() ||
            tr(
              `Alerta Personalizado #${prefs.rules.length + 1}`,
              `Custom Alert #${prefs.rules.length + 1}`,
            );

          const nextTimeWindow = {
            startHHMM: ruleDraft.startHHMM || '06:00',
            endHHMM: ruleDraft.endHHMM || '18:00',
            notifyFromHHMM: ruleDraft.notifyFromHHMM.trim() || null,
          };

          const resolvedTitle =
            ruleDraft.customTitle.trim() || `${tr('Alerta', 'Alert')}: ${resolvedName}`;
          const resolvedMessage = ruleDraft.customMessage.trim();

          const existingRule = editingRuleId
            ? prefs.rules.find((r) => r.id === editingRuleId)
            : undefined;

          if (existingRule) {
            const updatedRule: CustomNotificationRule = {
              ...existingRule,
              name: resolvedName,
              conditions,
              timeWindow: nextTimeWindow,
              recurrence: nextRecurrence,
              customTitle: resolvedTitle,
              customMessage: resolvedMessage,
            };

            persistPrefs({
              ...prefs,
              rules: prefs.rules.map((r) => (r.id === existingRule.id ? updatedRule : r)),
            });

            setEditingRuleId(null);
            setRuleDraft(INITIAL_RULE_DRAFT);
            setEnabledRuleFields(DEFAULT_ENABLED_RULE_FIELDS);
            setStatusFeedback(
              tr(
                `Alterações da regra "${updatedRule.name}" salvas com sucesso.`,
                `Changes to rule "${updatedRule.name}" saved successfully.`,
              ),
            );

            onToast?.({
              type: 'success',
              title: tr('Regra de alerta atualizada', 'Alert rule updated'),
              message: tr(
                `"${updatedRule.name}" foi atualizada com sucesso.`,
                `"${updatedRule.name}" has been updated.`,
              ),
            });
            return;
          }

          const newRule: CustomNotificationRule = {
            id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: resolvedName,
            enabled: true,
            conditions,
            timeWindow: nextTimeWindow,
            recurrence: nextRecurrence,
            customTitle: resolvedTitle,
            customMessage: resolvedMessage,
            createdAtIso: new Date().toISOString(),
            lastTriggeredIso: null,
          };

          persistPrefs({
            ...prefs,
            rules: [newRule, ...prefs.rules],
          });

          setRuleDraft(INITIAL_RULE_DRAFT);
          setEnabledRuleFields(DEFAULT_ENABLED_RULE_FIELDS);
          setStatusFeedback(
            tr(
              `Regra "${newRule.name}" salva com sucesso.`,
              `Rule "${newRule.name}" saved successfully.`,
            ),
          );

          onToast?.({
            type: 'success',
            title: tr('Regra de alerta salva', 'Alert rule saved'),
            message: tr(
              `"${newRule.name}" adicionada às suas regras personalizadas.`,
              `"${newRule.name}" added to your custom rules.`,
            ),
          });
        },
        {
          actionKey: 'settings-save-custom-rule',
          moduleName: 'SettingsTab',
          onToast,
          onErrorLog,
        },
      );
    },
    [
      editingRuleId,
      enabledRuleFields,
      onErrorLog,
      onToast,
      persistPrefs,
      prefs,
      ruleDraft,
      tr,
      units.temperature,
      units.wave,
      units.wind,
    ],
  );

  const handleToggleRuleEnabled = useCallback(
    (ruleId: string) => {
      const updatedRules = prefs.rules.map((r) =>
        r.id === ruleId ? { ...r, enabled: !r.enabled } : r,
      );
      persistPrefs({
        ...prefs,
        rules: updatedRules,
      });
    },
    [persistPrefs, prefs],
  );

  const handleDeleteRule = useCallback(
    (ruleId: string) => {
      const target = prefs.rules.find((r) => r.id === ruleId);
      const updatedRules = prefs.rules.filter((r) => r.id !== ruleId);
      persistPrefs({
        ...prefs,
        rules: updatedRules,
      });
      if (editingRuleId === ruleId) {
        setEditingRuleId(null);
        setRuleDraft(INITIAL_RULE_DRAFT);
        setEnabledRuleFields(DEFAULT_ENABLED_RULE_FIELDS);
      }
      if (target) {
        onToast?.({
          type: 'info',
          title: tr('Regra removida', 'Rule removed'),
          message: tr(`"${target.name}" foi excluída.`, `"${target.name}" was deleted.`),
        });
      }
    },
    [editingRuleId, onToast, persistPrefs, prefs, tr],
  );

  const handleToggleBackgroundGpsConsent = useCallback(() => {
    void safeAction(
      async () => {
        const nextVal = !bgGpsConsent;
        setBackgroundTrackingConsent(nextVal);
        setBgGpsConsent(nextVal);
        onBackgroundGpsConsentChange?.(nextVal);

        onToast?.({
          type: nextVal ? 'success' : 'info',
          title: nextVal
            ? 'GPS em Segundo Plano autorizado'
            : 'GPS restrito ao primeiro plano',
          message: nextVal
            ? 'Android 14+ utilizará Foreground Service com filtro de acurácia <= 20m.'
            : 'A gravação de rotas funcionará apenas com a tela visível.',
        });
      },
      {
        actionKey: 'settings-toggle-bg-gps-consent',
        moduleName: 'SettingsTab',
        onToast,
        onErrorLog,
      },
    );
  }, [bgGpsConsent, onBackgroundGpsConsentChange, onErrorLog, onToast]);

  const handleSaveQualityThresholds = useCallback(() => {
    void safeAction(
      async () => {
        const saved = saveActivityQualityThresholds(qualityDraft);
        setQualityDraft(saved);
        onActivityQualityThresholdsChange?.(saved);
        onToast?.({
          type: 'success',
          title: 'Scores operacionais atualizados',
          message: 'Limites de Campo Diário e Navegação Costeira salvos.',
        });
      },
      {
        actionKey: 'settings-save-quality-thresholds',
        moduleName: 'SettingsTab',
        onToast,
        onErrorLog,
      },
    );
  }, [onActivityQualityThresholdsChange, onErrorLog, onToast, qualityDraft]);

  const handleResetQualityThresholds = useCallback(() => {
    const saved = saveActivityQualityThresholds(DEFAULT_ACTIVITY_QUALITY_THRESHOLDS);
    setQualityDraft(saved);
    onActivityQualityThresholdsChange?.(saved);
    onToast?.({
      type: 'info',
      title: 'Scores operacionais restaurados ao padrão',
    });
  }, [onActivityQualityThresholdsChange, onToast]);

  const handleSaveSafeWindowSection = useCallback(() => {
    void safeAction(
      async () => {
        const validated = SafeWindowThresholdsSchema.parse(safeWindowDraft);
        setSafeWindowDraft(validated);
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(SAFE_WINDOW_STORAGE_KEY, JSON.stringify(validated));
          }
        } catch {
          // Ignora bloqueio de localStorage
        }
        await onSaveThresholds?.(validated);
        onToast?.({
          type: 'success',
          title: 'Janela Segura atualizada',
          message: 'Novos limites aplicados à avaliação horária de 168h.',
        });
      },
      {
        actionKey: 'settings-save-safe-window',
        moduleName: 'SettingsTab',
        errorTitle: 'Valores inválidos para Janela Segura',
        onToast,
        onErrorLog,
      },
    );
  }, [onErrorLog, onSaveThresholds, onToast, safeWindowDraft]);

  const inputBaseClass =
    'min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

  const permissionBadge =
    permissionState === 'granted'
      ? {
          label: tr('Autorizado no dispositivo', 'Authorized on device'),
          cls: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/50 dark:text-emerald-200',
        }
      : permissionState === 'denied'
        ? {
            label: tr('Bloqueado no sistema', 'Blocked by system'),
            cls: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700/60 dark:bg-rose-950/50 dark:text-rose-200',
          }
        : permissionState === 'unsupported'
          ? {
              label: tr('Alertas internos no aplicativo', 'In-app alerts only'),
              cls: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
            }
          : {
              label: tr('Aguardando autorização', 'Awaiting permission'),
              cls: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/50 dark:text-amber-200',
            };

  return (
    <div
      data-testid="settings-tab"
      className="mx-auto max-w-6xl space-y-4 pb-10 text-slate-900 dark:text-slate-100"
    >
      {/* Cabeçalho Compacto da Central */}
      <header className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300">
              <Settings className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-xl">
                {tr('Configurações Modulares & Alertas', 'Modular Settings & Alerts')}
              </h1>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                {tr(
                  'Unidades globais, permissões do dispositivo, alertas personalizados e limites operacionais.',
                  'Global units, device permissions, custom alerts, and operational limits.',
                )}
              </p>
            </div>
          </div>

          <span
            className={`inline-flex min-h-[36px] items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${permissionBadge.cls}`}
          >
            <Bell className="h-3.5 w-3.5" aria-hidden="true" />
            {permissionBadge.label}
          </span>
        </div>

        {statusFeedback && (
          <div
            role="status"
            className="mt-3 rounded-xl border border-sky-200 bg-sky-50/80 px-3.5 py-2 text-xs font-medium text-sky-900 dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-200"
          >
            {statusFeedback}
          </div>
        )}
      </header>

      {/* MÓDULO 0 — Unidades & Escalas de Exibição */}
      <CollapsibleModule
        title={tr('Unidades & Escalas de Exibição', 'Units & Display Scales')}
        subtitle={`${tr('Ativo:', 'Active:')} ${getWindUnitLabel(units.wind)} · ${getTempUnitLabel(units.temperature)} · ${getWaveUnitLabel(units.wave)}`}
        icon={<Gauge className="h-4 w-4 text-sky-600 dark:text-sky-400" />}
        defaultOpen={true}
        keepMounted={true}
        hideIconStyle="eye"
        testId="settings-units-module"
        headerActions={
          <button
            type="button"
            data-testid="reset-units-btn"
            onClick={resetUnits}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            title={tr('Restaurar unidades métricas padrão', 'Reset default metric units')}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{tr('Padrão', 'Default')}</span>
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Vento / Rajadas */}
          <div className="space-y-1.5">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Velocidade do Vento &amp; Correntes
            </span>
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  { id: 'kmh', label: 'km/h' },
                  { id: 'ms', label: 'm/s' },
                  { id: 'kt', label: 'Nós (kt)' },
                  { id: 'mph', label: 'mph' },
                ] as ReadonlyArray<{ id: WindSpeedUnit; label: string }>
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`unit-wind-${opt.id}`}
                  aria-pressed={units.wind === opt.id}
                  onClick={() => setWindUnit(opt.id)}
                  className={`min-h-[44px] rounded-xl border px-2 py-1.5 text-xs font-bold transition ${
                    units.wind === opt.id
                      ? 'border-sky-600 bg-sky-600 text-white shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Temperatura */}
          <div className="space-y-1.5">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Temperatura do Ar &amp; Orvalho
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: 'c', label: 'Celsius (°C)' },
                  { id: 'f', label: 'Fahrenheit (°F)' },
                ] as ReadonlyArray<{ id: TemperatureUnit; label: string }>
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`unit-temp-${opt.id}`}
                  aria-pressed={units.temperature === opt.id}
                  onClick={() => setTemperatureUnit(opt.id)}
                  className={`min-h-[44px] rounded-xl border px-2 py-1.5 text-xs font-bold transition ${
                    units.temperature === opt.id
                      ? 'border-sky-600 bg-sky-600 text-white shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Ondas, Pressão e Precipitação */}
          <div className="space-y-1.5">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Ondas, Pressão &amp; Chuva
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                {(['m', 'ft'] as ReadonlyArray<WaveHeightUnit>).map((u) => (
                  <button
                    key={u}
                    type="button"
                    data-testid={`unit-wave-${u}`}
                    aria-pressed={units.wave === u}
                    onClick={() => setWaveUnit(u)}
                    className={`min-h-[44px] flex-1 text-xs font-bold ${
                      units.wave === u
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>

              <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                {(['hpa', 'inhg'] as ReadonlyArray<PressureUnit>).map((u) => (
                  <button
                    key={u}
                    type="button"
                    data-testid={`unit-pressure-${u}`}
                    aria-pressed={units.pressure === u}
                    onClick={() => setPressureUnit(u)}
                    className={`min-h-[44px] flex-1 text-[11px] font-bold ${
                      units.pressure === u
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {u === 'hpa' ? 'hPa' : 'inHg'}
                  </button>
                ))}
              </div>

              <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                {(['mm', 'in'] as ReadonlyArray<PrecipitationUnit>).map((u) => (
                  <button
                    key={u}
                    type="button"
                    data-testid={`unit-precip-${u}`}
                    aria-pressed={units.precipitation === u}
                    onClick={() => setPrecipitationUnit(u)}
                    className={`min-h-[44px] flex-1 text-xs font-bold ${
                      units.precipitation === u
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CollapsibleModule>

      {/* MÓDULO 1 — Permissões Gerais, Notificações, GPS & Aparência */}
      <CollapsibleModule
        title="1. Permissões Gerais, Notificações & Sensores"
        subtitle="Chave opt-in de alertas, janela de silêncio, eventos extremos, GPS Android 14+ e tema"
        icon={<BellRing className="h-4 w-4 text-sky-600 dark:text-sky-400" />}
        defaultOpen={false}
        keepMounted={true}
        hideIconStyle="eye"
        testId="settings-permissions-module"
        badge={prefs.masterEnabled ? 'Alertas ON' : 'Alertas OFF'}
      >
        <div className="space-y-4">
          {/* Master Opt-in Switch */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
            <div className="max-w-xl">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Ativar Central de Notificações FieldCast (Chave Geral Opt-In)
              </p>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                Desativada por padrão por respeito à sua atenção. Ligue quando desejar receber
                alertas extremos ou regras customizadas.
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={prefs.masterEnabled}
              data-testid="notifications-master-toggle"
              onClick={handleToggleMasterNotifications}
              className={`inline-flex min-h-[44px] min-w-[132px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                prefs.masterEnabled
                  ? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {prefs.masterEnabled ? 'Ativado' : 'Desativado'}
            </button>
          </div>

          {/* Botões de Autorização Nativa/Web e Teste */}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              data-testid="authorize-device-notifications-btn"
              onClick={handleAuthorizeDeviceNotifications}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Autorizar Notificações no Dispositivo
            </button>

            <button
              type="button"
              data-testid="send-test-notification-btn"
              onClick={handleSendTestNotification}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              Enviar Notificação de Teste
            </button>
          </div>

          {/* Toggle Eventos Extremos Automáticos + Frequência Diária (>= 2x/dia) */}
          <div className="space-y-3 rounded-xl border border-amber-200/80 bg-amber-50/50 p-4 dark:border-amber-800/50 dark:bg-amber-950/20">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="max-w-xl">
                <div className="flex items-center gap-2">
                  <AlertTriangle
                    className="h-4 w-4 text-amber-600 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {tr('Avisar Automaticamente Eventos Extremos', 'Auto-Alert Extreme Events')}
                  </p>
                </div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {tr(
                    'Emite alertas severos (tempestades elétricas, vendavais, ressaca costeira, queda barométrica e tempestade geomagnética Kp >= 5) sempre com atribuição explícita da fonte oficial (Open-Meteo, NOAA SWPC; cota MSL ~8 km não substitui DHN/Marinha).',
                    'Dispatches severe hazard warnings (thunderstorms, gales, coastal swell, pressure drops, and Kp >= 5 geomagnetic storms) with official source attribution (Open-Meteo, NOAA SWPC; ~8 km MSL does not replace DHN/Navy tables).',
                  )}
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={prefs.extremeEventsAutoEnabled}
                data-testid="extreme-events-auto-toggle"
                onClick={handleToggleExtremeEventsAuto}
                className={`inline-flex min-h-[44px] min-w-[132px] items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  prefs.extremeEventsAutoEnabled
                    ? 'bg-amber-600 text-white hover:bg-amber-700'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                {prefs.extremeEventsAutoEnabled ? 'Automático ON' : 'Automático OFF'}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-amber-200/70 pt-3 sm:grid-cols-2 dark:border-amber-800/40">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                {tr(
                  'Reforço Diário de Eventos Extremos (mín. 2x/dia)',
                  'Extreme Events Daily Frequency (min 2x/day)',
                )}
                <NumericInput
                  data-testid="extreme-recurrence-min-per-day"
                  min={2}
                  max={12}
                  step={1}
                  allowEmpty={false}
                  fallbackValue={prefs.extremeAlertsRecurrence?.minPerDay ?? 2}
                  disabled={!prefs.extremeEventsAutoEnabled}
                  value={prefs.extremeAlertsRecurrence?.minPerDay ?? 2}
                  onValueChange={(_, num) => {
                    if (num !== null) {
                      handleChangeExtremeRecurrence('minPerDay', num);
                    }
                  }}
                  className={`mt-1 ${inputBaseClass} ${!prefs.extremeEventsAutoEnabled ? 'opacity-50' : ''}`}
                />
              </label>

              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                {tr(
                  'Intervalo entre Reforços Urgentes (minutos)',
                  'Urgent Reminder Interval (minutes)',
                )}
                <NumericInput
                  data-testid="extreme-recurrence-interval-minutes"
                  min={15}
                  max={360}
                  step={15}
                  allowEmpty={false}
                  fallbackValue={prefs.extremeAlertsRecurrence?.urgentIntervalMinutes ?? 180}
                  disabled={!prefs.extremeEventsAutoEnabled}
                  value={prefs.extremeAlertsRecurrence?.urgentIntervalMinutes ?? 180}
                  onValueChange={(_, num) => {
                    if (num !== null) {
                      handleChangeExtremeRecurrence('urgentIntervalMinutes', num);
                    }
                  }}
                  className={`mt-1 ${inputBaseClass} ${!prefs.extremeEventsAutoEnabled ? 'opacity-50' : ''}`}
                />
              </label>
            </div>
          </div>

          {/* Notificações em Segundo Plano (Android Nativo & Diagnóstico Web/PWA) */}
          <div
            data-testid="background-alerts-panel"
            className="space-y-3 rounded-xl border border-sky-200/90 bg-sky-50/40 p-4 dark:border-sky-800/60 dark:bg-sky-950/25"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-xl space-y-1">
                <div className="flex items-center gap-2">
                  <Smartphone
                    className="h-4 w-4 text-sky-600 dark:text-sky-400"
                    aria-hidden="true"
                  />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {tr(
                      'Notificações em Segundo Plano (Android)',
                      'Background Notifications (Android)',
                    )}
                  </h3>
                  <HelpPopover topic="background_alerts_android" align="right" />
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {tr(
                    'Agenda alarmes locais e verificação periódica no Android para disparar alertas meteorológicos e de maré MSL mesmo com o app fechado.',
                    'Schedules native Android alarms and periodic background checks to fire weather and MSL tide alerts even when the app is closed.',
                  )}
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={prefs.backgroundSyncEnabled !== false}
                data-testid="background-sync-enabled-toggle"
                onClick={handleToggleBackgroundSyncEnabled}
                className={`inline-flex min-h-[44px] min-w-[128px] items-center justify-center rounded-xl px-4 py-2 text-xs font-bold transition ${
                  prefs.backgroundSyncEnabled !== false
                    ? 'bg-sky-600 text-white hover:bg-sky-700'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                {prefs.backgroundSyncEnabled !== false
                  ? tr('Vigília Ativa', 'Watch Active')
                  : tr('Vigília Pausada', 'Watch Paused')}
              </button>
            </div>

            {/* Indicadores de Status Nativo / Web */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/80">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {tr('Permissão Notificações', 'Notification Permission')}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    bgStatus.notificationsGranted || permissionState === 'granted'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                  }`}
                >
                  {bgStatus.notificationsGranted || permissionState === 'granted'
                    ? tr('OK', 'OK')
                    : tr('Pendente', 'Pending')}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/80">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {tr('Alarmes Exatos', 'Exact Alarms')}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    !bgStatus.supported
                      ? 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      : bgStatus.exactAlarmAllowed
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                  }`}
                >
                  {!bgStatus.supported
                    ? tr('Web/PWA', 'Web/PWA')
                    : bgStatus.exactAlarmAllowed
                      ? tr('Permitido', 'Allowed')
                      : tr('Opcional', 'Optional')}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/80">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {tr('Isenção de Bateria', 'Battery Exemption')}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    !bgStatus.supported
                      ? 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      : bgStatus.ignoringBatteryOptimizations
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                  }`}
                >
                  {!bgStatus.supported
                    ? tr('Web/PWA', 'Web/PWA')
                    : bgStatus.ignoringBatteryOptimizations
                      ? tr('Isento', 'Exempt')
                      : tr('Otimizado', 'Optimized')}
                </span>
              </div>
            </div>

            {/* Ações Guiadas */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="bg-alerts-request-permission-btn"
                onClick={handleAuthorizeDeviceNotifications}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-sky-700"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                {tr('Permitir Notificações', 'Allow Notifications')}
              </button>

              <button
                type="button"
                data-testid="bg-alerts-exact-alarm-btn"
                onClick={handleOpenExactAlarmSettings}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <AlarmClock className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                {tr('Configurar Alarmes Exatos', 'Exact Alarm Settings')}
              </button>

              <button
                type="button"
                data-testid="bg-alerts-battery-exemption-btn"
                onClick={handleRequestBatteryExemption}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <BatteryCharging
                  className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
                {tr('Isentar Otimização de Bateria', 'Disable Battery Optimization')}
              </button>
            </div>

            {!bgStatus.supported && (
              <p className="rounded-lg border border-slate-200 bg-white/75 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                <strong>{tr('Modo Navegador (Web/PWA):', 'Browser Mode (Web/PWA):')}</strong>{' '}
                {tr(
                  'Sem servidor backend pago, navegadores desktop/mobile avaliam alertas apenas enquanto o aplicativo permanece aberto. Instale o APK Android nativo para monitoramento contínuo via AlarmManager e WorkManager com o app fechado.',
                  'With our 100% backend-less architecture, desktop/mobile browsers evaluate alerts while the app tab stays open. Install the native Android APK for continuous AlarmManager + WorkManager monitoring while closed.',
                )}
              </p>
            )}
          </div>

          {/* Janela Horária Global */}
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Janela Horária Global (Silêncio Fora do Horário Permitido)
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Suporta faixas diurnas (06:00–22:00) e faixas que cruzam a meia-noite
                    (22:00–06:00).
                  </p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={prefs.globalActiveWindow.enabled}
                data-testid="global-window-enabled-toggle"
                onClick={handleToggleGlobalWindow}
                className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-xs font-semibold transition ${
                  prefs.globalActiveWindow.enabled
                    ? 'bg-sky-600 text-white hover:bg-sky-700'
                    : 'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                Ativar horário permitido: {prefs.globalActiveWindow.enabled ? 'Sim' : 'Não'}
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Início HH:MM
                <input
                  type="time"
                  data-testid="global-window-start"
                  value={prefs.globalActiveWindow.startHHMM}
                  onChange={(e) => handleChangeGlobalWindowTime('startHHMM', e.target.value)}
                  className={`mt-1 ${inputBaseClass}`}
                />
              </label>

              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Fim HH:MM
                <input
                  type="time"
                  data-testid="global-window-end"
                  value={prefs.globalActiveWindow.endHHMM}
                  onChange={(e) => handleChangeGlobalWindowTime('endHHMM', e.target.value)}
                  className={`mt-1 ${inputBaseClass}`}
                />
              </label>
            </div>
          </div>

          {/* Permissões GPS Android 14+ & Tema Visual */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="max-w-md">
                <div className="flex items-center gap-2">
                  <Navigation
                    className="h-4 w-4 text-sky-600 dark:text-sky-400"
                    aria-hidden="true"
                  />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    GPS em Segundo Plano (Android 14+ Foreground Service)
                  </h3>
                </div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  Mantém gravação contínua de rota com filtro estrito de acurácia &le; 20 m.
                  Altitude topográfica permanece estritamente DEM Open-Meteo.
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={bgGpsConsent}
                data-testid="background-gps-consent-toggle"
                onClick={handleToggleBackgroundGpsConsent}
                className={`inline-flex min-h-[44px] min-w-[128px] items-center justify-center rounded-xl px-4 py-2 text-xs font-bold transition ${
                  bgGpsConsent
                    ? 'bg-sky-600 text-white hover:bg-sky-700'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                {bgGpsConsent ? 'Permitido' : 'Apenas Tela Ativa'}
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
              <div>
                <div className="flex items-center gap-2">
                  {activeTheme === 'dark' ? (
                    <Moon className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                  ) : (
                    <Sun className="h-4 w-4 text-amber-500" aria-hidden="true" />
                  )}
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Tema Visual da Interface
                  </h3>
                </div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  Alterne entre alto contraste diurno (Claro) e preservação noturna (Escuro).
                </p>
              </div>

              <button
                type="button"
                data-testid="settings-theme-toggle"
                onClick={handleThemeSwitch}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-800 shadow-sm transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                {activeTheme === 'dark' ? (
                  <>
                    <Sun className="h-4 w-4 text-amber-400" aria-hidden="true" />
                    Mudar para Tema Claro
                  </>
                ) : (
                  <>
                    <Moon className="h-4 w-4 text-indigo-600" aria-hidden="true" />
                    Mudar para Tema Escuro
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </CollapsibleModule>

      {/* MÓDULO 2 — Construtor de Alerta Personalizado (com Checkboxes Opcionais) */}
      <CollapsibleModule
        title={
          editingRuleId
            ? tr('2. Editando Alerta Personalizado', '2. Editing Custom Alert')
            : tr('2. Construtor de Alerta Personalizado & Janela Horária', '2. Custom Alert Builder & Time Window')
        }
        subtitle={tr(
          'Marque apenas os parâmetros que deseja monitorar (itens desmarcados são ignorados)',
          'Check only the parameters you want to monitor (unchecked items are ignored)',
        )}
        icon={<Plus className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
        isOpen={isAlertBuilderOpen}
        onOpenChange={setIsAlertBuilderOpen}
        keepMounted={true}
        hideIconStyle="eye"
        testId="settings-alert-builder-module"
        headerActions={<HelpPopover topic="alerts_builder_help" align="right" />}
      >
        <form
          data-testid="custom-alert-form"
          onSubmit={handleSaveCustomRule}
          className="space-y-4"
        >
          {/* Nome + Janela Horária da Regra */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 sm:col-span-2 lg:col-span-1">
              Nome da Regra
              <input
                type="text"
                data-testid="rule-name-input"
                placeholder="Ex.: Pulverização / Travessia Baía"
                value={ruleDraft.name}
                onChange={(e) => setRuleDraft((d) => ({ ...d, name: e.target.value }))}
                className={`mt-1 ${inputBaseClass}`}
              />
            </label>

            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Início da Janela (HH:MM)
              <input
                type="time"
                data-testid="rule-window-start"
                value={ruleDraft.startHHMM}
                onChange={(e) => setRuleDraft((d) => ({ ...d, startHHMM: e.target.value }))}
                className={`mt-1 ${inputBaseClass}`}
              />
            </label>

            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Fim da Janela (HH:MM)
              <input
                type="time"
                data-testid="rule-window-end"
                value={ruleDraft.endHHMM}
                onChange={(e) => setRuleDraft((d) => ({ ...d, endHHMM: e.target.value }))}
                className={`mt-1 ${inputBaseClass}`}
              />
            </label>

            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Avisar a partir das (opcional)
              <input
                type="time"
                data-testid="rule-notify-from"
                value={ruleDraft.notifyFromHHMM}
                onChange={(e) => setRuleDraft((d) => ({ ...d, notifyFromHHMM: e.target.value }))}
                className={`mt-1 ${inputBaseClass}`}
              />
            </label>
          </div>

          {/* Limiares Meteorológicos, Oceanográficos e Geomagnéticos (com checkboxes) */}
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              Parâmetros Monitorados (marque a caixinha para ativar cada condição):
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  {
                    key: 'minTempC',
                    label: `Temp Mín (${getTempUnitLabel(units.temperature)})`,
                    testId: 'rule-min-temp',
                    step: '0.5',
                    placeholder: units.temperature === 'f' ? 'Ex.: 57' : 'Ex.: 14',
                  },
                  {
                    key: 'maxTempC',
                    label: `Temp Máx (${getTempUnitLabel(units.temperature)})`,
                    testId: 'rule-max-temp',
                    step: '0.5',
                    placeholder: units.temperature === 'f' ? 'Ex.: 90' : 'Ex.: 32',
                  },
                  {
                    key: 'minPrecipProbPct',
                    label: 'Prob. Chuva (%)',
                    testId: 'rule-min-precip-prob',
                    step: '1',
                    min: '0',
                    max: '100',
                    placeholder: 'Ex.: 50',
                  },
                  {
                    key: 'maxWindKmh',
                    label: `Vento Máx (${getWindUnitLabel(units.wind)})`,
                    testId: 'rule-max-wind',
                    step: '1',
                    min: '0',
                    placeholder: 'Ex.: 28',
                  },
                  {
                    key: 'maxGustKmh',
                    label: `Rajada Máx (${getWindUnitLabel(units.wind)})`,
                    testId: 'rule-max-gust',
                    step: '1',
                    min: '0',
                    placeholder: 'Ex.: 45',
                  },
                  {
                    key: 'maxCloudCoverPct',
                    label: 'Nebulosidade (%)',
                    testId: 'rule-max-cloud',
                    step: '1',
                    min: '0',
                    max: '100',
                    placeholder: 'Ex.: 85',
                  },
                  {
                    key: 'maxWaveM',
                    label: `Onda Máx (${getWaveUnitLabel(units.wave)})`,
                    testId: 'rule-max-wave',
                    step: '0.1',
                    min: '0',
                    placeholder: 'Ex.: 1.8',
                  },
                  {
                    key: 'minTideMslM',
                    label: `${tr('Maré MSL Mín', 'Min MSL Tide')} (${getWaveUnitLabel(units.wave)})`,
                    testId: 'rule-min-tide-input',
                    step: '0.1',
                    placeholder: units.wave === 'ft' ? 'Ex.: -1.0' : 'Ex.: -0.3',
                  },
                  {
                    key: 'maxTideMslM',
                    label: `${tr('Maré MSL Máx', 'Max MSL Tide')} (${getWaveUnitLabel(units.wave)})`,
                    testId: 'rule-max-tide-input',
                    step: '0.1',
                    placeholder: units.wave === 'ft' ? 'Ex.: 3.5' : 'Ex.: 1.1',
                  },
                  {
                    key: 'maxKpIndex',
                    label: 'Kp Máx (0–9)',
                    testId: 'rule-max-kp',
                    step: '0.5',
                    min: '0',
                    max: '9',
                    placeholder: 'Ex.: 4.5',
                  },
                ] as ReadonlyArray<{
                  key: RuleConditionKey;
                  label: string;
                  testId: string;
                  step: string;
                  min?: string;
                  max?: string;
                  placeholder: string;
                }>
              ).map((field) => {
                const isChecked = enabledRuleFields[field.key];
                const allowsNegative =
                  field.key === 'minTempC' ||
                  field.key === 'maxTempC' ||
                  field.key === 'minTideMslM' ||
                  field.key === 'maxTideMslM';
                return (
                  <div
                    key={field.key}
                    className={`rounded-xl border p-2.5 transition ${
                      isChecked
                        ? 'border-sky-300 bg-sky-50/40 dark:border-sky-700/70 dark:bg-sky-950/20'
                        : 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-950/40'
                    }`}
                  >
                    <label className="flex items-center justify-between gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                      <span>{field.label}</span>
                      <input
                        type="checkbox"
                        data-testid={`enable-${field.testId}`}
                        checked={isChecked}
                        onChange={(e) =>
                          setEnabledRuleFields((prev) => ({
                            ...prev,
                            [field.key]: e.target.checked,
                          }))
                        }
                        className="h-4 w-4 accent-sky-600 rounded"
                      />
                    </label>
                    <NumericInput
                      step={Number(field.step)}
                      min={field.min !== undefined ? Number(field.min) : undefined}
                      max={field.max !== undefined ? Number(field.max) : undefined}
                      allowNegative={allowsNegative}
                      allowEmpty={true}
                      data-testid={field.testId}
                      placeholder={field.placeholder}
                      value={ruleDraft[field.key]}
                      onValueChange={(val) => {
                        setRuleDraft((d) => ({ ...d, [field.key]: val }));
                        setEnabledRuleFields((prev) => ({
                          ...prev,
                          [field.key]: val.trim().length > 0,
                        }));
                      }}
                      className={`mt-1.5 ${inputBaseClass} ${!isChecked ? 'opacity-65' : ''}`}
                    />
                  </div>
                );
              })}
            </div>

            {/* Aviso Obrigatório DHN / Marinha do Brasil para Alertas de Maré MSL */}
            <div
              data-testid="tide-alerts-dhn-disclaimer"
              className="mt-3 flex items-start justify-between gap-2 rounded-xl border border-amber-300/80 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-100"
            >
              <div className="flex items-start gap-2">
                <Waves className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <p>
                  <strong>{tr('Maré Estimada (MSL ~8 km):', 'Estimated Tide (MSL ~8 km):')}</strong>{' '}
                  {tr(DHN_TIDE_DISCLAIMER_PT, DHN_TIDE_DISCLAIMER_EN)}{' '}
                  {tr(
                    'Coordenadas continentais ignoram limites de maré com segurança.',
                    'Continental coordinates safely ignore tide thresholds.',
                  )}
                </p>
              </div>
              <HelpPopover topic="tide_alerts_dhn" align="right" />
            </div>
          </div>

          {/* Recorrência da Notificação */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-950/50">
            <div className="mb-2 flex items-center gap-2">
              <Repeat className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                {tr('Recorrência da Notificação', 'Notification Recurrence')}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {tr('Modo de Repetição', 'Repeat Mode')}
                <select
                  data-testid="rule-recurrence-mode"
                  value={ruleDraft.recurrenceMode}
                  onChange={(e) =>
                    setRuleDraft((d) => ({
                      ...d,
                      recurrenceMode: e.target.value as NotificationRecurrenceConfig['mode'],
                    }))
                  }
                  className={`mt-1 ${inputBaseClass}`}
                >
                  <option value="once">{tr('1x na janela', '1x per window')}</option>
                  <option value="times_per_window">
                    {tr('N vezes na janela', 'N times per window')}
                  </option>
                  <option value="interval_hours">
                    {tr('A cada N horas', 'Every N hours')}
                  </option>
                </select>
              </label>

              {ruleDraft.recurrenceMode !== 'once' && (
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {tr('Máximo de disparos na janela (1–24)', 'Max triggers per window (1–24)')}
                  <NumericInput
                    data-testid="rule-recurrence-max-triggers"
                    min={1}
                    max={24}
                    step={1}
                    allowEmpty={false}
                    fallbackValue={2}
                    value={ruleDraft.recurrenceMaxTriggers}
                    onValueChange={(val) =>
                      setRuleDraft((d) => ({ ...d, recurrenceMaxTriggers: val }))
                    }
                    className={`mt-1 ${inputBaseClass}`}
                  />
                </label>
              )}

              {ruleDraft.recurrenceMode === 'interval_hours' && (
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {tr('Intervalo entre alertas (horas)', 'Interval between alerts (hours)')}
                  <NumericInput
                    data-testid="rule-recurrence-interval-hours"
                    min={1}
                    max={24}
                    step={1}
                    allowEmpty={false}
                    fallbackValue={3}
                    value={ruleDraft.recurrenceIntervalHours}
                    onValueChange={(val) =>
                      setRuleDraft((d) => ({ ...d, recurrenceIntervalHours: val }))
                    }
                    className={`mt-1 ${inputBaseClass}`}
                  />
                </label>
              )}
            </div>
          </div>

          {/* Título e Mensagem Customizáveis */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Título Personalizado da Notificação
              <input
                type="text"
                data-testid="rule-custom-title"
                placeholder="Ex.: Hora de recolher VANT ({hour})"
                value={ruleDraft.customTitle}
                onChange={(e) => setRuleDraft((d) => ({ ...d, customTitle: e.target.value }))}
                className={`mt-1 ${inputBaseClass}`}
              />
            </label>

            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Mensagem Personalizada
              <input
                type="text"
                data-testid="rule-custom-message"
                placeholder="Variáveis opcionais: {hour}, {window}, {temp}, {wind}, {gust}, {precipProb}, {wave}, {tide}, {kp}"
                value={ruleDraft.customMessage}
                onChange={(e) => setRuleDraft((d) => ({ ...d, customMessage: e.target.value }))}
                className={`mt-1 ${inputBaseClass}`}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Dica: Você pode usar tags dinâmicas como <code>{'{hour}'}</code>,{' '}
              <code>{'{wind}'}</code>, <code>{'{wave}'}</code>, <code>{'{tide}'}</code> e{' '}
              <code>{'{details}'}</code>.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {editingRuleId && (
                <button
                  type="button"
                  data-testid="cancel-edit-rule-btn"
                  onClick={handleCancelEditRule}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  {tr('Cancelar Edição', 'Cancel Edit')}
                </button>
              )}

              <button
                type="submit"
                data-testid="save-custom-rule-btn"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                {editingRuleId ? (
                  <>
                    <Save className="h-4 w-4" aria-hidden="true" />
                    {tr('Salvar Alterações', 'Save Changes')}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {tr('Salvar Regra de Alerta', 'Save Alert Rule')}
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </CollapsibleModule>

      {/* MÓDULO 3 — Regras Personalizadas Salvas */}
      <CollapsibleModule
        title={tr('3. Regras Personalizadas Salvas', '3. Saved Custom Rules')}
        subtitle={tr(
          'Ative, edite, pause ou remova alertas configurados para sua operação',
          'Enable, edit, pause, or remove alerts configured for your operation',
        )}
        icon={<Bell className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
        defaultOpen={true}
        keepMounted={true}
        hideIconStyle="eye"
        testId="settings-saved-rules-module"
        badge={`${prefs.rules.length}`}
      >
        {prefs.rules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {tr(
              'Nenhuma regra personalizada cadastrada. Crie no Construtor acima ou ative um modelo pronto na Central de Ajuda (?).',
              'No custom rules registered yet. Create one in the Builder above or activate a ready template in the Help Center (?).',
            )}
          </p>
        ) : (
          <ul data-testid="saved-rules-list" className="space-y-3">
            {prefs.rules.map((rule) => {
              const chips = formatRuleConditionChips(rule.conditions, units);
              const isEditingThis = editingRuleId === rule.id;
              return (
                <li
                  key={rule.id}
                  data-testid={`saved-rule-${rule.id}`}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5 transition ${
                    isEditingThis
                      ? 'border-sky-500 bg-sky-50/70 dark:border-sky-500 dark:bg-sky-950/30'
                      : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/60'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {rule.name}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          rule.enabled
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {rule.enabled ? tr('Ativa', 'Active') : tr('Pausada', 'Paused')}
                      </span>
                      <span className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        {tr('Janela', 'Window')} {rule.timeWindow.startHHMM}–{rule.timeWindow.endHHMM}
                        {rule.timeWindow.notifyFromHHMM
                          ? ` • ${tr('Avisar das', 'Notify from')} ${rule.timeWindow.notifyFromHHMM}`
                          : ''}
                      </span>
                      <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-800 dark:border-indigo-800/70 dark:bg-indigo-950/50 dark:text-indigo-200">
                        {formatRuleRecurrenceLabel(rule.recurrence, tr)}
                      </span>
                      {((rule.conditions.minTideMslM !== undefined &&
                        rule.conditions.minTideMslM !== null) ||
                        (rule.conditions.maxTideMslM !== undefined &&
                          rule.conditions.maxTideMslM !== null)) && (
                        <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/50 dark:text-amber-200">
                          {tr('MSL ~8 km ≠ DHN', 'MSL ~8 km ≠ DHN')}
                        </span>
                      )}
                    </div>

                    {chips.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {chips.map((chip) => (
                          <span
                            key={chip}
                            className="rounded bg-sky-100/80 px-2 py-0.5 text-[11px] font-medium text-sky-900 dark:bg-sky-950/60 dark:text-sky-200"
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    )}

                    <p className="mt-1.5 truncate text-xs text-slate-600 dark:text-slate-400">
                      <strong>{rule.customTitle}</strong>
                      {rule.customMessage ? ` — ${rule.customMessage}` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid={`edit-rule-${rule.id}`}
                      onClick={() => handleStartEditRule(rule)}
                      aria-label={tr(`Editar regra ${rule.name}`, `Edit rule ${rule.name}`)}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 transition hover:bg-sky-100 dark:border-sky-800/70 dark:bg-sky-950/40 dark:text-sky-200 dark:hover:bg-sky-900/60"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      {tr('Editar', 'Edit')}
                    </button>

                    <button
                      type="button"
                      data-testid={`toggle-rule-${rule.id}`}
                      onClick={() => handleToggleRuleEnabled(rule.id)}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      {rule.enabled ? tr('Desativar', 'Pause') : tr('Ativar', 'Enable')}
                    </button>

                    <button
                      type="button"
                      aria-label={tr(`Excluir regra ${rule.name}`, `Delete rule ${rule.name}`)}
                      data-testid={`delete-rule-${rule.id}`}
                      onClick={() => handleDeleteRule(rule.id)}
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/70"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleModule>

      {/* MÓDULO 4 — Limiares Opcionais dos Scores & Janela Segura (168h) */}
      <CollapsibleModule
        title={tr(
          '4. Limiares Opcionais dos Scores & Janela Segura (168h)',
          '4. Optional Score Thresholds & Safe Window (168h)',
        )}
        subtitle="Desmarque qualquer parâmetro para ignorá-lo nos scores de Campo, Navegação e Semáforo"
        icon={<Sliders className="h-4 w-4 text-sky-600 dark:text-sky-400" />}
        defaultOpen={false}
        keepMounted={true}
        hideIconStyle="eye"
        testId="settings-scores-module"
      >
        <div className="space-y-5">
          {/* Sub-bloco 5.1: Scores de Qualidade por Atividade */}
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Compass className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Limiares dos Scores de Qualidade (Campo Diário &amp; Navegação Costeira)
                </h3>
              </div>
              <button
                type="button"
                onClick={handleResetQualityThresholds}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Restaurar Padrão
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Campo Diário */}
              <div className="space-y-2 rounded-xl bg-slate-50/80 p-3.5 dark:bg-slate-950/60">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  Operação Diária &amp; Campo (Opcional por item)
                </p>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {(
                    [
                      {
                        key: 'idealMinTempC',
                        label: `Temp Ideal Mín (${getTempUnitLabel(units.temperature)})`,
                        display: Number(
                          (
                            convertTemperature(qualityDraft.dailyField.idealMinTempC, units.temperature) ??
                            qualityDraft.dailyField.idealMinTempC
                          ).toFixed(1),
                        ),
                        onChangeVal: (v: number) =>
                          Number(temperatureToC(v, units.temperature).toFixed(1)),
                      },
                      {
                        key: 'idealMaxTempC',
                        label: `Temp Ideal Máx (${getTempUnitLabel(units.temperature)})`,
                        display: Number(
                          (
                            convertTemperature(qualityDraft.dailyField.idealMaxTempC, units.temperature) ??
                            qualityDraft.dailyField.idealMaxTempC
                          ).toFixed(1),
                        ),
                        onChangeVal: (v: number) =>
                          Number(temperatureToC(v, units.temperature).toFixed(1)),
                      },
                      {
                        key: 'maxWindKmh',
                        label: `Vento Máx (${getWindUnitLabel(units.wind)})`,
                        display: Number(
                          (
                            convertWindSpeed(qualityDraft.dailyField.maxWindKmh, units.wind) ??
                            qualityDraft.dailyField.maxWindKmh
                          ).toFixed(1),
                        ),
                        onChangeVal: (v: number) => Number(windSpeedToKmh(v, units.wind).toFixed(1)),
                      },
                      {
                        key: 'maxGustKmh',
                        label: `Rajada Máx (${getWindUnitLabel(units.wind)})`,
                        display: Number(
                          (
                            convertWindSpeed(qualityDraft.dailyField.maxGustKmh, units.wind) ??
                            qualityDraft.dailyField.maxGustKmh
                          ).toFixed(1),
                        ),
                        onChangeVal: (v: number) => Number(windSpeedToKmh(v, units.wind).toFixed(1)),
                      },
                      {
                        key: 'maxPrecipProbPct',
                        label: 'Prob. Chuva (%)',
                        display: qualityDraft.dailyField.maxPrecipProbPct,
                        onChangeVal: (v: number) => v,
                      },
                      {
                        key: 'maxCapeJkg',
                        label: 'CAPE Máx (J/kg)',
                        step: 50,
                        display: qualityDraft.dailyField.maxCapeJkg,
                        onChangeVal: (v: number) => v,
                      },
                    ] as ReadonlyArray<{
                      key: DailyFieldThresholdKey;
                      label: string;
                      step?: number;
                      display: number;
                      onChangeVal: (v: number) => number;
                    }>
                  ).map((item) => {
                    const checked = qualityDraft.enabledDailyField?.[item.key] ?? true;
                    return (
                      <div key={item.key} className="text-xs text-slate-700 dark:text-slate-300">
                        <label className="flex items-center justify-between gap-1.5 cursor-pointer">
                          <span className="truncate">{item.label}</span>
                          <input
                            type="checkbox"
                            data-testid={`toggle-daily-${item.key}`}
                            checked={checked}
                            onChange={(e) =>
                              setQualityDraft((q) => ({
                                ...q,
                                enabledDailyField: {
                                  ...(q.enabledDailyField ?? {}),
                                  [item.key]: e.target.checked,
                                },
                              }))
                            }
                            className="h-4 w-4 accent-sky-600 rounded shrink-0"
                          />
                        </label>
                        <NumericInput
                          step={item.step ?? 1}
                          allowNegative={item.key === 'idealMinTempC' || item.key === 'idealMaxTempC'}
                          allowEmpty={false}
                          fallbackValue={item.display}
                          disabled={!checked}
                          value={item.display}
                          onValueChange={(_, num) => {
                            if (num === null) return;
                            setQualityDraft((q) => ({
                              ...q,
                              dailyField: {
                                ...q.dailyField,
                                [item.key]: item.onChangeVal(num),
                              },
                            }));
                          }}
                          className={`mt-1 ${inputBaseClass} ${!checked ? 'opacity-45' : ''}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Navegação Costeira */}
              <div className="space-y-2 rounded-xl bg-slate-50/80 p-3.5 dark:bg-slate-950/60">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  Navegação Costeira (Opcional por item)
                </p>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {(
                    [
                      {
                        key: 'maxWindKmh',
                        label: `Vento Máx (${getWindUnitLabel(units.wind)})`,
                        display: Number(
                          (
                            convertWindSpeed(qualityDraft.coastalNavigation.maxWindKmh, units.wind) ??
                            qualityDraft.coastalNavigation.maxWindKmh
                          ).toFixed(1),
                        ),
                        onChangeVal: (v: number) => Number(windSpeedToKmh(v, units.wind).toFixed(1)),
                      },
                      {
                        key: 'maxGustKmh',
                        label: `Rajada Máx (${getWindUnitLabel(units.wind)})`,
                        display: Number(
                          (
                            convertWindSpeed(qualityDraft.coastalNavigation.maxGustKmh, units.wind) ??
                            qualityDraft.coastalNavigation.maxGustKmh
                          ).toFixed(1),
                        ),
                        onChangeVal: (v: number) => Number(windSpeedToKmh(v, units.wind).toFixed(1)),
                      },
                      {
                        key: 'maxWaveM',
                        label: `Onda Máx (${getWaveUnitLabel(units.wave)})`,
                        step: 0.1,
                        display: Number(
                          (
                            convertWaveHeight(qualityDraft.coastalNavigation.maxWaveM, units.wave) ??
                            qualityDraft.coastalNavigation.maxWaveM
                          ).toFixed(1),
                        ),
                        onChangeVal: (v: number) => Number(waveHeightToM(v, units.wave).toFixed(2)),
                      },
                      {
                        key: 'maxCurrentKmh',
                        label: `Corrente (${getWindUnitLabel(units.wind)})`,
                        step: 0.1,
                        display: Number(
                          (
                            convertWindSpeed(
                              qualityDraft.coastalNavigation.maxCurrentKmh,
                              units.wind,
                            ) ?? qualityDraft.coastalNavigation.maxCurrentKmh
                          ).toFixed(1),
                        ),
                        onChangeVal: (v: number) => Number(windSpeedToKmh(v, units.wind).toFixed(2)),
                      },
                      {
                        key: 'minVisibilityKm',
                        label: 'Visib. Mín (km)',
                        step: 0.5,
                        display: qualityDraft.coastalNavigation.minVisibilityKm,
                        onChangeVal: (v: number) => v,
                      },
                    ] as ReadonlyArray<{
                      key: CoastalNavThresholdKey;
                      label: string;
                      step?: number;
                      display: number;
                      onChangeVal: (v: number) => number;
                    }>
                  ).map((item) => {
                    const checked = qualityDraft.enabledCoastalNavigation?.[item.key] ?? true;
                    return (
                      <div key={item.key} className="text-xs text-slate-700 dark:text-slate-300">
                        <label className="flex items-center justify-between gap-1.5 cursor-pointer">
                          <span className="truncate">{item.label}</span>
                          <input
                            type="checkbox"
                            data-testid={`toggle-coastal-${item.key}`}
                            checked={checked}
                            onChange={(e) =>
                              setQualityDraft((q) => ({
                                ...q,
                                enabledCoastalNavigation: {
                                  ...(q.enabledCoastalNavigation ?? {}),
                                  [item.key]: e.target.checked,
                                },
                              }))
                            }
                            className="h-4 w-4 accent-sky-600 rounded shrink-0"
                          />
                        </label>
                        <NumericInput
                          step={item.step ?? 1}
                          min={0}
                          allowEmpty={false}
                          fallbackValue={item.display}
                          disabled={!checked}
                          value={item.display}
                          onValueChange={(_, num) => {
                            if (num === null) return;
                            setQualityDraft((q) => ({
                              ...q,
                              coastalNavigation: {
                                ...q.coastalNavigation,
                                [item.key]: item.onChangeVal(num),
                              },
                            }));
                          }}
                          className={`mt-1 ${inputBaseClass} ${!checked ? 'opacity-45' : ''}`}
                        />
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Aviso Náutico: Indicadores de nível do mar MSL (~8 km Open-Meteo Marine){' '}
                  <strong>não substituem</strong> as tábuas de maré oficiais da DHN / Marinha do
                  Brasil; coordenadas continentais recebem penalidade marinha zero.
                </p>
              </div>
            </div>

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                data-testid="save-quality-thresholds-btn"
                onClick={handleSaveQualityThresholds}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-sky-700"
              >
                Salvar Scores Operacionais
              </button>
            </div>
          </div>

          {/* Sub-bloco 5.2: Limiares da Janela Segura Geral (SafeWindowThresholds) */}
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Limiares da Janela Segura Horária (Semáforo 168h — Opcionais)
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  {
                    key: 'maxWindKmh',
                    label: `Vento Máx (${getWindUnitLabel(units.wind)})`,
                    display: Number(
                      (
                        convertWindSpeed(safeWindowDraft.maxWindKmh, units.wind) ??
                        safeWindowDraft.maxWindKmh
                      ).toFixed(1),
                    ),
                    onChangeVal: (v: number) => Number(windSpeedToKmh(v, units.wind).toFixed(1)),
                  },
                  {
                    key: 'maxGustKmh',
                    label: `Rajada Máx (${getWindUnitLabel(units.wind)})`,
                    display: Number(
                      (
                        convertWindSpeed(safeWindowDraft.maxGustKmh, units.wind) ??
                        safeWindowDraft.maxGustKmh
                      ).toFixed(1),
                    ),
                    onChangeVal: (v: number) => Number(windSpeedToKmh(v, units.wind).toFixed(1)),
                  },
                  {
                    key: 'maxWaveM',
                    label: `Onda Máx (${getWaveUnitLabel(units.wave)})`,
                    step: 0.1,
                    display: Number(
                      (
                        convertWaveHeight(safeWindowDraft.maxWaveM, units.wave) ??
                        safeWindowDraft.maxWaveM
                      ).toFixed(1),
                    ),
                    onChangeVal: (v: number) => Number(waveHeightToM(v, units.wave).toFixed(2)),
                  },
                  {
                    key: 'maxPrecipProbPct',
                    label: 'Prob. Chuva (%)',
                    display: safeWindowDraft.maxPrecipProbPct,
                    onChangeVal: (v: number) => v,
                  },
                ] as ReadonlyArray<{
                  key: SafeWindowThresholdKey;
                  label: string;
                  step?: number;
                  display: number;
                  onChangeVal: (v: number) => number;
                }>
              ).map((item) => {
                const checked = safeWindowDraft.enabled?.[item.key] ?? true;
                return (
                  <div key={item.key} className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    <label className="flex items-center justify-between gap-1.5 cursor-pointer">
                      <span>{item.label}</span>
                      <input
                        type="checkbox"
                        data-testid={`toggle-safe-window-${item.key}`}
                        checked={checked}
                        onChange={(e) =>
                          setSafeWindowDraft((s) => ({
                            ...s,
                            enabled: {
                              ...(s.enabled ?? {}),
                              [item.key]: e.target.checked,
                            },
                          }))
                        }
                        className="h-4 w-4 accent-sky-600 rounded shrink-0"
                      />
                    </label>
                    <NumericInput
                      step={item.step ?? 1}
                      min={0}
                      max={item.key === 'maxPrecipProbPct' ? 100 : undefined}
                      allowEmpty={false}
                      fallbackValue={item.display}
                      disabled={!checked}
                      value={item.display}
                      onValueChange={(_, num) => {
                        if (num === null) return;
                        setSafeWindowDraft((s) => ({
                          ...s,
                          [item.key]: item.onChangeVal(num),
                        }));
                      }}
                      className={`mt-1 ${inputBaseClass} ${!checked ? 'opacity-45' : ''}`}
                    />
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                data-testid="save-safe-window-thresholds-btn"
                onClick={handleSaveSafeWindowSection}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-800 dark:bg-sky-600 dark:hover:bg-sky-700"
              >
                Salvar Janela Segura
              </button>
            </div>
          </div>
        </div>
      </CollapsibleModule>
    </div>
  );
}

export default SettingsTab;
