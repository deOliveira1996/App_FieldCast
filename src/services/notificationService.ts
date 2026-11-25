import { Capacitor, registerPlugin } from '@capacitor/core';
import type {
  CustomNotificationConditions,
  CustomNotificationRule,
  NotificationRuleTemplate,
  NotificationTimeWindow,
  UserNotificationPreferences,
} from '../types/v4';
import type { EnsembleHour, NormalizedForecast } from '../types/weather';
import {
  formatLocalHourBadge,
  formatLocalYMD,
  getLocalDateParts,
} from '../utils/localTimeHour';

export const NOTIFICATION_PREFS_STORAGE_KEY = 'fieldcast_notification_prefs_v4';
export const NOTIFICATION_LEDGER_STORAGE_KEY = 'fieldcast_notification_ledger_v4';

const LEDGER_RETENTION_MS = 24 * 60 * 60 * 1000;

interface FieldCastNotificationsPluginBridge {
  checkPermissions(): Promise<{ notifications: 'granted' | 'denied' | 'prompt' | string }>;
  requestPermissions(): Promise<{ notifications: 'granted' | 'denied' | 'prompt' | string }>;
  dispatchNotification(options: {
    title: string;
    body: string;
    notificationId?: number;
    subText?: string;
  }): Promise<{ dispatched: boolean; notificationId?: number; reason?: string }>;
}

const FieldCastNotificationsBridge = registerPlugin<FieldCastNotificationsPluginBridge>(
  'FieldCastNotifications',
);

/**
 * 3 templates guia não ativos por padrão: servem de inspiração rápida para o usuário
 * carregar no construtor de regras e personalizar conforme sua operação.
 */
export const NOTIFICATION_RULE_TEMPLATES: readonly NotificationRuleTemplate[] = [
  {
    templateId: 'tpl-extreme-storm',
    name: 'Defesa Civil — Tempestade, Raios & Vendaval',
    categoryLabel: 'Defesa Civil & Segurança',
    description:
      'Monitoramento 24h para pancadas severas, risco elétrico e rajadas intensas sem restrição de horário.',
    suggestedConditions: {
      minPrecipProbPct: 70,
      maxGustKmh: 55,
    },
    suggestedTimeWindow: {
      startHHMM: '00:00',
      endHHMM: '23:59',
      notifyFromHHMM: null,
    },
    suggestedTitle: 'Defesa Civil: Tempestade & Vendaval ({hour})',
    suggestedMessage:
      'Condição severa prevista às {hour}: chuva {precipProb}% e rajadas de {gust} km/h ({details}). Revise abrigos e suspenda atividades expostas.',
  },
  {
    templateId: 'tpl-morning-field',
    name: 'Planejamento Diário de Campo (Janela Matinal)',
    categoryLabel: 'Operação Terrestre & Campo',
    description:
      'Avalia amplitude térmica (14–32 °C), vento e probabilidade de chuva no turno diurno, disparando a partir das 06:30.',
    suggestedConditions: {
      minTempC: 14,
      maxTempC: 32,
      maxWindKmh: 28,
      minPrecipProbPct: 45,
    },
    suggestedTimeWindow: {
      startHHMM: '06:00',
      endHHMM: '18:00',
      notifyFromHHMM: '06:30',
    },
    suggestedTitle: 'Planejamento de Campo — Atenção às {hour}',
    suggestedMessage:
      'Na janela {window} (às {hour}): Temp {temp} °C, Vento {wind} km/h, Chuva {precipProb}% ({details}). Ajuste hidratação, EPIs e cronograma.',
  },
  {
    templateId: 'tpl-marine-drone',
    name: 'Alerta Náutico & Aeronáutico (Vento, Onda & Kp)',
    categoryLabel: 'Náutica Costeira & Aeronáutica/VANT',
    description:
      'Vigia vento sustentado, altura significativa de onda e índice geomagnético NOAA Kp a partir das 05:30.',
    suggestedConditions: {
      maxWindKmh: 25,
      maxWaveM: 1.8,
      maxKpIndex: 4.5,
    },
    suggestedTimeWindow: {
      startHHMM: '05:30',
      endHHMM: '19:00',
      notifyFromHHMM: '05:30',
    },
    suggestedTitle: 'Restrição Náutica / Voo VANT ({hour})',
    suggestedMessage:
      'Limite atingido às {hour}: Vento {wind} km/h, Onda {wave} m, Kp {kp} ({details}). Nota: cota MSL (~8 km) não substitui tábua oficial DHN/Marinha.',
  },
] as const;

