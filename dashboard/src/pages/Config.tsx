import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { must, useLoader, write } from '../lib/data';
// Single source of truth: the values the Worker actually runs with.
import { BATCH_CONFIG, MATCHING_WEIGHTS } from '../../../worker/src/config/constants';
import { ErrorBox, Loading, PageHeader } from '../components/ui';

const label = (key: string) =>
  key
    .toLowerCase()
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

export const Config: React.FC = () => {
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, reload } = useLoader(async () => {
    return must(
      await supabase
        .from('service_categories')
        .select('id, name, active, display_order, issues:issue_types(id, name, urgency_level, active)')
        .order('display_order', { ascending: true })
    ) as any[];
  });

  const toggle = async (table: 'service_categories' | 'issue_types', id: string, active: boolean) => {
    setBusy(id);
    try {
      await write(supabase.from(table).update({ active }).eq('id', id));
      await reload();
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
            Read-only. These are compiled into the Worker. To change them, edit <code className="font-mono">worker/src/config/constants.ts</code> and
            redeploy the Worker and the dashboard.
          </p>
        </div>
        <ParamGrid title="Matching Weights" values={MATCHING_WEIGHTS} />
        <ParamGrid title="Offer Batching" values={BATCH_CONFIG} />
      </div>
    </div>
  );
};

const ParamGrid: React.FC<{ title: string; values: Record<string, number> }> = ({ title, values }) => (
  <div>
    <h4 className="text-sm font-semibold text-gray-700 mb-2">{title}</h4>
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
      {Object.entries(values).map(([k, v]) => (
        <div key={k} className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
          <p className="text-xs text-gray-500">{label(k)}</p>
          <p className="font-semibold text-gray-900">{v}</p>
        </div>
      ))}
    </div>
  </div>
);

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
