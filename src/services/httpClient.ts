import type { ZodType, ZodTypeDef } from 'zod';
import { logErrorToDb } from '../db/database';
import type {
  HealthLevel,
  MonitoredServiceId,
  ServiceEndpointStatus,
} from '../types/health';

export const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_BACKOFF_BASE_MS = 300;
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
export const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;

const SERVICE_LABELS: Record<MonitoredServiceId, string> = {
  open_meteo_forecast: 'Open-Meteo Forecast (Multi-modelo)',
  open_meteo_marine: 'Open-Meteo Marine (Ondas & Correntes)',
  rainviewer: 'RainViewer Radar',
  nominatim: 'Nominatim Geocoding (OSM)',
  ipwhois: 'IP Geolocation (ipwho.is)',
};

interface InternalCircuitState extends ServiceEndpointStatus {
  openedAtMs: number | null;
}

function createInitialState(service: MonitoredServiceId): InternalCircuitState {
  return {
    service,
    label: SERVICE_LABELS[service],
    status: 'healthy',
    latencyMs: null,
    lastCheckedIso: null,
    circuitOpen: false,
    consecutiveFailures: 0,
    message: 'Aguardando primeira verificação',
    openedAtMs: null,
  };
}

const circuitRegistry: Record<MonitoredServiceId, InternalCircuitState> = {
  open_meteo_forecast: createInitialState('open_meteo_forecast'),
  open_meteo_marine: createInitialState('open_meteo_marine'),
  rainviewer: createInitialState('rainviewer'),
  nominatim: createInitialState('nominatim'),
  ipwhois: createInitialState('ipwhois'),
};

export class CircuitOpenError extends Error {
  public readonly service: MonitoredServiceId;

  constructor(service: MonitoredServiceId, customMessage?: string) {
    super(
      customMessage ??
        `Circuit Breaker aberto para ${SERVICE_LABELS[service]} após múltiplas falhas consecutivas.`,
    );
    this.name = 'CircuitOpenError';
    this.service = service;
  }
}

export interface HttpRequestOptions<T> {
  service: MonitoredServiceId;
  url: string;
  schema: ZodType<T, ZodTypeDef, unknown>;
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  failureThreshold?: number;
  cooldownMs?: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  /**
   * Se `true`, quando o circuito abre o status fica `degraded` (âmbar) em vez de `down` (vermelho)
   * (usado para serviços não-bloqueantes como RainViewer).
   */
  degradedOnOpen?: boolean;
  /**
   * Callback opcional de fallback automático (ex.: leitura do cache IndexedDB / Dexie)
   * acionado quando a rede/validação falha ou quando o Circuit Breaker está aberto.
   */
  fallback?: (error: Error, circuitOpen: boolean) => T | Promise<T>;
}

export interface HttpClientResult<T> {
  data: T;
  fromFallback: boolean;
  latencyMs: number;
  circuitOpen: boolean;
}

function delayMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Registra sucesso em um endpoint monitorado e fecha o Circuit Breaker.
 */
export function recordServiceSuccess(
  service: MonitoredServiceId,
  latencyMs: number,
  message = 'Operacional',
): ServiceEndpointStatus {
  const state = circuitRegistry[service];
  state.status = 'healthy';
  state.latencyMs = Math.max(0, Math.round(latencyMs));
  state.lastCheckedIso = new Date().toISOString();
  state.circuitOpen = false;
  state.consecutiveFailures = 0;
  state.openedAtMs = null;
  state.message = message;
  return getServiceEndpointStatus(service);
}

/**
 * Registra falha em um endpoint monitorado e abre o Circuit Breaker ao atingir 3 falhas consecutivas.
 */
export function recordServiceFailure(
  service: MonitoredServiceId,
  errorMessage: string,
  options?: {
    failureThreshold?: number;
    degradedOnOpen?: boolean;
    latencyMs?: number | null;
  },
): ServiceEndpointStatus {
  const threshold = options?.failureThreshold ?? CIRCUIT_BREAKER_FAILURE_THRESHOLD;
  const state = circuitRegistry[service];
  state.consecutiveFailures += 1;
  state.lastCheckedIso = new Date().toISOString();
  if (options?.latencyMs !== undefined) {
    state.latencyMs = options.latencyMs;
  }
  state.message = errorMessage;

  if (state.consecutiveFailures >= threshold) {
    state.circuitOpen = true;
    state.openedAtMs = Date.now();
    state.status = options?.degradedOnOpen ? 'degraded' : 'down';
  } else {
    state.status = 'degraded';
  }

  return getServiceEndpointStatus(service);
}

/**
 * Marca um serviço explicitamente como degradado (âmbar) sem abrir o circuito como erro fatal.
 */
export function markServiceDegraded(
  service: MonitoredServiceId,
  message: string,
): ServiceEndpointStatus {
  const state = circuitRegistry[service];
  state.status = 'degraded';
  state.lastCheckedIso = new Date().toISOString();
  state.message = message;
  return getServiceEndpointStatus(service);
}