export const DEFAULT_NOTIFICATION_PREFERENCES: UserNotificationPreferences = {
  masterEnabled: false,
  extremeEventsAutoEnabled: true,
  globalActiveWindow: {
    enabled: false,
    startHHMM: '06:00',
    endHHMM: '22:00',
  },
  rules: [],
  updatedAtIso: '1970-01-01T00:00:00.000Z',
};

let memoryNotificationPrefs: UserNotificationPreferences = clonePreferences(
  DEFAULT_NOTIFICATION_PREFERENCES,
);
let fallbackMemoryLedger: Record<string, string> = {};

function clonePreferences(source: UserNotificationPreferences): UserNotificationPreferences {
  return {
    masterEnabled: Boolean(source.masterEnabled),
    extremeEventsAutoEnabled: Boolean(source.extremeEventsAutoEnabled),
    globalActiveWindow: {
      enabled: Boolean(source.globalActiveWindow.enabled),
      startHHMM: source.globalActiveWindow.startHHMM,
      endHHMM: source.globalActiveWindow.endHHMM,
    },
    rules: source.rules.map((r) => ({
      ...r,
      conditions: { ...r.conditions },
      timeWindow: { ...r.timeWindow },
    })),
    updatedAtIso: source.updatedAtIso,
  };
}

function normalizeHHMM(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    return fallback;
  }
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return fallback;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function sanitizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function sanitizeConditions(
  raw: Partial<CustomNotificationConditions> | null | undefined,
): CustomNotificationConditions {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out: CustomNotificationConditions = {};
  const minTempC = sanitizeOptionalNumber(raw.minTempC);
  const maxTempC = sanitizeOptionalNumber(raw.maxTempC);
  const minPrecipProbPct = sanitizeOptionalNumber(raw.minPrecipProbPct);
  const maxWindKmh = sanitizeOptionalNumber(raw.maxWindKmh);
  const maxGustKmh = sanitizeOptionalNumber(raw.maxGustKmh);
  const maxCloudCoverPct = sanitizeOptionalNumber(raw.maxCloudCoverPct);
  const maxWaveM = sanitizeOptionalNumber(raw.maxWaveM);
  const maxKpIndex = sanitizeOptionalNumber(raw.maxKpIndex);

  if (minTempC !== null) out.minTempC = minTempC;
  if (maxTempC !== null) out.maxTempC = maxTempC;
  if (minPrecipProbPct !== null) out.minPrecipProbPct = minPrecipProbPct;
  if (maxWindKmh !== null) out.maxWindKmh = maxWindKmh;
  if (maxGustKmh !== null) out.maxGustKmh = maxGustKmh;
  if (maxCloudCoverPct !== null) out.maxCloudCoverPct = maxCloudCoverPct;
  if (maxWaveM !== null) out.maxWaveM = maxWaveM;
  if (maxKpIndex !== null) out.maxKpIndex = maxKpIndex;

  return out;
}

function sanitizeRule(raw: Partial<CustomNotificationRule>, index: number): CustomNotificationRule {
  const twRaw = raw.timeWindow;
  const rawNotifyFrom =
    twRaw?.notifyFromHHMM && typeof twRaw.notifyFromHHMM === 'string' && twRaw.notifyFromHHMM.trim()
      ? normalizeHHMM(twRaw.notifyFromHHMM, '07:00')
      : null;

  return {
    id:
      typeof raw.id === 'string' && raw.id.trim()
        ? raw.id.trim()
        : `rule-${Date.now()}-${index}`,
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : `Regra Personalizada #${index + 1}`,
    enabled: raw.enabled !== false,
    conditions: sanitizeConditions(raw.conditions),
    timeWindow: {
      startHHMM: normalizeHHMM(twRaw?.startHHMM, '06:00'),
      endHHMM: normalizeHHMM(twRaw?.endHHMM, '20:00'),
      notifyFromHHMM: rawNotifyFrom,
    },
    customTitle: typeof raw.customTitle === 'string' ? raw.customTitle : '',
    customMessage: typeof raw.customMessage === 'string' ? raw.customMessage : '',
    createdAtIso:
      typeof raw.createdAtIso === 'string' && raw.createdAtIso
        ? raw.createdAtIso
        : new Date().toISOString(),
    lastTriggeredIso:
      typeof raw.lastTriggeredIso === 'string' ? raw.lastTriggeredIso : null,
  };
}

