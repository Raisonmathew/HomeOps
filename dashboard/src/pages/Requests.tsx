import React, { Fragment, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  AWAITING_CONFIRMATION_STATUSES,
  CLOSED_STATUSES,
  must,
  timeAgo,
  useLoader,
} from '../lib/data';
import { Badge, Empty, ErrorBox, FilterTabs, Loading, PageHeader, Table } from '../components/ui';

const FILTERS: Record<string, string[] | null> = {
  ALL: null,
  SEARCHING: ['REQUESTED', 'SEARCHING'],
  ACTIVE: ACTIVE_ASSIGNMENT_STATUSES,
  'AWAITING CONFIRMATION': AWAITING_CONFIRMATION_STATUSES,
  DISPUTED: ['DISPUTED'],
  CLOSED: CLOSED_STATUSES,
};

const REQUEST_SELECT =
  'id, request_number, status, urgency, created_at, service_address_text, description, current_offer_batch, ' +
  'customer:profiles!service_requests_customer_id_fkey(full_name, telegram_username), ' +
  'category:service_categories(name), issue:issue_types(name), ' +
  'technician:technician_profiles!service_requests_assigned_technician_id_fkey(average_rating, profile:profiles!technician_profiles_profile_id_fkey(full_name))';

export const Requests: React.FC = () => {
  const [filter, setFilter] = useState('ALL');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, error, loading, reload } = useLoader(async () => {
    let q = supabase.from('service_requests').select(REQUEST_SELECT).order('created_at', { ascending: false }).limit(200);
    const statuses = FILTERS[filter];
    if (statuses) q = q.in('status', statuses);
    return must(await q) as any[];
  }, [filter]);

  return (
    <div className="space-y-6">
      <PageHeader title="Request Management" subtitle="Track request lifecycles, offers, and assignees" onRefresh={reload} loading={loading}>
        <FilterTabs options={Object.keys(FILTERS)} value={filter} onChange={setFilter} />
      </PageHeader>

      {error ? (
        <ErrorBox message={error} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.length ? (
        <Empty message="No service requests match this filter." />
      ) : (
        <Table headers={['Request #', 'Customer', 'Service', 'Location', 'Assigned Tech', 'Status', 'Created', '']}>
          {data.map((r) => (
            <Fragment key={r.id}>
              <tr className="hover:bg-gray-50">
                <td className="py-3 px-4 font-mono font-medium text-gray-900">
                  {r.request_number}
                  {r.urgency !== 'NORMAL' && <span className="block text-[10px] font-sans font-semibold text-rose-600">{r.urgency}</span>}
                </td>
                <td className="py-3 px-4 font-medium text-gray-900">
                  {r.customer?.full_name ?? '-'}
                  {r.customer?.telegram_username && <span className="block text-xs font-normal text-gray-400">@{r.customer.telegram_username}</span>}
                </td>
                <td className="py-3 px-4">
                  {r.category?.name ?? '-'} <span className="text-xs text-gray-400">({r.issue?.name ?? '-'})</span>
                </td>
                <td className="py-3 px-4 text-xs">{r.service_address_text ?? '-'}</td>
                <td className="py-3 px-4">
                  {r.technician ? `${r.technician.profile?.full_name ?? 'Technician'} (⭐ ${Number(r.technician.average_rating).toFixed(1)})` : '-'}
                </td>
                <td className="py-3 px-4">
                  <Badge value={r.status} />
                </td>
                <td className="py-3 px-4 text-xs text-gray-400">{timeAgo(r.created_at)}</td>
                <td className="py-3 px-4 text-right">
                  <button onClick={() => setOpenId(openId === r.id ? null : r.id)} className="text-sky-600 hover:text-sky-800 font-medium text-xs">
                    {openId === r.id ? 'Hide' : 'View Audit'}
                  </button>
                </td>
              </tr>
              {openId === r.id && (
                <tr>
                  <td colSpan={8} className="bg-gray-50 px-4 py-4">
                    <RequestAudit requestId={r.id} description={r.description} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </Table>
      )}
    </div>
  );
};

const RequestAudit: React.FC<{ requestId: string; description: string }> = ({ requestId, description }) => {
  const { data, error, loading } = useLoader(async () => {
    const [events, offers] = await Promise.all([
      supabase
        .from('request_events')
        .select('id, event_type, old_status, new_status, notes, created_at')
        .eq('service_request_id', requestId)
        .order('created_at', { ascending: true }),
      supabase
        .from('request_offers')
        .select(
          'id, offer_batch, offer_status, distance_km, match_score, offered_at, responded_at, ' +
            'technician:technician_profiles(profile:profiles!technician_profiles_profile_id_fkey(full_name))'
        )
        .eq('service_request_id', requestId)
        .order('offer_batch', { ascending: true }),
    ]);
    return { events: must(events) as any[], offers: must(offers) as any[] };
  }, [requestId]);

  if (error) return <ErrorBox message={error} />;
  if (loading || !data) return <Loading />;

  return (
    <div className="grid md:grid-cols-2 gap-6 text-xs">
      <div>
        <p className="font-semibold text-gray-700 mb-2">Description</p>
        <p className="text-gray-600 mb-4">{description}</p>
        <p className="font-semibold text-gray-700 mb-2">Status history</p>
        {data.events.length === 0 ? (
          <p className="text-gray-400">No events recorded.</p>
        ) : (
          <ol className="space-y-1.5">
            {data.events.map((e) => (
              <li key={e.id} className="text-gray-600">
                <span className="text-gray-400">{new Date(e.created_at).toLocaleString()}</span> · <span className="font-medium">{e.event_type}</span>
                {e.new_status && (
                  <>
                    {' '}
                    {e.old_status ?? '-'} → <span className="font-medium">{e.new_status}</span>
                  </>
                )}
                {e.notes && <span className="text-gray-400"> ({e.notes})</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div>
        <p className="font-semibold text-gray-700 mb-2">Offers sent</p>
        {data.offers.length === 0 ? (
          <p className="text-gray-400">No offers sent.</p>
        ) : (
          <table className="w-full">
            <tbody>
              {data.offers.map((o) => (
                <tr key={o.id} className="border-b border-gray-100">
                  <td className="py-1.5 pr-2">B{o.offer_batch}</td>
                  <td className="py-1.5 pr-2">{o.technician?.profile?.full_name ?? '-'}</td>
                  <td className="py-1.5 pr-2">{Number(o.distance_km).toFixed(1)} km</td>
                  <td className="py-1.5 pr-2">score {Number(o.match_score).toFixed(0)}</td>
                  <td className="py-1.5">
                    <Badge value={o.offer_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
