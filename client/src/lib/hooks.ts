import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AIStatus } from '@shared/ai';
import { AiError, fetchAiStatus, toAiError } from './api';
import { loadBundle, type CaseBundle } from './bundle';
import { db, DEFAULT_SETTINGS, getSettings } from './db';
import type { AppSettings } from './types';

export function useSettings(): AppSettings {
  return useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS) ?? DEFAULT_SETTINGS;
}

/** Live case bundle; `null` while loading, `undefined` when the case does not exist. */
export function useBundle(caseId: string | undefined): CaseBundle | undefined | null {
  return useLiveQuery(async () => (caseId ? ((await loadBundle(db, caseId)) ?? undefined) : undefined), [caseId], null);
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function useAiStatus(probe = false) {
  const [status, setStatus] = useState<AIStatus | undefined>();
  const [error, setError] = useState<AiError | undefined>();
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async (withProbe = probe) => {
    setLoading(true);
    try {
      setStatus(await fetchAiStatus(withProbe));
      setError(undefined);
    } catch (e) {
      setError(e instanceof AiError ? e : new AiError('AI_NETWORK_ERROR'));
    } finally {
      setLoading(false);
    }
  }, [probe]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, error, loading, refresh };
}

/** Runs an AI action with loading and student-safe error state. The last action can be retried. */
export function useAiRunner() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AiError | undefined>();
  const last = useRef<(() => Promise<unknown>) | undefined>(undefined);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    last.current = fn;
    setLoading(true);
    setError(undefined);
    try {
      return await fn();
    } catch (e) {
      setError(toAiError(e));
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);
  const retry = useCallback(() => (last.current ? run(last.current) : Promise.resolve(undefined)), [run]);
  const reset = useCallback(() => setError(undefined), []);
  return { loading, error, run, retry, reset };
}