function sanitizeNotificationPreferences(
  raw: Partial<UserNotificationPreferences> | null | undefined,
): UserNotificationPreferences {
  const globalRaw = raw?.globalActiveWindow;
  const rawRules: unknown[] = Array.isArray(raw?.rules) ? raw.rules : [];

  return {
    masterEnabled: Boolean(raw?.masterEnabled ?? DEFAULT_NOTIFICATION_PREFERENCES.masterEnabled),
    extremeEventsAutoEnabled:
      raw?.extremeEventsAutoEnabled !== undefined
        ? Boolean(raw.extremeEventsAutoEnabled)
        : DEFAULT_NOTIFICATION_PREFERENCES.extremeEventsAutoEnabled,
    globalActiveWindow: {
      enabled: Boolean(
        globalRaw?.enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.globalActiveWindow.enabled,
      ),
      startHHMM: normalizeHHMM(
        globalRaw?.startHHMM,
        DEFAULT_NOTIFICATION_PREFERENCES.globalActiveWindow.startHHMM,
      ),
      endHHMM: normalizeHHMM(
        globalRaw?.endHHMM,
        DEFAULT_NOTIFICATION_PREFERENCES.globalActiveWindow.endHHMM,
      ),
    },
    rules: rawRules
      .filter((item): item is Partial<CustomNotificationRule> => Boolean(item && typeof item === 'object'))
      .map((item, idx) => sanitizeRule(item, idx)),
    updatedAtIso:
      typeof raw?.updatedAtIso === 'string' && raw.updatedAtIso
        ? raw.updatedAtIso
        : new Date().toISOString(),
  };
}

/**
 * Carrega as preferências de notificação do usuário a partir do `localStorage`
 * (`'fieldcast_notification_prefs_v4'`), retornando padrões seguros (`masterEnabled: false`,
 * `extremeEventsAutoEnabled: true`, `rules: []`) quando ainda não configurado.
 */
export function loadNotificationPreferences(): UserNotificationPreferences {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(NOTIFICATION_PREFS_STORAGE_KEY);
      if (raw === null) {
        return clonePreferences(DEFAULT_NOTIFICATION_PREFERENCES);
      }
      const parsed = JSON.parse(raw) as Partial<UserNotificationPreferences>;
      const sanitized = sanitizeNotificationPreferences(parsed);
      memoryNotificationPrefs = sanitized;
      return clonePreferences(sanitized);
    }
  } catch {
    // Fallback em memória se localStorage estiver bloqueado ou corrompido
  }
  return clonePreferences(memoryNotificationPrefs);
}

/**
 * Salva e higieniza as preferências de notificação do usuário em `'fieldcast_notification_prefs_v4'`.
 */
export function saveNotificationPreferences(
  prefs: UserNotificationPreferences,
): UserNotificationPreferences {
  const sanitized = sanitizeNotificationPreferences({
    ...prefs,
    updatedAtIso: new Date().toISOString(),
  });
  memoryNotificationPrefs = sanitized;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(NOTIFICATION_PREFS_STORAGE_KEY, JSON.stringify(sanitized));
    }
  } catch {
    // Mantém em memória caso quota ou política do navegador restrinja escrita
  }
  return clonePreferences(sanitized);
}

/**
 * Converte uma string `"HH:MM"` em minutos desde `00:00` (`0..1439`).
 */
