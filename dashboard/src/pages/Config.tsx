import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { currentOperatorProfileId, must, timeAgo, useLoader, write } from '../lib/data';
import { ErrorBox, Loading, PageHeader } from '../components/ui';

interface ConfigRow {
  key: string;
  value: number | string; // NUMERIC may arrive as a string
  description: string | null;
  updated_at: string;
  updater: { full_name: string } | null;
}

// marketplace_config keys are "<GROUP>.<NAME>"; the Worker re-reads them every minute.
const GROUPS: { prefix: string; title: string }[] = [
  { prefix: 'MATCHING_WEIGHTS', title: 'Matching Weights' },
  { prefix: 'BATCH_CONFIG', title: 'Offer Batching' },
  { prefix: 'SEARCH', title: 'Search' },
  { prefix: 'RETENTION', title: 'Data Retention' },
];
const prefixOf = (key: string) => key.split('.')[0];

/** null if valid, otherwise the error message. */
const validate = (raw: string): string | null => {
  if (raw.trim() === '') return 'Required';
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'Not a number';
  if (n < 0) return 'Must be 0 or more';
  return null;
};

const label = (key: string) =>
  key
    .toLowerCase()
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

export const Config: React.FC = () => {
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, reload: reloadCatalog } = useLoader(async () => {
    return must(
      await supabase
        .from('service_categories')
        .select('id, name, active, display_order, issues:issue_types(id, name, urgency_level, active)')
        .order('display_order', { ascending: true })
    ) as any[];
  });

  const params = useLoader(async () => {
    return must(
      await supabase.from('marketplace_config').select('key, value, description, updated_at, updater:profiles(full_name)').order('key')
    ) as unknown as ConfigRow[];
  });

  const reload = () => {
    reloadCatalog();
    params.reload();
  };

  const toggle = async (table: 'service_categories' | 'issue_types', id: string, active: boolean) => {
    setBusy(id);
    try {
      await write(supabase.from(table).update({ active }).eq('id', id));
      await reloadCatalog();
    } catch (err) {
      alert(`Update failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader title="Marketplace Configuration" subtitle="Service catalog and matching parameters" onRefresh={reload} loading={loading} />

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Service Catalog</h3>
          <p className="text-xs text-gray-500 mt-1">Turn categories or issue types off to hide them from customers in the bot immediately.</p>
        </div>
        {error ? (
          <ErrorBox message={error} />
        ) : loading && !data ? (
          <Loading />
        ) : (
          <div className="space-y-4">
            {(data ?? []).map((cat) => (
              <div key={cat.id} className="border border-gray-100 rounded-lg">
                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 rounded-t-lg">
                  <span className="font-semibold text-gray-900">{cat.name}</span>
                  <Toggle checked={cat.active} disabled={busy === cat.id} onChange={(v) => toggle('service_categories', cat.id, v)} />
                </div>
                <ul className="divide-y divide-gray-100">
                  {(cat.issues ?? []).map((iss: any) => (
                    <li key={iss.id} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span className={iss.active ? 'text-gray-700' : 'text-gray-400 line-through'}>
                        {iss.name}
                        {iss.urgency_level !== 'NORMAL' && <span className="ml-2 text-xs font-semibold text-rose-600">{iss.urgency_level}</span>}
                      </span>
                      <Toggle checked={iss.active} disabled={busy === iss.id} onChange={(v) => toggle('issue_types', iss.id, v)} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Matching Parameters</h3>
          <p className="text-xs text-gray-500 mt-1">
            Stored in <code className="font-mono">marketplace_config</code>. The Worker picks up saved changes within about a minute; no redeploy needed.
          </p>
        </div>
        {params.error ? (
          <ErrorBox message={params.error} />
        ) : params.loading && !params.data ? (
          <Loading />
        ) : !params.data?.length ? (
          <p className="text-sm text-gray-400">No parameters found. Apply migration 00009 to seed marketplace_config.</p>
        ) : (
          <ParamsForm rows={params.data} onSaved={params.reload} />
        )}
      </div>
    </div>
  );
};

const ParamsForm: React.FC<{ rows: ConfigRow[]; onSaved: () => Promise<void> }> = ({ rows, onSaved }) => {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const draftOf = (r: ConfigRow) => drafts[r.key] ?? String(Number(r.value));
  const isDirty = (r: ConfigRow) => drafts[r.key] !== undefined && Number(drafts[r.key]) !== Number(r.value);
  const changed = rows.filter(isDirty);
  const invalid = rows.some((r) => drafts[r.key] !== undefined && validate(drafts[r.key]) !== null);

  const known = new Set(GROUPS.map((g) => g.prefix));
  const groups = [
    ...GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => prefixOf(r.key) === g.prefix) })),
    { prefix: '', title: 'Other', rows: rows.filter((r) => !known.has(prefixOf(r.key))) },
  ].filter((g) => g.rows.length > 0);

  const save = async () => {
    if (invalid || changed.length === 0) return;
    setSaving(true);
    try {
      const operatorProfileId = await currentOperatorProfileId();
      if (!operatorProfileId) throw new Error('Your operator profile could not be found.');
      const now = new Date().toISOString();
      await Promise.all(
        changed.map(async (r) => {
          const { data, error } = await supabase
            .from('marketplace_config')
            .update({ value: Number(drafts[r.key]), updated_at: now, updated_by: operatorProfileId })
            .eq('key', r.key)
            .select('key');
          if (error) throw new Error(`${r.key}: ${error.message}`);
          if (!data?.length) throw new Error(`${r.key}: not saved (row missing or no permission)`);
        })
      );
      setDrafts({});
    } catch (err) {
      alert(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
      await onSaved(); // after a partial failure this shows which rows did save
    }
  };

  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const weightTotal = g.prefix === 'MATCHING_WEIGHTS' ? g.rows.reduce((sum, r) => sum + (Number(draftOf(r)) || 0), 0) : null;
        return (
          <div key={g.prefix || 'other'}>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">
              {g.title}
              {weightTotal !== null && <span className="ml-2 text-xs font-normal text-gray-400">total {weightTotal}</span>}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {g.rows.map((r) => {
                const value = draftOf(r);
                const err = drafts[r.key] !== undefined ? validate(value) : null;
                return (
                  <label
                    key={r.key}
                    className={`block px-3 py-2 rounded-lg border ${
                      err ? 'border-rose-300 bg-rose-50' : isDirty(r) ? 'border-sky-300 bg-sky-50' : 'border-gray-100 bg-gray-50'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-700">{label(g.prefix ? r.key.slice(g.prefix.length + 1) : r.key)}</span>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={value}
                        disabled={saving}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.key]: e.target.value }))}
                        className="w-24 px-2 py-1 text-sm text-right border border-gray-200 rounded bg-white"
                      />
                    </span>
                    {r.description && <span className="block text-xs text-gray-500 mt-1">{r.description}</span>}
                    <span className="block text-[11px] mt-0.5 text-gray-400">
                      {err ? (
                        <span className="text-rose-700 font-medium">{err}</span>
                      ) : (
                        <>
                          Last changed {timeAgo(r.updated_at)}
                          {r.updater?.full_name ? ` by ${r.updater.full_name}` : ''}
                        </>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
        {invalid && <span className="text-xs text-rose-700 mr-auto">Fix the highlighted values before saving.</span>}
        <button
          onClick={() => setDrafts({})}
          disabled={saving || Object.keys(drafts).length === 0}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          Discard changes
        </button>
        <button
          onClick={save}
          disabled={saving || invalid || changed.length === 0}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
        >
          {saving ? 'Saving...' : changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Save'}
        </button>
      </div>
    </div>
  );
};

const Toggle: React.FC<{ checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }> = ({ checked, disabled, onChange }) => (
  <button
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-gray-300'}`}
  >
    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
  </button>
);
