import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

/** Runs an async loader on mount (and on reload()), tracking loading/error state. */
export function useLoader<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loader());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload };
}

/** Unwraps a Supabase response, throwing its error so useLoader can display it. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** Throws if a Supabase write failed; otherwise resolves. */
export async function write(op: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await op;
  if (error) throw new Error(error.message);
}

/** profiles.id of the logged-in operator (for approved_by etc.). */
export async function currentOperatorProfileId(): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from('operator_profiles')
    .select('profile_id')
    .eq('supabase_auth_user_id', auth.user.id)
    .maybeSingle();
  return data?.profile_id ?? null;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '-';
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${Math.max(secs, 0)}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function pct(rate: number | string | null | undefined): string {
  if (rate === null || rate === undefined) return '-';
  return `${Math.round(Number(rate) * 100)}%`;
}

export const ACTIVE_ASSIGNMENT_STATUSES = ['ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE', 'AGREED', 'IN_PROGRESS'];
export const AWAITING_CONFIRMATION_STATUSES = ['TECHNICIAN_MARKED_COMPLETE', 'CUSTOMER_CONFIRMATION_PENDING'];
export const CLOSED_STATUSES = [
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'UNABLE_TO_COMPLETE',
  'EXPIRED',
  'NO_TECHNICIAN_FOUND',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_TECHNICIAN',
  'CANCELLED_BY_OPERATOR',
];