export function parseHHMMToMinutes(hhmm: string): number {
  if (typeof hhmm !== 'string') {
    return 0;
  }
  const trimmed = hhmm.trim();
  if (trimmed === '24:00') {
    return 1439;
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    return 0;
  }
  const rawH = Number(match[1]);
  const rawM = Number(match[2]);
  if (!Number.isFinite(rawH) || !Number.isFinite(rawM)) {
    return 0;
  }
  const hours = Math.max(0, Math.min(23, Math.floor(rawH)));
  const minutes = Math.max(0, Math.min(59, Math.floor(rawM)));
  return hours * 60 + minutes;
}

/**
 * Avalia se `minuteOfDay` (`0..1439`) pertence à janela `window` (`startHHMM`..`endHHMM`),
 * suportando tanto janelas diurnas padrão (`06:00`–`18:00`) quanto janelas que cruzam
 * a meia-noite (`22:00`–`06:00`), além de respeitar `window.notifyFromHHMM` frente a `currentMinuteOfDay`.
 */
export function isMinuteWithinTimeWindow(
  minuteOfDay: number,
  window: NotificationTimeWindow,
  currentMinuteOfDay?: number,
): boolean {
  if (!Number.isFinite(minuteOfDay)) {
    return false;
  }

  if (
    window.notifyFromHHMM !== undefined &&
    window.notifyFromHHMM !== null &&
    window.notifyFromHHMM.trim() !== '' &&
    currentMinuteOfDay !== undefined &&
    Number.isFinite(currentMinuteOfDay)
  ) {
    const notifyFromMin = parseHHMMToMinutes(window.notifyFromHHMM);
    const normalizedCurrent = ((Math.floor(currentMinuteOfDay) % 1440) + 1440) % 1440;
    if (normalizedCurrent < notifyFromMin) {
      return false;
    }
  }

  const mod = ((Math.floor(minuteOfDay) % 1440) + 1440) % 1440;
  const startMin = parseHHMMToMinutes(window.startHHMM);
  const endMin = parseHHMMToMinutes(window.endHHMM);

  if (startMin <= endMin) {
    return mod >= startMin && mod <= endMin;
  }
  return mod >= startMin || mod <= endMin;
}

export function loadNotificationLedger(now: Date = new Date()): Record<string, string> {
  const cutoffMs = now.getTime() - LEDGER_RETENTION_MS;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(NOTIFICATION_LEDGER_STORAGE_KEY);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') {
          const ts = Date.parse(v);
          if (!Number.isFinite(ts) || ts >= cutoffMs) {
            cleaned[k] = v;
          }
        }
      }
      return cleaned;
    }
  } catch {
    return {};
  }
  return { ...fallbackMemoryLedger };
}

function saveNotificationLedger(ledger: Record<string, string>): void {
  fallbackMemoryLedger = { ...ledger };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(NOTIFICATION_LEDGER_STORAGE_KEY, JSON.stringify(ledger));
    }
  } catch {
    // Mantém em memória caso localStorage lance erro
  }
}

export function clearNotificationLedger(): void {
  fallbackMemoryLedger = {};
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(NOTIFICATION_LEDGER_STORAGE_KEY);
    }
  } catch {
    // Ignora erro em ambiente restrito
  }
}

