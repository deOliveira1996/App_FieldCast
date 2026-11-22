import type { ErrorLogRecord, ToastMessage } from '../types/health';

const inFlightActions = new Set<string>();

export interface SafeActionOptions<T> {
  /**
   * Identificador único da ação para bloqueio anti-duplo-clique enquanto estiver em andamento.
   */
  actionKey?: string;
  /**
   * Nome do módulo ou componente de origem (para telemetria local e log de erro).
   */
  moduleName?: string;
  /**
   * Mensagem amigável de erro exibida caso a ação falhe.
   */
  errorTitle?: string;
  /**
   * Mensagem opcional de sucesso exibida quando a ação conclui.
   */
  successTitle?: string;
  /**
   * Callback disparado ao iniciar (`true`) e finalizar (`false`) a execução.
   */
  onLoadingChange?: (isLoading: boolean) => void;
  /**
   * Callback opcional para exibir um Toast visual na interface.
   */
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  /**
   * Callback opcional para gravar falha no log de erros (ex.: IndexedDB / Dexie).
   */
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
  /**
   * Callback chamado com o resultado em caso de sucesso.
   */
  onSuccess?: (result: T) => void;
  /**
   * Callback chamado com o erro normalizado em caso de falha.
   */
  onError?: (error: Error) => void;
  /**
   * Valor de fallback retornado quando ocorre erro.
   */
  fallbackValue?: T;
}

export interface SafeActionResult<T> {
  ok: boolean;
  skippedDuplicate: boolean;
  data?: T;
  error?: Error;
}

export function isActionInFlight(actionKey: string): boolean {
  return inFlightActions.has(actionKey);
}

export function clearInFlightActions(): void {
  inFlightActions.clear();
}

export function normalizeError(err: unknown): Error {
  if (err instanceof Error) {
    return err;
  }
  if (typeof err === 'string') {
    return new Error(err);
  }
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error('Erro desconhecido durante a operação.');
  }
}

/**
 * Executa uma ação síncrona ou assíncrona com trava anti-duplo-clique,
 * captura garantida de exceções (Zero-Crash) e hooks de loading/toast/errorLog.
 */
export async function safeAction<T>(
  actionFn: () => T | Promise<T>,
  options: SafeActionOptions<T> = {},
): Promise<SafeActionResult<T>> {
  const {
    actionKey,
    moduleName = 'FieldCast',
    errorTitle = 'Falha ao executar ação',
    successTitle,
    onLoadingChange,
    onToast,
    onErrorLog,
    onSuccess,
    onError,
    fallbackValue,
  } = options;

  if (actionKey && inFlightActions.has(actionKey)) {
    return {
      ok: false,
      skippedDuplicate: true,
      data: fallbackValue,
    };
  }

  if (actionKey) {
    inFlightActions.add(actionKey);
  }

  try {
    onLoadingChange?.(true);
    const data = await actionFn();
    onSuccess?.(data);

    if (successTitle && onToast) {
      onToast({
        type: 'success',
        title: successTitle,
      });
    }

    return {
      ok: true,
      skippedDuplicate: false,
      data,
    };
  } catch (rawError: unknown) {
    const error = normalizeError(rawError);

    onError?.(error);

    if (onToast) {
      onToast({
        type: 'error',
        title: errorTitle,
        message: error.message,
      });
    }

    if (onErrorLog) {
      const logRecord: ErrorLogRecord = {
        timestampUtcIso: new Date().toISOString(),
        module: moduleName,
        action: actionKey ?? errorTitle,
        message: error.message,
        stack: error.stack,
      };
      try {
        await onErrorLog(logRecord);
      } catch {
        // Silencia erro secundário do logger para preservar arquitetura Zero-Crash
      }
    }

    return {
      ok: false,
      skippedDuplicate: false,
      data: fallbackValue,
      error,
    };
  } finally {
    if (actionKey) {
      inFlightActions.delete(actionKey);
    }
    try {
      onLoadingChange?.(false);
    } catch {
      // Ignora erro de callback em componente desmontado
    }
  }
}

/**
 * Cria um handler seguro pronto para ser conectado a `onClick` ou `onSubmit` no React.
 */
export function createSafeHandler<TArgs extends unknown[], TResult = void>(
  handlerFn: (...args: TArgs) => TResult | Promise<TResult>,
  options: SafeActionOptions<TResult> = {},
): (...args: TArgs) => Promise<SafeActionResult<TResult>> {
  return (...args: TArgs) => safeAction(() => handlerFn(...args), options);
}
