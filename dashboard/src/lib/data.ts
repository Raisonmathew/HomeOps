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

// ---------------------------------------------------------------------------
// CSV export (spec "Export operational data")
// ---------------------------------------------------------------------------

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s =
    value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join('; ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Names and comments come from Telegram users: stop spreadsheets from running them as formulas
  // (but leave plain numbers and phone numbers like +91 98... alone).
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d[\d\s().-]*$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Downloads rows as a CSV file; columns are the union of the rows' keys, in first-seen order. */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  const headers: string[] = [];
  for (const row of rows) for (const k of Object.keys(row)) if (!headers.includes(k)) headers.push(k);
  const lines = [headers.map(csvCell).join(','), ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(','))];
  // BOM so Excel opens UTF-8 (names in local scripts) correctly.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** e.g. "requests-2026-11-06" */
export const csvName = (base: string) => `${base}-${new Date().toISOString().slice(0, 10)}.csv`;

// ---------------------------------------------------------------------------
// Operator actions that go through the Worker (it holds the Telegram bot token)
// ---------------------------------------------------------------------------

const WORKER_URL = (import.meta.env.VITE_WORKER_URL || 'https://homeops-worker.homeops-app.workers.dev').replace(/\/+$/, '');

/** POSTs JSON to the Worker with the operator's Supabase access token; throws with the Worker's error message. */
export async function callWorker(path: string, body: unknown): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('You are signed out. Sign in again and retry.');

  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Could not reach the Worker at ${WORKER_URL}: ${(err as Error).message}`);
  }

  let payload: { ok?: boolean; error?: string } | null = null;
  try {
    payload = await res.json();
  } catch {
    // non-JSON body (e.g. a Cloudflare error page); fall through to the status code
  }
  if (!res.ok || payload?.ok !== true) throw new Error(payload?.error || `Worker returned HTTP ${res.status}`);
}

/** technicianId is technician_profiles.id (the same id as service_requests.assigned_technician_id). */
export const operatorAssign = (requestId: string, technicianId: string) => callWorker('/api/operator/assign', { requestId, technicianId });
export const operatorCancel = (requestId: string, reason: string) => callWorker('/api/operator/cancel', { requestId, reason });
export const operatorResolve = (requestId: string, outcome: 'COMPLETED' | 'PARTIALLY_COMPLETED') =>
  callWorker('/api/operator/resolve', { requestId, outcome });

export type AccountAction = 'WARN' | 'RESTRICT' | 'SUSPEND' | 'REACTIVATE';
/** profileId is profiles.id. The Worker updates the account, notifies the user on Telegram (reason is sent to them),
 *  and on SUSPEND of a technician releases their active jobs and re-matches those customers. */
export const operatorAccountAction = (profileId: string, action: AccountAction, reason: string) =>
  callWorker('/api/operator/account', { profileId, action, reason });

// ---------------------------------------------------------------------------
// Status lists
// ---------------------------------------------------------------------------

/** Statuses where an operator may assign or reassign a technician. */
export const ASSIGNABLE_STATUSES = ['SEARCHING', 'NO_TECHNICIAN_FOUND', 'ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE'];
/** Statuses after which a request can no longer be cancelled. */
export const TERMINAL_STATUSES = [
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'EXPIRED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_TECHNICIAN',
  'CANCELLED_BY_OPERATOR',
];

export const ACTIVE_ASSIGNMENT_STATUSES =['ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE', 'AGREED', 'IN_PROGRESS'];
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
