import React from 'react';
import { Search, Users, Clock, AlertOctagon, MapPin, XCircle, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ACTIVE_ASSIGNMENT_STATUSES, AWAITING_CONFIRMATION_STATUSES, must, timeAgo, useLoader } from '../lib/data';
import { Badge, Empty, ErrorBox, Loading, PageHeader, Table } from '../components/ui';

async function countRequests(statuses: string[]): Promise<number> {
  const { count, error } = await supabase
    .from('service_requests')
    .select('id', { count: 'exact', head: true })
    .in('status', statuses);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function loadOverview() {
  const now = new Date().toISOString();
  const [searching, active, awaiting, disputed, noMatch, users, online, searches] = await Promise.all([
    countRequests(['SEARCHING']),
    countRequests(ACTIVE_ASSIGNMENT_STATUSES),
    countRequests(AWAITING_CONFIRMATION_STATUSES),
    countRequests(['DISPUTED']),
    countRequests(['NO_TECHNICIAN_FOUND']),
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase
      .from('technician_availability')
      .select('technician_id')
      .eq('availability_status', 'ONLINE')
      .gt('location_expires_at', now),
    supabase
      .from('service_requests')
      .select(
        'id, request_number, current_offer_batch, search_started_at, created_at, service_address_text, ' +
          'category:service_categories(name), issue:issue_types(name), offers:request_offers(offer_status, expires_at)'
      )
      .eq('status', 'SEARCHING')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  if (users.error) throw new Error(users.error.message);
  const onlineRows = must(online) as { technician_id: string }[];

  return {
    metrics: { searching, active, awaiting, disputed, noMatch },
    totalUsers: users.count ?? 0,
    onlineTechnicians: new Set(onlineRows.map((r) => r.technician_id)).size,
    searches: must(searches) as any[],
  };
}

export const Overview: React.FC = () => {
  const { data, error, loading, reload } = useLoader(loadOverview);

  const cards = data
    ? [
        { label: 'Searching for Technicians', value: data.metrics.searching, icon: Search, color: 'text-amber-600 bg-amber-50' },
        { label: 'Active Assignments', value: data.metrics.active, icon: Users, color: 'text-sky-600 bg-sky-50' },
        { label: 'Awaiting Confirmation', value: data.metrics.awaiting, icon: Clock, color: 'text-indigo-600 bg-indigo-50' },
        { label: 'Disputed Requests', value: data.metrics.disputed, icon: AlertOctagon, color: 'text-rose-600 bg-rose-50' },
        { label: 'Online Technicians', value: data.onlineTechnicians, icon: MapPin, color: 'text-emerald-600 bg-emerald-50' },
        { label: 'No Technician Found', value: data.metrics.noMatch, icon: XCircle, color: 'text-teal-600 bg-teal-50' },
        { label: 'Registered Users', value: data.totalUsers, icon: UserPlus, color: 'text-slate-600 bg-slate-100' },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Marketplace Overview" subtitle="Live matching status and operations summary" onRefresh={reload} loading={loading} />

      {error ? (
        <ErrorBox message={error} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {cards.map((m) => {
              const Icon = m.icon;
              return (
                <div key={m.label} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">{m.label}</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{m.value}</p>
                  </div>
                  <div className={`p-3 rounded-lg ${m.color}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-gray-900">Active Matching Searches</h3>
            {data.searches.length === 0 ? (
              <Empty message="No requests are searching for a technician right now." />
            ) : (
              <Table headers={['Request #', 'Service', 'Location', 'Batch', 'Offers', 'Started', 'Status']}>
                {data.searches.map((r) => {
                  const offers = (r.offers ?? []) as { offer_status: string; expires_at: string }[];
                  const pending = offers.filter((o) => o.offer_status === 'SENT' || o.offer_status === 'VIEWED');
                  const declined = offers.filter((o) => o.offer_status === 'DECLINED' || o.offer_status === 'EXPIRED').length;
                  return (
                    <tr key={r.id}>
                      <td className="py-3 px-4 font-mono font-medium text-gray-900">{r.request_number}</td>
                      <td className="py-3 px-4">
                        {r.category?.name ?? '-'} <span className="text-xs text-gray-400">({r.issue?.name ?? '-'})</span>
                      </td>
                      <td className="py-3 px-4 text-xs">{r.service_address_text ?? '-'}</td>
                      <td className="py-3 px-4">Batch {r.current_offer_batch}</td>
                      <td className="py-3 px-4 text-xs">
                        {pending.length} pending · {declined} declined/expired
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-400">{timeAgo(r.search_started_at ?? r.created_at)}</td>
                      <td className="py-3 px-4">
                        <Badge value="SEARCHING" />
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </div>
        </>
      )}
    </div>
  );
};