function computeMeanCloudCoverPct(hour: EnsembleHour): number | null {
  const values = [
    hour.cloudCover.lowPct.mean,
    hour.cloudCover.midPct.mean,
    hour.cloudCover.highPct.mean,
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  if (values.length === 0) {
    return null;
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

interface RuleEvaluationMatch {
  hour: EnsembleHour;
  breaches: string[];
  usedMarine: boolean;
  usedKp: boolean;
  meanCloudPct: number | null;
}

function evaluateRuleAgainstHour(
  rule: CustomNotificationRule,
  hour: EnsembleHour,
  kpValue: number | null | undefined,
): RuleEvaluationMatch | null {
  const cond = rule.conditions;
  let configuredCount = 0;
  const breaches: string[] = [];
  let usedMarine = false;
  let usedKp = false;

  const temp = hour.temperature2mC.mean;
  if (cond.minTempC !== undefined && cond.minTempC !== null && Number.isFinite(cond.minTempC)) {
    configuredCount += 1;
    if (temp !== null && Number.isFinite(temp) && temp < cond.minTempC) {
      breaches.push(`Temp ${temp.toFixed(1)} °C < ${cond.minTempC} °C`);
    }
  }

  if (cond.maxTempC !== undefined && cond.maxTempC !== null && Number.isFinite(cond.maxTempC)) {
    configuredCount += 1;
    if (temp !== null && Number.isFinite(temp) && temp > cond.maxTempC) {
      breaches.push(`Temp ${temp.toFixed(1)} °C > ${cond.maxTempC} °C`);
    }
  }

  const prob = hour.precipitationProbabilityPct.mean;
  if (
    cond.minPrecipProbPct !== undefined &&
    cond.minPrecipProbPct !== null &&
    Number.isFinite(cond.minPrecipProbPct)
  ) {
    configuredCount += 1;
    if (prob !== null && Number.isFinite(prob) && prob >= cond.minPrecipProbPct) {
      breaches.push(`Chuva ${Math.round(prob)}% >= ${cond.minPrecipProbPct}%`);
    }
  }

  const wind = hour.windSpeed10m.mean;
  if (
    cond.maxWindKmh !== undefined &&
    cond.maxWindKmh !== null &&
    Number.isFinite(cond.maxWindKmh)
  ) {
    configuredCount += 1;
    if (wind !== null && Number.isFinite(wind) && wind >= cond.maxWindKmh) {
      breaches.push(`Vento ${wind.toFixed(1)} km/h >= ${cond.maxWindKmh} km/h`);
    }
  }

  const gust = hour.windGusts10m.mean;
  if (
    cond.maxGustKmh !== undefined &&
    cond.maxGustKmh !== null &&
    Number.isFinite(cond.maxGustKmh)
  ) {
    configuredCount += 1;
    if (gust !== null && Number.isFinite(gust) && gust >= cond.maxGustKmh) {
      breaches.push(`Rajada ${gust.toFixed(1)} km/h >= ${cond.maxGustKmh} km/h`);
    }
  }

  const meanCloudPct = computeMeanCloudCoverPct(hour);
  if (
    cond.maxCloudCoverPct !== undefined &&
    cond.maxCloudCoverPct !== null &&
    Number.isFinite(cond.maxCloudCoverPct)
  ) {
    configuredCount += 1;
    if (
      meanCloudPct !== null &&
      Number.isFinite(meanCloudPct) &&
      meanCloudPct >= cond.maxCloudCoverPct
    ) {
      breaches.push(`Nebulosidade ${Math.round(meanCloudPct)}% >= ${cond.maxCloudCoverPct}%`);
    }
  }

  const wave = hour.marine?.waveHeight ?? null;
  if (cond.maxWaveM !== undefined && cond.maxWaveM !== null && Number.isFinite(cond.maxWaveM)) {
    configuredCount += 1;
    if (wave !== null && Number.isFinite(wave) && wave >= cond.maxWaveM) {
      breaches.push(`Onda ${wave.toFixed(2)} m >= ${cond.maxWaveM} m`);
      usedMarine = true;
    }
  }

  if (
    cond.maxKpIndex !== undefined &&
    cond.maxKpIndex !== null &&
    Number.isFinite(cond.maxKpIndex)
  ) {
    configuredCount += 1;
    if (kpValue !== undefined && kpValue !== null && Number.isFinite(kpValue) && kpValue >= cond.maxKpIndex) {
      breaches.push(`Kp ${kpValue.toFixed(1)} >= ${cond.maxKpIndex}`);
      usedKp = true;
    }
  }

  if (configuredCount === 0 || breaches.length === 0) {
    return null;
  }

  return {
    hour,
    breaches,
    usedMarine,
    usedKp,
    meanCloudPct,
  };
}

function formatRuleTemplateTokens(
  template: string,
  tokens: Record<string, string>,
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (fullMatch, tokenKey: string) => {
    return Object.prototype.hasOwnProperty.call(tokens, tokenKey)
      ? (tokens[tokenKey] ?? fullMatch)
      : fullMatch;
  });
}

function formatCustomRuleAlertText(params: {
  rule: CustomNotificationRule;
  match: RuleEvaluationMatch;
  timezone: string;
  kpValue?: number | null;
}): { title: string; message: string } {
  const { rule, match, timezone, kpValue } = params;
  const hourBadge = formatLocalHourBadge(match.hour.timestampUnix, timezone);
  const windowLabel = `${rule.timeWindow.startHHMM}–${rule.timeWindow.endHHMM}`;
  const detailsText = match.breaches.join(' • ');

  const tokens: Record<string, string> = {
    ruleName: rule.name,
    hour: hourBadge,
    window: windowLabel,
    details: detailsText,
    temp:
      match.hour.temperature2mC.mean !== null
        ? match.hour.temperature2mC.mean.toFixed(1)
        : '—',
    wind:
      match.hour.windSpeed10m.mean !== null
        ? match.hour.windSpeed10m.mean.toFixed(1)
        : '—',
    gust:
      match.hour.windGusts10m.mean !== null
        ? match.hour.windGusts10m.mean.toFixed(1)
        : '—',
    precipProb:
      match.hour.precipitationProbabilityPct.mean !== null
        ? String(Math.round(match.hour.precipitationProbabilityPct.mean))
        : '—',
    cloud:
      match.meanCloudPct !== null ? String(Math.round(match.meanCloudPct)) : '—',
    wave:
      match.hour.marine?.waveHeight !== null && match.hour.marine?.waveHeight !== undefined
        ? match.hour.marine.waveHeight.toFixed(2)
        : '—',
    kp:
      kpValue !== undefined && kpValue !== null && Number.isFinite(kpValue)
        ? kpValue.toFixed(1)
        : '—',
  };

  const trimmedTitle = rule.customTitle.trim();
  const title = trimmedTitle
    ? formatRuleTemplateTokens(trimmedTitle, tokens)
    : `Alerta: ${rule.name} (${hourBadge})`;

  const trimmedMessage = rule.customMessage.trim();
  const message = trimmedMessage
    ? formatRuleTemplateTokens(trimmedMessage, tokens)
    : `Janela ${windowLabel} às ${hourBadge}: ${detailsText}.`;

  return { title, message };
}

export interface EvaluatedForecastNotificationTrigger {
  key: string;
  kind: 'extreme' | 'custom';
  title: string;
  message: string;
  sourceLabel: string;
  matchedHourUnix: number;
}

/**
 * Avalia gatilhos de notificações (Eventos Extremos Automáticos + Regras Personalizadas)
 * sobre a previsão ativa, respeitando `masterEnabled`, `globalActiveWindow`, `timeWindow`
 * (inclusive cruzamento de meia-noite e `notifyFromHHMM`) e ledger de deduplicação.
 */
export function evaluateForecastNotificationTriggers(params: {
  forecast: NormalizedForecast;
  prefs: UserNotificationPreferences;
  kpValue?: number | null;
  now?: Date;
  ignoreLedger?: boolean;
}): Array<{
  key: string;
  kind: 'extreme' | 'custom';
  title: string;
  message: string;
  sourceLabel: string;
  matchedHourUnix: number;
}> {
  const { forecast, prefs, kpValue, ignoreLedger = false } = params;

  if (!prefs.masterEnabled) {
    return [];
  }

  const now = params.now ?? new Date();
  const nowUnix = Math.floor(now.getTime() / 1000);
  const nowLocalParts = getLocalDateParts(now, forecast.timezone);
  const currentMinuteOfDay = nowLocalParts.hour * 60 + nowLocalParts.minute;

  if (prefs.globalActiveWindow.enabled) {
    const insideGlobal = isMinuteWithinTimeWindow(currentMinuteOfDay, {
      startHHMM: prefs.globalActiveWindow.startHHMM,
      endHHMM: prefs.globalActiveWindow.endHHMM,
      notifyFromHHMM: null,
    });
    if (!insideGlobal) {
      return [];
    }
  }

  const ledger = ignoreLedger ? {} : loadNotificationLedger(now);
  const triggers: EvaluatedForecastNotificationTrigger[] = [];
  let ledgerMutated = false;
  const nowIso = now.toISOString();

  const tryEmitTrigger = (candidate: EvaluatedForecastNotificationTrigger): void => {
    if (!ignoreLedger && ledger[candidate.key]) {
      return;
    }
    triggers.push(candidate);
    if (!ignoreLedger) {
      ledger[candidate.key] = nowIso;
      ledgerMutated = true;
    }
  };

  if (prefs.extremeEventsAutoEnabled) {
    let hasGeomagneticExtremeAlert = false;

    if (Array.isArray(forecast.extremeEvents)) {
      for (const ev of forecast.extremeEvents) {
        if (ev.category === 'geomagnetic_storm') {
          hasGeomagneticExtremeAlert = true;
        }
        const sourceLabel = `${ev.sourceName} (${ev.sourceUrl})`;
        const coastalMslDisclaimer =
          ev.category === 'coastal_swell'
            ? ' Nota: cota oceânica MSL (~8 km) não substitui tábuas oficiais da DHN / Marinha.'
            : '';

        tryEmitTrigger({
          key: `extreme:${forecast.locationKey}:${ev.id}:${ev.peakTimestampUnix}`,
          kind: 'extreme',
          title: ev.title,
          message: `${ev.summary} (${ev.metricBadge}). Ação recomendada: ${ev.recommendedAction}${coastalMslDisclaimer} — Fonte oficial: ${ev.sourceName}.`,
          sourceLabel,
          matchedHourUnix: ev.peakTimestampUnix,
        });
      }
    }

    if (
      !hasGeomagneticExtremeAlert &&
      kpValue !== undefined &&
      kpValue !== null &&
      Number.isFinite(kpValue) &&
      kpValue >= 5
    ) {
      const gScale = Math.min(5, Math.max(1, Math.floor(kpValue) - 4));
      const matchedHourUnix =
        forecast.hours.find((h) => h.timestampUnix + 3600 > nowUnix)?.timestampUnix ??
        forecast.hours[0]?.timestampUnix ??
        nowUnix;
      const dayKey = formatLocalYMD(now, forecast.timezone);

      tryEmitTrigger({
        key: `extreme:${forecast.locationKey}:noaa-kp-g${gScale}:${dayKey}`,
        kind: 'extreme',
        title: `Tempestade Geomagnética G${gScale} (Kp ${kpValue.toFixed(1)})`,
        message: `Índice planetário Kp em ${kpValue.toFixed(1)} (escala G${gScale}). Possível degradação de sinal GNSS/GPS e telemetria VANT/drone. Fonte oficial: NOAA SWPC.`,
        sourceLabel:
          'NOAA Space Weather Prediction Center — Planetary K-index (https://services.swpc.noaa.gov)',
        matchedHourUnix,
      });
    }
  }

  const futureOrCurrentHours = forecast.hours.filter(
    (h) => h.timestampUnix + 3600 > nowUnix,
  );
  const candidateHours =
    futureOrCurrentHours.length > 0 ? futureOrCurrentHours : forecast.hours;

  for (const rule of prefs.rules) {
    if (!rule.enabled) {
      continue;
    }

    for (const hour of candidateHours) {
      const hourParts = getLocalDateParts(
        new Date(hour.timestampUnix * 1000),
        forecast.timezone,
      );
      const hourMinuteOfDay = hourParts.hour * 60 + hourParts.minute;

      if (!isMinuteWithinTimeWindow(hourMinuteOfDay, rule.timeWindow, currentMinuteOfDay)) {
        continue;
      }

      const match = evaluateRuleAgainstHour(rule, hour, kpValue);
      if (!match) {
        continue;
      }

      const formatted = formatCustomRuleAlertText({
        rule,
        match,
        timezone: forecast.timezone,
        kpValue,
      });

      const sourceParts = ['Ensemble FieldCast (Open-Meteo ECMWF/GFS/ICON/GEM)'];
      if (match.usedMarine) {
        sourceParts.push('Open-Meteo Marine (~8 km MSL; não substitui DHN/Marinha)');
      }
      if (match.usedKp) {
        sourceParts.push('NOAA SWPC Kp');
      }

      tryEmitTrigger({
        key: `custom:${forecast.locationKey}:${rule.id}:${hour.timestampUnix}`,
        kind: 'custom',
        title: formatted.title,
        message: formatted.message,
        sourceLabel: sourceParts.join(' + '),
        matchedHourUnix: hour.timestampUnix,
      });

      // Emite no máximo 1 disparo consolidado por regra por ciclo de avaliação
      break;
    }
  }

  if (ledgerMutated && !ignoreLedger) {
    saveNotificationLedger(ledger);
  }

  return triggers;
}

function hashTagToNotificationId(tag: string): number {
  let hash = 2166136261;
  for (let i = 0; i < tag.length; i++) {
    hash ^= tag.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const positive = Math.abs(hash | 0);
  return (positive % 900_000) + 10_000;
}

/**
 * Consulta o estado atual de permissão de notificações sem abrir prompt do sistema.
 */
export async function getSystemNotificationPermissionState(): Promise<
  'granted' | 'denied' | 'default' | 'unsupported'
> {
  try {
    if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FieldCastNotifications')) {
      const res = await FieldCastNotificationsBridge.checkPermissions();
      if (res?.notifications === 'granted') return 'granted';
      if (res?.notifications === 'denied') return 'denied';
      return 'default';
    }
  } catch {
    // Fallback para Web Notification API
  }

  try {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      return 'unsupported';
    }
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return 'default';
  } catch {
    return 'unsupported';
  }
}

/**
 * Solicita permissão de notificações do sistema (Android 13+/14+ `POST_NOTIFICATIONS` via Capacitor
 * ou Web `Notification.requestPermission()`), nunca lançando exceção em ambientes restritos/jsdom.
 */
export async function requestSystemNotificationPermission(): Promise<
  'granted' | 'denied' | 'unsupported'
> {
  try {
    if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FieldCastNotifications')) {
      const res = await FieldCastNotificationsBridge.requestPermissions();
      return res?.notifications === 'granted' ? 'granted' : 'denied';
    }
  } catch {
    return 'denied';
  }

  try {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      return 'unsupported';
    }
    if (Notification.permission === 'granted') {
      return 'granted';
    }
    if (Notification.permission === 'denied') {
      return 'denied';
    }
    if (typeof Notification.requestPermission === 'function') {
      const result = await Notification.requestPermission();
      return result === 'granted' ? 'granted' : 'denied';
    }
    return 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/**
 * Dispara uma notificação nativa (Android `BigTextStyle` via `FieldCastNotifications`)
 * ou Web (`ServiceWorkerRegistration.showNotification` / `new Notification`),
 * encapsulada com Zero-Crash para nunca falhar em sandbox/jsdom.
 */
export async function dispatchSystemNotification(payload: {
  title: string;
  message: string;
  sourceLabel?: string;
  tag?: string;
}): Promise<boolean> {
  const safeTitle = payload.title.trim() || 'Alerta Operacional FieldCast';
  const safeMessage = payload.message.trim();
  const safeTag = payload.tag ?? `fieldcast-${Date.now()}`;

  try {
    if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FieldCastNotifications')) {
      const res = await FieldCastNotificationsBridge.dispatchNotification({
        title: safeTitle,
        body: safeMessage,
        subText: payload.sourceLabel,
        notificationId: hashTagToNotificationId(safeTag),
      });
      return Boolean(res?.dispatched);
    }
  } catch {
    return false;
  }

  try {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      return false;
    }
    if (Notification.permission !== 'granted') {
      return false;
    }

    const fullBody =
      payload.sourceLabel && !safeMessage.includes(payload.sourceLabel)
        ? `${safeMessage}\nFonte: ${payload.sourceLabel}`
        : safeMessage;

    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.getRegistration) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration && typeof registration.showNotification === 'function') {
          await registration.showNotification(safeTitle, {
            body: fullBody,
            tag: safeTag,
            icon: '/icons/192x192.png',
            badge: '/icons/192x192.png',
          });
          return true;
        }
      } catch {
        // Fallback para construtor direto Notification
      }
    }

    new Notification(safeTitle, {
      body: fullBody,
      tag: safeTag,
      icon: '/icons/192x192.png',
    });
    return true;
  } catch {
    return false;
  }
}
