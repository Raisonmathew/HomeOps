import React, { useState } from 'react';
import { AlertCircle, MessageSquare } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { must, timeAgo, useLoader, write } from '../lib/data';
import { Badge, Empty, ErrorBox, FilterTabs, Loading, PageHeader } from '../components/ui';

const OPEN_STATUSES = ['OPEN', 'CUSTOMER_CONTACTED', 'TECHNICIAN_CONTACTED', 'UNDER_REVIEW'];

/** URGENT = urgent reports that are still open; OPEN / CLOSED / ALL are by status only. */
const FILTERS: Record<string, { statuses: string[] | null; urgentOnly?: boolean }> = {
  URGENT: { statuses: OPEN_STATUSES, urgentOnly: true },
  OPEN: { statuses: OPEN_STATUSES },
  CLOSED: { statuses: ['RESOLVED', 'ACCOUNT_ACTION_TAKEN'] },
  ALL: { statuses: null },
};

const EVIDENCE_PHOTO_TYPES = ['ISSUE_PHOTO', 'AFTER_PHOTO'];

const STATUS_OPTIONS = ['OPEN', 'CUSTOMER_CONTACTED', 'TECHNICIAN_CONTACTED', 'UNDER_REVIEW', 'RESOLVED', 'ACCOUNT_ACTION_TAKEN'];
const CLOSED = ['RESOLVED', 'ACCOUNT_ACTION_TAKEN'];

const COMPLAINT_SELECT =
  'id, service_request_id, complaint_type, category, priority, description, status, operator_notes, created_at, resolved_at, ' +
  'request:service_requests(request_number), ' +
  'reporter:profiles!complaints_reported_by_fkey(full_name, role, telegram_username), ' +
  'against:profiles!complaints_reported_against_fkey(full_name, role, telegram_username)';

export const Complaints: React.FC = () => {
  const [filter, setFilter] = useState('OPEN');

  const { data, error, loading, reload } = useLoader(async () => {
    let q = supabase.from('complaints').select(COMPLAINT_SELECT).order('created_at', { ascending: false });
    const { statuses, urgentOnly } = FILTERS[filter];
    if (statuses) q = q.in('status', statuses);
    if (urgentOnly) q = q.eq('priority', 'URGENT');
    const complaints = must(await q) as any[];

    // Evidence photos for all listed requests in one query (Telegram file ids only, nothing in Storage).
    const requestIds = [...new Set(complaints.map((c) => c.service_request_id).filter(Boolean))];
    const photos = requestIds.length
      ? (must(
          await supabase
            .from('attachments')
            .select('service_request_id, attachment_type')
            .in('service_request_id', requestIds)
            .in('attachment_type', EVIDENCE_PHOTO_TYPES)
        ) as { service_request_id: string; attachment_type: string }[])
      : [];
    const photosByRequest: Record<string, string[]> = {};
    for (const a of photos) (photosByRequest[a.service_request_id] ??= []).push(a.attachment_type);

    // URGENT first, then newest (the query already orders by created_at desc and the sort is stable).
    complaints.sort((a, b) => Number(b.priority === 'URGENT') - Number(a.priority === 'URGENT'));
    return complaints.map((c) => ({ ...c, photoTypes: photosByRequest[c.service_request_id] ?? [] }));
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
    // reported_by is NULL for flags raised automatically by the Worker (complaint_type "AUTO: ...")
    <strong className="text-indigo-700">HomeOps (automatic)</strong>
  );

const ComplaintCard: React.FC<{ complaint: any; onSaved: () => void }> = ({ complaint: c, onSaved }) => {
  const [status, setStatus] = useState<string>(c.status);
  const [showTranscript, setShowTranscript] = useState(false);
  const urgent = c.priority === 'URGENT';
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
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4 ${urgent ? 'border-l-4 border-l-rose-600' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <AlertCircle className={`w-5 h-5 ${urgent ? 'text-rose-600' : 'text-rose-500'}`} />
          {urgent && <Badge value="URGENT" />}
          <Badge value={c.category} />
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span>
          📷 Evidence photos: <PhotoSummary types={c.photoTypes} />
        </span>
        <button onClick={() => setShowTranscript((v) => !v)} className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline">
          <MessageSquare className="w-3.5 h-3.5" />
          {showTranscript ? 'Hide chat transcript' : 'Show chat transcript'}
        </button>
      </div>
      {showTranscript && <Transcript requestId={c.service_request_id} />}

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

const PHOTO_LABELS: Record<string, string> = { ISSUE_PHOTO: 'issue', AFTER_PHOTO: 'after-work' };

/** Photos live only in Telegram (telegram_file_id, no Storage copy), so the dashboard can only count them. */
const PhotoSummary: React.FC<{ types: string[] }> = ({ types }) => {
  if (!types.length) return <span className="text-gray-400">none</span>;
  const counts = EVIDENCE_PHOTO_TYPES.map((t) => [t, types.filter((x) => x === t).length] as const).filter(([, n]) => n > 0);
  return (
    <span className="text-gray-700">
      {types.length} ({counts.map(([t, n]) => `${n} ${PHOTO_LABELS[t]}`).join(', ')})
      <span className="text-gray-400"> · stored in Telegram only, not viewable here</span>
    </span>
  );
};

interface RelayMessage {
  id: string;
  body: string;
  delivered: boolean;
  created_at: string;
  sender: { full_name: string; role: string } | null;
  recipient: { full_name: string; role: string } | null;
}

/** Customer <-> technician messages relayed by the bot for this request, oldest first. Mounted on demand. */
const Transcript: React.FC<{ requestId: string }> = ({ requestId }) => {
  const { data, error, loading } = useLoader(async () => {
    const res = await supabase
      .from('relay_messages')
      .select(
        'id, body, delivered, created_at, ' +
          'sender:profiles!relay_messages_sender_profile_id_fkey(full_name, role), ' +
          'recipient:profiles!relay_messages_recipient_profile_id_fkey(full_name, role)'
      )
      .eq('service_request_id', requestId)
      .order('created_at', { ascending: true });
    return must(res) as unknown as RelayMessage[];
  }, [requestId]);

  const name = (p: RelayMessage['sender']) => (p ? `${p.full_name} (${p.role?.toLowerCase()})` : 'Unknown');

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-amber-700">
        This transcript is evidence for the report. It is deleted automatically after the retention period (RETENTION.RELAY_DAYS),
        unless a report on this request is still open.
      </p>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2 text-xs">
        {error ? (
          <p className="text-rose-700 font-mono">{error}</p>
        ) : loading && !data ? (
          <p className="text-gray-400">Loading...</p>
        ) : !data?.length ? (
          <p className="text-gray-400">No messages</p>
        ) : (
          data.map((m) => (
            <div key={m.id} className="bg-white rounded-md border border-gray-100 px-2.5 py-1.5">
              <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500">
                <span className="font-semibold text-gray-800">{name(m.sender)}</span>
                <span>→</span>
                <span className="font-semibold text-gray-800">{name(m.recipient)}</span>
                <span title={m.created_at}>{new Date(m.created_at).toLocaleString()}</span>
                {!m.delivered && <span className="font-semibold text-rose-600">not delivered</span>}
              </div>
              <p className="mt-0.5 text-gray-800 whitespace-pre-wrap break-words">{m.body}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
