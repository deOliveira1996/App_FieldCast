import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearInFlightActions,
  createSafeHandler,
  isActionInFlight,
  safeAction,
} from '../utils/safeAction';

describe('safeAction utility', () => {
  beforeEach(() => {
    clearInFlightActions();
  });

  it('executes action successfully and triggers loading and success callbacks', async () => {
    const loadingStates: boolean[] = [];
    const onToast = vi.fn();
    const onSuccess = vi.fn();

    const result = await safeAction(
      async () => {
        return 42;
      },
      {
        actionKey: 'calc-42',
        successTitle: 'Cálculo concluído',
        onLoadingChange: (loading) => loadingStates.push(loading),
        onToast,
        onSuccess,
      },
    );

    expect(result.ok).toBe(true);
    expect(result.skippedDuplicate).toBe(false);
    expect(result.data).toBe(42);
    expect(loadingStates).toEqual([true, false]);
    expect(onSuccess).toHaveBeenCalledWith(42);
    expect(onToast).toHaveBeenCalledWith({
      type: 'success',
      title: 'Cálculo concluído',
    });
    expect(isActionInFlight('calc-42')).toBe(false);
  });

  it('prevents concurrent duplicate clicks with the same actionKey', async () => {
    let resolveFirst!: (val: string) => void;
    const firstPromise = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });

    const executionCount = vi.fn();

    const call1 = safeAction(
      async () => {
        executionCount();
        return firstPromise;
      },
      { actionKey: 'download-mission' },
    );

    expect(isActionInFlight('download-mission')).toBe(true);

    const call2 = await safeAction(
      async () => {
        executionCount();
        return 'duplicate';
      },
      { actionKey: 'download-mission', fallbackValue: 'skipped' },
    );

    expect(call2.ok).toBe(false);
    expect(call2.skippedDuplicate).toBe(true);
    expect(call2.data).toBe('skipped');
    expect(executionCount).toHaveBeenCalledTimes(1);

    resolveFirst('completed-first');
    const res1 = await call1;
    expect(res1.ok).toBe(true);
    expect(res1.data).toBe('completed-first');
    expect(isActionInFlight('download-mission')).toBe(false);
  });

  it('catches errors without crashing, triggers error toast and error log, and resets loading state', async () => {
    const loadingStates: boolean[] = [];
    const onToast = vi.fn();
    const onErrorLog = vi.fn();
    const onError = vi.fn();

    const result = await safeAction(
      async () => {
        throw new Error('Falha de conexão com sensor');
      },
      {
        actionKey: 'read-sensor',
        moduleName: 'FieldOps',
        errorTitle: 'Erro de Leitura',
        fallbackValue: -1,
        onLoadingChange: (l) => loadingStates.push(l),
        onToast,
        onErrorLog,
        onError,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.skippedDuplicate).toBe(false);
    expect(result.data).toBe(-1);
    expect(result.error?.message).toBe('Falha de conexão com sensor');
    expect(loadingStates).toEqual([true, false]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onToast).toHaveBeenCalledWith({
      type: 'error',
      title: 'Erro de Leitura',
      message: 'Falha de conexão com sensor',
    });
    expect(onErrorLog).toHaveBeenCalledTimes(1);
    expect(onErrorLog.mock.calls[0]?.[0]).toMatchObject({
      module: 'FieldOps',
      action: 'read-sensor',
      message: 'Falha de conexão com sensor',
    });
    expect(isActionInFlight('read-sensor')).toBe(false);
  });

  it('createSafeHandler wraps arguments and delegates to safeAction', async () => {
    const handler = createSafeHandler(
      async (a: number, b: number) => a + b,
      { actionKey: 'sum-handler' },
    );

    const res = await handler(10, 15);
    expect(res.ok).toBe(true);
    expect(res.data).toBe(25);
  });
});
