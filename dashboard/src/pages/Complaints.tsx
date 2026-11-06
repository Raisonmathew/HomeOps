import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { must, timeAgo, useLoader, write } from '../lib/data';
import { Badge, Empty, ErrorBox, FilterTabs, Loading, PageHeader } from '../components/ui';

const FILTERS: Record<string, string[] | null> = {
  OPEN: ['OPEN', 'CUSTOMER_CONTACTED', 'TECHNICIAN_CONTACTED', 'UNDER_REVIEW'],
  CLOSED: ['RESOLVED', 'ACCOUNT_ACTION_TAKEN'],
  ALL: null,
};

const STATUS_OPTIONS = ['OPEN', 'CUSTOMER_CONTACTED', 'TECHNICIAN_CONTACTED', 'UNDER_REVIEW', 'RESOLVED', 'ACCOUNT_ACTION_TAKEN'];
const CLOSED = ['RESOLVED', 'ACCOUNT_ACTION_TAKEN'];

const COMPLAINT_SELECT =
  'id, complaint_type, description, status, operator_notes, created_at, resolved_at, ' +
  'request:service_requests(request_number), ' +
  'reporter:profiles!complaints_reported_by_fkey(full_name, role, telegram_username), ' +
  'against:profiles!complaints_reported_against_fkey(full_name, role, telegram_username)';

export const Complaints: React.FC = () => {
  const [filter, setFilter] = useState('OPEN');

  const { data, error, loading, reload } = useLoader(async () => {
    let q = supabase.from('complaints').select(COMPLAINT_SELECT).order('created_at', { ascending: false });
    const statuses = FILTERS[filter];
    if (statuses) q = q.in('status', statuses);
    return must(await q) as any[];
  }, [filter]);

  return (
    <div className="space-y-6">
      <PageHeader title="Complaint Management" subtitle="Review disputes, contact parties, and record outcomes" onRefresh={reload} loading={loading}>
        <FilterTabs options={Object.keys(FILTERS)} value={filter} onChange={setFilter} />
      </PageHeader>

      {error ? (
        <ErrorBox message={error} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.length ? (
        <Empty message="No complaints in this list." />
      ) : (
        <div className="space-y-4">
          {data.map((c) => (
            <ComplaintCard key={c.id} complaint={c} onSaved={reload} />
          ))}
        </div>
      )}
    </div>
  );
};

const Party: React.FC<{ p: any }> = ({ p }) =>
  p ? (
    <strong className="text-gray-700">
      {p.full_name} ({p.role?.toLowerCase()})
      {p.telegram_username && (
        <a href={`https://t.me/${p.telegram_username}`} target="_blank" rel="noreferrer" className="ml-1 font-normal text-sky-600 hover:underline">
          @{p.telegram_username}
        </a>
      )}
    </strong>
  ) : (
    <strong>-</strong>
  );

const ComplaintCard: React.FC<{ complaint: any; onSaved: () => void }> = ({ complaint: c, onSaved }) => {
  const [status, setStatus] = useState<string>(c.status);
  const [notes, setNotes] = useState<string>(c.operator_notes ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = status !== c.status || notes !== (c.operator_notes ?? '');

  const save = async () => {
    setSaving(true);
    try {
      const closing = CLOSED.includes(status) && !CLOSED.includes(c.status);
      const reopening = !CLOSED.includes(status) && CLOSED.includes(c.status);
      await write(
        supabase
          .from('complaints')
          .update({
            status,
            operator_notes: notes || null,
            ...(closing ? { resolved_at: new Date().toISOString() } : {}),
            ...(reopening ? { resolved_at: null } : {}),
          })
          .eq('id', c.id)
      );
      onSaved();
    } catch (err) {
      alert(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-rose-500" />
          <span className="font-bold text-gray-900">{c.complaint_type}</span>
          <span className="text-sm text-gray-500">
            for {c.request?.request_number ?? '-'} · {timeAgo(c.created_at)}
          </span>
        </div>
        <Badge value={c.status} />
      </div>

      <div className="text-sm text-gray-700 bg-gray-50 p-3.5 rounded-lg border border-gray-100">{c.description}</div>

      <p className="text-xs text-gray-500">
        Reported by <Party p={c.reporter} /> against <Party p={c.against} />
      </p>

      <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-gray-100">
        <label className="text-xs text-gray-500">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="block mt-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs">
            {STATUS_OPTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex-1 min-w-[240px] text-xs text-gray-500">
          Operator notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="block w-full mt-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
            placeholder="What was done, who was contacted, outcome..."
          />
        </label>
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
};