/**
 * Retorna o status atual de um endpoint monitorado.
 */
export function getServiceEndpointStatus(service: MonitoredServiceId): ServiceEndpointStatus {
  const { openedAtMs: _ignored, ...publicStatus } = circuitRegistry[service];
  return { ...publicStatus };
}

/**
 * Retorna um snapshot completo de todos os endpoints monitorados pelo Health Check.
 */
export function getEndpointHealthSnapshot(): Record<MonitoredServiceId, ServiceEndpointStatus> {
  return {
    open_meteo_forecast: getServiceEndpointStatus('open_meteo_forecast'),
    open_meteo_marine: getServiceEndpointStatus('open_meteo_marine'),
    rainviewer: getServiceEndpointStatus('rainviewer'),
    nominatim: getServiceEndpointStatus('nominatim'),
    ipwhois: getServiceEndpointStatus('ipwhois'),
  };
}

/**
 * Calcula o nível geral de saúde das APIs monitoradas.
 */
export function getOverallEndpointsHealthLevel(): HealthLevel {
  const snap = getEndpointHealthSnapshot();
  if (snap.open_meteo_forecast.status === 'down') {
    return 'down';
  }
  const all = Object.values(snap);
  if (all.some((s) => s.status === 'down' || s.status === 'degraded')) {
    return 'degraded';
  }
  return 'healthy';
}

/**
 * Reseta o Circuit Breaker de um serviço específico ou de todos os serviços.
 */
export function resetCircuitBreaker(service?: MonitoredServiceId): void {
  if (service) {
    circuitRegistry[service] = createInitialState(service);
    return;
  }
  (Object.keys(circuitRegistry) as MonitoredServiceId[]).forEach((key) => {
    circuitRegistry[key] = createInitialState(key);
  });
}

/**
 * Executa uma chamada HTTP JSON protegida por:
 * - Timeout via `AbortController` (padrão 10s)
 * - Até 2 retries com backoff exponencial
 * - Validação estrita de schema `zod`
 * - Circuit Breaker (abre após 3 falhas consecutivas)
 * - Fallback automático (ex.: Dexie IndexedDB) quando disponível
 */
export async function fetchWithCircuitBreaker<T>(
  options: HttpRequestOptions<T>,
): Promise<HttpClientResult<T>> {
  const {
    service,
    url,
    schema,
    timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
    failureThreshold = CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    cooldownMs = CIRCUIT_BREAKER_COOLDOWN_MS,
    headers,
    fetchImpl = globalThis.fetch,
    degradedOnOpen = false,
    fallback,
  } = options;

  const state = circuitRegistry[service];

  // Verifica se o Circuit Breaker já está aberto e dentro da janela de cooldown
  if (state.circuitOpen && state.openedAtMs !== null) {
    const elapsedSinceOpen = Date.now() - state.openedAtMs;
    if (elapsedSinceOpen < cooldownMs) {
      const openErr = new CircuitOpenError(service);
      if (fallback) {
        const fallbackData = await fallback(openErr, true);
        return {
          data: fallbackData,
          fromFallback: true,
          latencyMs: 0,
          circuitOpen: true,
        };
      }
      throw openErr;
    }
  }

  // Sanitiza headers para nunca sobrescrever User-Agent no navegador (Regra Nominatim/CORS)
  const safeHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  };
  for (const k of Object.keys(safeHeaders)) {
    if (k.toLowerCase() === 'user-agent') {
      delete safeHeaders[k];
    }
  }

  let lastError: Error = new Error(`Falha desconhecida ao acessar ${url}`);
  const startOverallMs = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const waitTime = backoffBaseMs * Math.pow(2, attempt - 1);
      await delayMs(waitTime);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const attemptStartMs = Date.now();

    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: safeHeaders,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} (${response.statusText || 'Erro de resposta'})`);
      }

      const rawJson: unknown = await response.json();
      const validated = schema.parse(rawJson);
      const latencyMs = Date.now() - attemptStartMs;

      recordServiceSuccess(service, latencyMs);

      return {
        data: validated,
        fromFallback: false,
        latencyMs,
        circuitOpen: false,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error(`Timeout de ${timeoutMs}ms excedido em ${SERVICE_LABELS[service]}`);
      } else if (err instanceof Error) {
        lastError = err;
      } else {
        lastError = new Error(String(err));
      }
    }
  }

  const totalElapsedMs = Date.now() - startOverallMs;
  const updatedStatus = recordServiceFailure(service, lastError.message, {
    failureThreshold,
    degradedOnOpen,
    latencyMs: totalElapsedMs,
  });

  await logErrorToDb({
    timestampUtcIso: new Date().toISOString(),
    module: `httpClient:${service}`,
    action: url,
    message: lastError.message,
    stack: lastError.stack,
  });

  if (fallback) {
    const fallbackData = await fallback(lastError, updatedStatus.circuitOpen);
    return {
      data: fallbackData,
      fromFallback: true,
      latencyMs: totalElapsedMs,
      circuitOpen: updatedStatus.circuitOpen,
    };
  }

  throw lastError;
}
