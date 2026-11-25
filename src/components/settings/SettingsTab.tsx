import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellRing,
  CheckCircle2,
  Clock,
  Compass,
  Gauge,
  Moon,
  Navigation,
  Plus,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Sliders,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react';
import { useUnits } from '../../context/UnitsContext';
import { useTheme, type ThemeMode } from '../../hooks/useTheme';
import {
  dispatchSystemNotification,
  getSystemNotificationPermissionState,
  loadNotificationPreferences,
  NOTIFICATION_RULE_TEMPLATES,
  requestSystemNotificationPermission,
  saveNotificationPreferences,
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
  NotificationRuleTemplate,
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
import { CollapsibleModule } from '../common';

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
  maxKpIndex: string;
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
  maxKpIndex: '',
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
  | 'maxKpIndex';

const DEFAULT_ENABLED_RULE_FIELDS: Record<RuleConditionKey, boolean> = {
  minTempC: false,
  maxTempC: false,
  minPrecipProbPct: false,
  maxWindKmh: false,
  maxGustKmh: false,
  maxCloudCoverPct: false,
  maxWaveM: false,
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
    units ? Number((convertWaveHeight(m, units.wave) ?? m).toFixed(1)) : m;

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
  if (conditions.maxKpIndex !== undefined && conditions.maxKpIndex !== null) {
    chips.push(`Kp >= ${conditions.maxKpIndex}`);
  }
  return chips;
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
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  const [ruleDraft, setRuleDraft] = useState<RuleBuilderDraft>(INITIAL_RULE_DRAFT);
  const [enabledRuleFields, setEnabledRuleFields] = useState<Record<RuleConditionKey, boolean>>(
    DEFAULT_ENABLED_RULE_FIELDS,
  );
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
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
    let mounted = true;
    void getSystemNotificationPermissionState().then((res) => {
      if (mounted) {
        setPermissionState(res);
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
  }, [onErrorLog, onToast, persistPrefs, prefs]);

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

  const handleApplyTemplateToBuilder = useCallback(
    (tpl: NotificationRuleTemplate) => {
      const c = tpl.suggestedConditions;
      const fmtVal = (val: number | null | undefined, convertFn?: (n: number) => number | null) => {
        if (val === undefined || val === null) return '';
        const converted = convertFn ? convertFn(val) : val;
        return converted !== null ? String(Number(converted.toFixed(1))) : '';
      };

      setActiveTemplateId(tpl.templateId);
      setRuleDraft({
        name: tpl.name,
        startHHMM: tpl.suggestedTimeWindow.startHHMM,
        endHHMM: tpl.suggestedTimeWindow.endHHMM,
        notifyFromHHMM: tpl.suggestedTimeWindow.notifyFromHHMM ?? '',
        minTempC: fmtVal(c.minTempC, (n) => convertTemperature(n, units.temperature)),
        maxTempC: fmtVal(c.maxTempC, (n) => convertTemperature(n, units.temperature)),
        minPrecipProbPct: fmtVal(c.minPrecipProbPct),
        maxWindKmh: fmtVal(c.maxWindKmh, (n) => convertWindSpeed(n, units.wind)),
        maxGustKmh: fmtVal(c.maxGustKmh, (n) => convertWindSpeed(n, units.wind)),
        maxCloudCoverPct: fmtVal(c.maxCloudCoverPct),
        maxWaveM: fmtVal(c.maxWaveM, (n) => convertWaveHeight(n, units.wave)),
        maxKpIndex: fmtVal(c.maxKpIndex),
        customTitle: tpl.suggestedTitle,
        customMessage: tpl.suggestedMessage,
      });

      setEnabledRuleFields({
        minTempC: c.minTempC !== undefined && c.minTempC !== null,
        maxTempC: c.maxTempC !== undefined && c.maxTempC !== null,
        minPrecipProbPct: c.minPrecipProbPct !== undefined && c.minPrecipProbPct !== null,
        maxWindKmh: c.maxWindKmh !== undefined && c.maxWindKmh !== null,
        maxGustKmh: c.maxGustKmh !== undefined && c.maxGustKmh !== null,
        maxCloudCoverPct: c.maxCloudCoverPct !== undefined && c.maxCloudCoverPct !== null,
        maxWaveM: c.maxWaveM !== undefined && c.maxWaveM !== null,
        maxKpIndex: c.maxKpIndex !== undefined && c.maxKpIndex !== null,
      });

      setIsAlertBuilderOpen(true);
      setStatusFeedback(`Template "${tpl.name}" carregado no construtor para personalização.`);
      onToast?.({
        type: 'info',
        title: 'Template carregado como guia',
        message: 'Revise os parâmetros marcados abaixo e clique em Salvar Regra de Alerta.',
      });
    },
    [onToast, units.temperature, units.wave, units.wind],
  );

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
            maxKpIndex: readNum('maxKpIndex', ruleDraft.maxKpIndex),
          };

          const resolvedName =
            ruleDraft.name.trim() ||
            ruleDraft.customTitle.trim() ||
            `Alerta Personalizado #${prefs.rules.length + 1}`;

          const newRule: CustomNotificationRule = {
            id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: resolvedName,
            enabled: true,
            conditions,
            timeWindow: {
              startHHMM: ruleDraft.startHHMM || '06:00',
              endHHMM: ruleDraft.endHHMM || '18:00',
              notifyFromHHMM: ruleDraft.notifyFromHHMM.trim() || null,
            },
            customTitle: ruleDraft.customTitle.trim() || `Alerta: ${resolvedName}`,
            customMessage: ruleDraft.customMessage.trim(),
            createdAtIso: new Date().toISOString(),
            lastTriggeredIso: null,
          };

          persistPrefs({
            ...prefs,
            rules: [newRule, ...prefs.rules],
          });

          setRuleDraft(INITIAL_RULE_DRAFT);
          setEnabledRuleFields(DEFAULT_ENABLED_RULE_FIELDS);
          setActiveTemplateId(null);
          setStatusFeedback(`Regra "${newRule.name}" salva com sucesso.`);

          onToast?.({
            type: 'success',
            title: 'Regra de alerta salva',
            message: `"${newRule.name}" adicionada às suas regras personalizadas.`,
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
      enabledRuleFields,
      onErrorLog,
      onToast,
      persistPrefs,
      prefs,
      ruleDraft,
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
      if (target) {
        onToast?.({
          type: 'info',
          title: 'Regra removida',
          message: `"${target.name}" foi excluída.`,
        });
      }
    },
    [onToast, persistPrefs, prefs],
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
          label: 'Autorizado no dispositivo',
          cls: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/50 dark:text-emerald-200',
        }
      : permissionState === 'denied'
        ? {
            label: 'Bloqueado no sistema',
            cls: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700/60 dark:bg-rose-950/50 dark:text-rose-200',
          }
        : permissionState === 'unsupported'
          ? {
              label: 'Apenas alertas internos (WebView/Sandbox)',
              cls: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
            }
          : {
              label: 'Aguardando autorização',
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
                Configurações Modulares &amp; Alertas
              </h1>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                Abra apenas os módulos desejados: escalas globais, permissões, notificações opt-in e limiares opcionais.
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
        title="Unidades & Escalas de Exibição"
        subtitle={`Ativo: ${getWindUnitLabel(units.wind)} · ${getTempUnitLabel(units.temperature)} · ${getWaveUnitLabel(units.wave)}`}
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
            title="Restaurar unidades métricas padrão"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Padrão</span>
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

          {/* Toggle Eventos Extremos Automáticos */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-200/80 bg-amber-50/50 p-4 dark:border-amber-800/50 dark:bg-amber-950/20">
            <div className="max-w-xl">
              <div className="flex items-center gap-2">
                <AlertTriangle
                  className="h-4 w-4 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Avisar Automaticamente Eventos Extremos
                </p>
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Emite alertas severos (tempestades elétricas, vendavais, ressaca costeira, queda
                barométrica e tempestade geomagnética Kp &ge; 5) sempre com atribuição explícita da
                fonte oficial (Open-Meteo, NOAA SWPC; cota MSL ~8 km não substitui DHN/Marinha).
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

      {/* MÓDULO 2 — Templates Guia (3 Sugestões Prontas) */}
      <CollapsibleModule
        title="2. Templates Guia (3 Sugestões Prontas)"
        subtitle="Não ativos por padrão — clique para preencher o construtor com os parâmetros sugeridos"
        icon={<Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />}
        defaultOpen={false}
        keepMounted={true}
        hideIconStyle="eye"
        testId="settings-templates-module"
        badge={`${NOTIFICATION_RULE_TEMPLATES.length}`}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {NOTIFICATION_RULE_TEMPLATES.map((tpl) => {
            const chips = formatRuleConditionChips(tpl.suggestedConditions, units);
            const isSelected = activeTemplateId === tpl.templateId;
            return (
              <article
                key={tpl.templateId}
                className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                  isSelected
                    ? 'border-sky-500 bg-sky-50/60 dark:border-sky-500 dark:bg-sky-950/30'
                    : 'border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-950/50'
                }`}
              >
                <div>
                  <span className="inline-block rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300">
                    {tpl.categoryLabel}
                  </span>
                  <h3 className="mt-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                    {tpl.name}
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {tpl.description}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                      Janela {tpl.suggestedTimeWindow.startHHMM}–{tpl.suggestedTimeWindow.endHHMM}
                    </span>
                    {tpl.suggestedTimeWindow.notifyFromHHMM && (
                      <span className="rounded-md border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                        Avisar a partir das {tpl.suggestedTimeWindow.notifyFromHHMM}
                      </span>
                    )}
                    {chips.map((chip) => (
                      <span
                        key={chip}
                        className="rounded-md bg-slate-200/80 px-2 py-0.5 text-[11px] font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  data-testid={`use-template-${tpl.templateId}`}
                  onClick={() => handleApplyTemplateToBuilder(tpl)}
                  className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-sky-600 bg-white px-3 py-2 text-xs font-bold text-sky-700 transition hover:bg-sky-50 dark:border-sky-500 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-sky-950/50"
                >
                  Usar Template como Guia
                </button>
              </article>
            );
          })}
        </div>
      </CollapsibleModule>

      {/* MÓDULO 3 — Construtor de Alerta Personalizado (com Checkboxes Opcionais) */}
      <CollapsibleModule
        title="3. Construtor de Alerta Personalizado & Janela Horária"
        subtitle="Marque apenas os parâmetros que deseja monitorar (itens desmarcados são ignorados)"
        icon={<Plus className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
        isOpen={isAlertBuilderOpen}
        onOpenChange={setIsAlertBuilderOpen}
        keepMounted={true}
        hideIconStyle="eye"
        testId="settings-alert-builder-module"
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
                    <input
                      type="number"
                      step={field.step}
                      min={field.min}
                      max={field.max}
                      data-testid={field.testId}
                      placeholder={field.placeholder}
                      value={ruleDraft[field.key]}
                      onChange={(e) => {
                        const val = e.target.value;
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
                placeholder="Variáveis opcionais: {hour}, {window}, {temp}, {wind}, {gust}, {precipProb}, {wave}, {kp}"
                value={ruleDraft.customMessage}
                onChange={(e) => setRuleDraft((d) => ({ ...d, customMessage: e.target.value }))}
                className={`mt-1 ${inputBaseClass}`}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Dica: Você pode usar tags dinâmicas como <code>{'{hour}'}</code>,{' '}
              <code>{'{wind}'}</code>, <code>{'{wave}'}</code> e <code>{'{details}'}</code>.
            </p>

            <button
              type="submit"
              data-testid="save-custom-rule-btn"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Salvar Regra de Alerta
            </button>
          </div>
        </form>
      </CollapsibleModule>

      {/* MÓDULO 4 — Regras Personalizadas Salvas */}
      <CollapsibleModule
        title="4. Regras Personalizadas Salvas"
        subtitle="Ative, pause ou remova alertas configurados para sua operação"
        icon={<Bell className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
        defaultOpen={true}
        keepMounted={true}
        hideIconStyle="eye"
        testId="settings-saved-rules-module"
        badge={`${prefs.rules.length}`}
      >
        {prefs.rules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Nenhuma regra personalizada cadastrada. Crie no Construtor acima ou escolha um dos 3
            Templates Guia.
          </p>
        ) : (
          <ul data-testid="saved-rules-list" className="space-y-3">
            {prefs.rules.map((rule) => {
              const chips = formatRuleConditionChips(rule.conditions, units);
              return (
                <li
                  key={rule.id}
                  data-testid={`saved-rule-${rule.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/60"
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
                        {rule.enabled ? 'Ativa' : 'Pausada'}
                      </span>
                      <span className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        Janela {rule.timeWindow.startHHMM}–{rule.timeWindow.endHHMM}
                        {rule.timeWindow.notifyFromHHMM
                          ? ` • Avisar das ${rule.timeWindow.notifyFromHHMM}`
                          : ''}
                      </span>
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
                      data-testid={`toggle-rule-${rule.id}`}
                      onClick={() => handleToggleRuleEnabled(rule.id)}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      {rule.enabled ? 'Desativar' : 'Ativar'}
                    </button>

                    <button
                      type="button"
                      aria-label={`Excluir regra ${rule.name}`}
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

      {/* MÓDULO 5 — Limiares Opcionais dos Scores & Janela Segura (168h) */}
      <CollapsibleModule
        title="5. Limiares Opcionais dos Scores & Janela Segura (168h)"
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
                        <input
                          type="number"
                          step={item.step ?? 1}
                          disabled={!checked}
                          value={item.display}
                          onChange={(e) => {
                            const num = Number(e.target.value);
                            if (!Number.isFinite(num)) return;
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
                        <input
                          type="number"
                          step={item.step ?? 1}
                          disabled={!checked}
                          value={item.display}
                          onChange={(e) => {
                            const num = Number(e.target.value);
                            if (!Number.isFinite(num)) return;
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
                    <input
                      type="number"
                      step={item.step ?? 1}
                      disabled={!checked}
                      value={item.display}
                      onChange={(e) => {
                        const num = Number(e.target.value);
                        if (!Number.isFinite(num)) return;
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
