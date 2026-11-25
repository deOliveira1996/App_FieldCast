import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellRing,
  CheckCircle2,
  Clock,
  Compass,
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
  CustomNotificationConditions,
  CustomNotificationRule,
  NotificationRuleTemplate,
  UserNotificationPreferences,
} from '../../types/v4';
import {
  DEFAULT_SAFE_WINDOW_THRESHOLDS,
  type NormalizedForecast,
  type SafeWindowThresholds,
} from '../../types/weather';
import {
  DEFAULT_ACTIVITY_QUALITY_THRESHOLDS,
  loadActivityQualityThresholds,
  saveActivityQualityThresholds,
} from '../../utils/qualityScores';
import { safeAction } from '../../utils/safeAction';

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

function parseOptionalInputNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function formatRuleConditionChips(conditions: CustomNotificationConditions): string[] {
  const chips: string[] = [];
  if (conditions.minTempC !== undefined && conditions.minTempC !== null) {
    chips.push(`Temp < ${conditions.minTempC} °C`);
  }
  if (conditions.maxTempC !== undefined && conditions.maxTempC !== null) {
    chips.push(`Temp > ${conditions.maxTempC} °C`);
  }
  if (conditions.minPrecipProbPct !== undefined && conditions.minPrecipProbPct !== null) {
    chips.push(`Chuva >= ${conditions.minPrecipProbPct}%`);
  }
  if (conditions.maxWindKmh !== undefined && conditions.maxWindKmh !== null) {
    chips.push(`Vento >= ${conditions.maxWindKmh} km/h`);
  }
  if (conditions.maxGustKmh !== undefined && conditions.maxGustKmh !== null) {
    chips.push(`Rajada >= ${conditions.maxGustKmh} km/h`);
  }
  if (conditions.maxCloudCoverPct !== undefined && conditions.maxCloudCoverPct !== null) {
    chips.push(`Nuvens >= ${conditions.maxCloudCoverPct}%`);
  }
  if (conditions.maxWaveM !== undefined && conditions.maxWaveM !== null) {
    chips.push(`Onda >= ${conditions.maxWaveM} m`);
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
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);

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
      setActiveTemplateId(tpl.templateId);
      setRuleDraft({
        name: tpl.name,
        startHHMM: tpl.suggestedTimeWindow.startHHMM,
        endHHMM: tpl.suggestedTimeWindow.endHHMM,
        notifyFromHHMM: tpl.suggestedTimeWindow.notifyFromHHMM ?? '',
        minTempC: c.minTempC !== undefined && c.minTempC !== null ? String(c.minTempC) : '',
        maxTempC: c.maxTempC !== undefined && c.maxTempC !== null ? String(c.maxTempC) : '',
        minPrecipProbPct:
          c.minPrecipProbPct !== undefined && c.minPrecipProbPct !== null
            ? String(c.minPrecipProbPct)
            : '',
        maxWindKmh:
          c.maxWindKmh !== undefined && c.maxWindKmh !== null ? String(c.maxWindKmh) : '',
        maxGustKmh:
          c.maxGustKmh !== undefined && c.maxGustKmh !== null ? String(c.maxGustKmh) : '',
        maxCloudCoverPct:
          c.maxCloudCoverPct !== undefined && c.maxCloudCoverPct !== null
            ? String(c.maxCloudCoverPct)
            : '',
        maxWaveM: c.maxWaveM !== undefined && c.maxWaveM !== null ? String(c.maxWaveM) : '',
        maxKpIndex:
          c.maxKpIndex !== undefined && c.maxKpIndex !== null ? String(c.maxKpIndex) : '',
        customTitle: tpl.suggestedTitle,
        customMessage: tpl.suggestedMessage,
      });

      setStatusFeedback(`Template "${tpl.name}" carregado no construtor para personalização.`);
      onToast?.({
        type: 'info',
        title: 'Template carregado como guia',
        message: 'Revise os limites e horários abaixo e clique em Salvar Regra de Alerta.',
      });
    },
    [onToast],
  );

  const handleSaveCustomRule = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      void safeAction(
        async () => {
          const conditions: CustomNotificationConditions = {
            minTempC: parseOptionalInputNumber(ruleDraft.minTempC),
            maxTempC: parseOptionalInputNumber(ruleDraft.maxTempC),
            minPrecipProbPct: parseOptionalInputNumber(ruleDraft.minPrecipProbPct),
            maxWindKmh: parseOptionalInputNumber(ruleDraft.maxWindKmh),
            maxGustKmh: parseOptionalInputNumber(ruleDraft.maxGustKmh),
            maxCloudCoverPct: parseOptionalInputNumber(ruleDraft.maxCloudCoverPct),
            maxWaveM: parseOptionalInputNumber(ruleDraft.maxWaveM),
            maxKpIndex: parseOptionalInputNumber(ruleDraft.maxKpIndex),
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
    [onErrorLog, onToast, persistPrefs, prefs, ruleDraft],
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
      className="mx-auto max-w-6xl space-y-6 pb-10 text-slate-900 dark:text-slate-100"
    >
      {/* Cabeçalho da Central */}
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300">
              <Settings className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-xl">
                Central de Configurações, Alertas &amp; Janelas Horárias
              </h1>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 sm:text-sm">
                Controle 100% opt-in sobre notificações Android/Web, janelas horárias permitidas,
                templates operacionais, GPS em segundo plano e limites de decisão.
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
            className="mt-3 rounded-xl border border-sky-200 bg-sky-50/80 px-3.5 py-2.5 text-xs font-medium text-sky-900 dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-200"
          >
            {statusFeedback}
          </div>
        )}
      </header>

      {/* SECTION 1 — Permissão Geral & Eventos Extremos Automáticos */}
      <section
        aria-labelledby="section-general-notifications"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3 dark:border-slate-800">
          <BellRing className="h-5 w-5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          <h2
            id="section-general-notifications"
            className="text-base font-bold text-slate-900 dark:text-white"
          >
            1. Permissão Geral &amp; Eventos Extremos Automáticos
          </h2>
        </div>

        <div className="mt-4 space-y-4">
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
        </div>
      </section>

      {/* SECTION 2 — Templates Guia (3 Sugestões Prontas) */}
      <section
        aria-labelledby="section-guide-templates"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
            <h2
              id="section-guide-templates"
              className="text-base font-bold text-slate-900 dark:text-white"
            >
              2. Templates Guia (3 Sugestões Prontas — Não Ativas por Padrão)
            </h2>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Escolha um modelo para preencher o construtor abaixo e ajustar livremente
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {NOTIFICATION_RULE_TEMPLATES.map((tpl) => {
            const chips = formatRuleConditionChips(tpl.suggestedConditions);
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
      </section>

      {/* SECTION 3 — Construtor de Alerta Personalizado + Janela Horária */}
      <section
        aria-labelledby="section-custom-alert-builder"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3 dark:border-slate-800">
          <Plus className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <h2
            id="section-custom-alert-builder"
            className="text-base font-bold text-slate-900 dark:text-white"
          >
            3. Construtor de Alerta Personalizado &amp; Janela Horária
          </h2>
        </div>

        <form
          data-testid="custom-alert-form"
          onSubmit={handleSaveCustomRule}
          className="mt-4 space-y-4"
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

          {/* Limiares Meteorológicos, Oceanográficos e Geomagnéticos */}
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              Limiares de Disparo (preencha apenas as variáveis que deseja monitorar)
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Temp Mín (°C)
                <input
                  type="number"
                  step="0.5"
                  data-testid="rule-min-temp"
                  placeholder="Ex.: 14"
                  value={ruleDraft.minTempC}
                  onChange={(e) => setRuleDraft((d) => ({ ...d, minTempC: e.target.value }))}
                  className={`mt-1 ${inputBaseClass}`}
                />
              </label>

              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Temp Máx (°C)
                <input
                  type="number"
                  step="0.5"
                  data-testid="rule-max-temp"
                  placeholder="Ex.: 32"
                  value={ruleDraft.maxTempC}
                  onChange={(e) => setRuleDraft((d) => ({ ...d, maxTempC: e.target.value }))}
                  className={`mt-1 ${inputBaseClass}`}
                />
              </label>

              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Prob. Chuva (%)
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  data-testid="rule-min-precip-prob"
                  placeholder="Ex.: 50"
                  value={ruleDraft.minPrecipProbPct}
                  onChange={(e) =>
                    setRuleDraft((d) => ({ ...d, minPrecipProbPct: e.target.value }))
                  }
                  className={`mt-1 ${inputBaseClass}`}
                />
              </label>

              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Vento Máx (km/h)
                <input
                  type="number"
                  step="1"
                  min="0"
                  data-testid="rule-max-wind"
                  placeholder="Ex.: 28"
                  value={ruleDraft.maxWindKmh}
                  onChange={(e) => setRuleDraft((d) => ({ ...d, maxWindKmh: e.target.value }))}
                  className={`mt-1 ${inputBaseClass}`}
                />
              </label>

              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Rajada Máx (km/h)
                <input
                  type="number"
                  step="1"
                  min="0"
                  data-testid="rule-max-gust"
                  placeholder="Ex.: 45"
                  value={ruleDraft.maxGustKmh}
                  onChange={(e) => setRuleDraft((d) => ({ ...d, maxGustKmh: e.target.value }))}
                  className={`mt-1 ${inputBaseClass}`}
                />
              </label>

              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Nebulosidade (%)
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  data-testid="rule-max-cloud"
                  placeholder="Ex.: 85"
                  value={ruleDraft.maxCloudCoverPct}
                  onChange={(e) =>
                    setRuleDraft((d) => ({ ...d, maxCloudCoverPct: e.target.value }))
                  }
                  className={`mt-1 ${inputBaseClass}`}
                />
              </label>

              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Onda Máx (m)
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  data-testid="rule-max-wave"
                  placeholder="Ex.: 1.8"
                  value={ruleDraft.maxWaveM}
                  onChange={(e) => setRuleDraft((d) => ({ ...d, maxWaveM: e.target.value }))}
                  className={`mt-1 ${inputBaseClass}`}
                />
              </label>

              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Kp Máx (0–9)
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="9"
                  data-testid="rule-max-kp"
                  placeholder="Ex.: 4.5"
                  value={ruleDraft.maxKpIndex}
                  onChange={(e) => setRuleDraft((d) => ({ ...d, maxKpIndex: e.target.value }))}
                  className={`mt-1 ${inputBaseClass}`}
                />
              </label>
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
              <code>{'{wind}'}</code>, <code>{'{wave}'}</code> e <code>{'{details}'}</code> no
              título ou mensagem.
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

        {/* Lista de Regras Salvas */}
        <div className="mt-6 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Regras Personalizadas Salvas ({prefs.rules.length})
          </h3>

          {prefs.rules.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Nenhuma regra personalizada cadastrada. Crie do zero acima ou clique em &ldquo;Usar
              Template como Guia&rdquo; em uma das 3 sugestões.
            </p>
          ) : (
            <ul data-testid="saved-rules-list" className="mt-3 space-y-3">
              {prefs.rules.map((rule) => {
                const chips = formatRuleConditionChips(rule.conditions);
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
        </div>
      </section>

      {/* SECTION 4 — Rastreamento GPS em Segundo Plano (Android 14+) & Scores Operacionais */}
      <section
        aria-labelledby="section-gps-and-scores"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3 dark:border-slate-800">
          <Sliders className="h-5 w-5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          <h2
            id="section-gps-and-scores"
            className="text-base font-bold text-slate-900 dark:text-white"
          >
            4. Rastreamento GPS em Segundo Plano (Android 14+), Scores Operacionais &amp; Aparência
          </h2>
        </div>

        <div className="mt-4 space-y-5">
          {/* Sub-bloco 4.1: GPS em Segundo Plano + Tema */}
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
                  Mantém gravação contínua de rota com tela bloqueada/no bolso aplicando filtro
                  estrito de acurácia &le; 20 m. Altitude topográfica permanece estritamente DEM
                  Open-Meteo.
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

            {/* Aparência / Tema */}
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
                  Alterne entre alto contraste diurno sob sol forte (Claro) e preservação visual
                  noturna (Escuro).
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

          {/* Sub-bloco 4.2: Scores de Qualidade por Atividade */}
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
                  Operação Diária &amp; Campo
                </p>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  <label className="text-xs text-slate-700 dark:text-slate-300">
                    Temp Ideal Mín (°C)
                    <input
                      type="number"
                      value={qualityDraft.dailyField.idealMinTempC}
                      onChange={(e) =>
                        setQualityDraft((q) => ({
                          ...q,
                          dailyField: {
                            ...q.dailyField,
                            idealMinTempC: Number(e.target.value),
                          },
                        }))
                      }
                      className={`mt-1 ${inputBaseClass}`}
                    />
                  </label>
                  <label className="text-xs text-slate-700 dark:text-slate-300">
                    Temp Ideal Máx (°C)
                    <input
                      type="number"
                      value={qualityDraft.dailyField.idealMaxTempC}
                      onChange={(e) =>
                        setQualityDraft((q) => ({
                          ...q,
                          dailyField: {
                            ...q.dailyField,
                            idealMaxTempC: Number(e.target.value),
                          },
                        }))
                      }
                      className={`mt-1 ${inputBaseClass}`}
                    />
                  </label>
                  <label className="text-xs text-slate-700 dark:text-slate-300">
                    Vento Máx (km/h)
                    <input
                      type="number"
                      value={qualityDraft.dailyField.maxWindKmh}
                      onChange={(e) =>
                        setQualityDraft((q) => ({
                          ...q,
                          dailyField: {
                            ...q.dailyField,
                            maxWindKmh: Number(e.target.value),
                          },
                        }))
                      }
                      className={`mt-1 ${inputBaseClass}`}
                    />
                  </label>
                  <label className="text-xs text-slate-700 dark:text-slate-300">
                    Rajada Máx (km/h)
                    <input
                      type="number"
                      value={qualityDraft.dailyField.maxGustKmh}
                      onChange={(e) =>
                        setQualityDraft((q) => ({
                          ...q,
                          dailyField: {
                            ...q.dailyField,
                            maxGustKmh: Number(e.target.value),
                          },
                        }))
                      }
                      className={`mt-1 ${inputBaseClass}`}
                    />
                  </label>
                  <label className="text-xs text-slate-700 dark:text-slate-300">
                    Prob. Chuva (%)
                    <input
                      type="number"
                      value={qualityDraft.dailyField.maxPrecipProbPct}
                      onChange={(e) =>
                        setQualityDraft((q) => ({
                          ...q,
                          dailyField: {
                            ...q.dailyField,
                            maxPrecipProbPct: Number(e.target.value),
                          },
                        }))
                      }
                      className={`mt-1 ${inputBaseClass}`}
                    />
                  </label>
                  <label className="text-xs text-slate-700 dark:text-slate-300">
                    CAPE Máx (J/kg)
                    <input
                      type="number"
                      step="50"
                      value={qualityDraft.dailyField.maxCapeJkg}
                      onChange={(e) =>
                        setQualityDraft((q) => ({
                          ...q,
                          dailyField: {
                            ...q.dailyField,
                            maxCapeJkg: Number(e.target.value),
                          },
                        }))
                      }
                      className={`mt-1 ${inputBaseClass}`}
                    />
                  </label>
                </div>
              </div>

              {/* Navegação Costeira */}
              <div className="space-y-2 rounded-xl bg-slate-50/80 p-3.5 dark:bg-slate-950/60">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  Navegação Costeira
                </p>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  <label className="text-xs text-slate-700 dark:text-slate-300">
                    Vento Máx (km/h)
                    <input
                      type="number"
                      value={qualityDraft.coastalNavigation.maxWindKmh}
                      onChange={(e) =>
                        setQualityDraft((q) => ({
                          ...q,
                          coastalNavigation: {
                            ...q.coastalNavigation,
                            maxWindKmh: Number(e.target.value),
                          },
                        }))
                      }
                      className={`mt-1 ${inputBaseClass}`}
                    />
                  </label>
                  <label className="text-xs text-slate-700 dark:text-slate-300">
                    Rajada Máx (km/h)
                    <input
                      type="number"
                      value={qualityDraft.coastalNavigation.maxGustKmh}
                      onChange={(e) =>
                        setQualityDraft((q) => ({
                          ...q,
                          coastalNavigation: {
                            ...q.coastalNavigation,
                            maxGustKmh: Number(e.target.value),
                          },
                        }))
                      }
                      className={`mt-1 ${inputBaseClass}`}
                    />
                  </label>
                  <label className="text-xs text-slate-700 dark:text-slate-300">
                    Onda Máx (m)
                    <input
                      type="number"
                      step="0.1"
                      value={qualityDraft.coastalNavigation.maxWaveM}
                      onChange={(e) =>
                        setQualityDraft((q) => ({
                          ...q,
                          coastalNavigation: {
                            ...q.coastalNavigation,
                            maxWaveM: Number(e.target.value),
                          },
                        }))
                      }
                      className={`mt-1 ${inputBaseClass}`}
                    />
                  </label>
                  <label className="text-xs text-slate-700 dark:text-slate-300">
                    Corrente Máx (km/h)
                    <input
                      type="number"
                      step="0.1"
                      value={qualityDraft.coastalNavigation.maxCurrentKmh}
                      onChange={(e) =>
                        setQualityDraft((q) => ({
                          ...q,
                          coastalNavigation: {
                            ...q.coastalNavigation,
                            maxCurrentKmh: Number(e.target.value),
                          },
                        }))
                      }
                      className={`mt-1 ${inputBaseClass}`}
                    />
                  </label>
                  <label className="text-xs text-slate-700 dark:text-slate-300">
                    Visib. Mín (km)
                    <input
                      type="number"
                      step="0.5"
                      value={qualityDraft.coastalNavigation.minVisibilityKm}
                      onChange={(e) =>
                        setQualityDraft((q) => ({
                          ...q,
                          coastalNavigation: {
                            ...q.coastalNavigation,
                            minVisibilityKm: Number(e.target.value),
                          },
                        }))
                      }
                      className={`mt-1 ${inputBaseClass}`}
                    />
                  </label>
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

          {/* Sub-bloco 4.3: Limiares da Janela Segura Geral (SafeWindowThresholds) */}
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Limiares da Janela Segura Horária (Semáforo 168h)
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Vento Máx (km/h)
                <input
                  type="number"
                  value={safeWindowDraft.maxWindKmh}
                  onChange={(e) =>
                    setSafeWindowDraft((s) => ({ ...s, maxWindKmh: Number(e.target.value) }))
                  }
                  className={`mt-1 ${inputBaseClass}`}
                />
              </label>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Rajada Máx (km/h)
                <input
                  type="number"
                  value={safeWindowDraft.maxGustKmh}
                  onChange={(e) =>
                    setSafeWindowDraft((s) => ({ ...s, maxGustKmh: Number(e.target.value) }))
                  }
                  className={`mt-1 ${inputBaseClass}`}
                />
              </label>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Onda Máx (m)
                <input
                  type="number"
                  step="0.1"
                  value={safeWindowDraft.maxWaveM}
                  onChange={(e) =>
                    setSafeWindowDraft((s) => ({ ...s, maxWaveM: Number(e.target.value) }))
                  }
                  className={`mt-1 ${inputBaseClass}`}
                />
              </label>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Prob. Chuva (%)
                <input
                  type="number"
                  value={safeWindowDraft.maxPrecipProbPct}
                  onChange={(e) =>
                    setSafeWindowDraft((s) => ({
                      ...s,
                      maxPrecipProbPct: Number(e.target.value),
                    }))
                  }
                  className={`mt-1 ${inputBaseClass}`}
                />
              </label>
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
      </section>
    </div>
  );
}

export default SettingsTab;
