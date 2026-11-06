import React from 'react';
import { supabase } from '../lib/supabase';
import { ACTIVE_ASSIGNMENT_STATUSES, must, pct, timeAgo, useLoader } from '../lib/data';
import { Badge, Empty, ErrorBox, Loading, PageHeader, Table } from '../components/ui';

async function loadMonitoring() {
  const techs = must(
    await supabase
      .from('technician_profiles')
      .select(
        'id, average_rating, completed_request_count, acceptance_rate, completion_rate, post_acceptance_cancellation_rate, complaint_rate, ' +
          'profile:profiles!technician_profiles_profile_id_fkey(full_name), ' +
          'skills:technician_skills(approval_status, category:service_categories(name))'
      )
      .eq('verification_status', 'APPROVED')
  ) as any[];

  if (techs.length === 0) return [];
  const ids = techs.map((t) => t.id);

  const [availability, jobs] = await Promise.all([
    supabase
      .from('technician_availability')
      .select('technician_id, availability_status, location_updated_at, location_expires_at, created_at')
      .in('technician_id', ids)
      .order('created_at', { ascending: false }),
    supabase.from('service_requests').select('assigned_technician_id').in('assigned_technician_id', ids).in('status', ACTIVE_ASSIGNMENT_STATUSES),
  ]);

  // Availability is an append-only history; the first row per technician is the latest.
  const latest = new Map<string, any>();
  for (const a of must(availability) as any[]) if (!latest.has(a.technician_id)) latest.set(a.technician_id, a);

  const activeJobs = new Map<string, number>();
  for (const j of must(jobs) as any[]) activeJobs.set(j.assigned_technician_id, (activeJobs.get(j.assigned_technician_id) ?? 0) + 1);

  const now = Date.now();
  return techs
    .map((t) => {
      const a = latest.get(t.id);
      let status = 'OFFLINE';
      if (a) {
        status = a.availability_status;
        if (status === 'ONLINE' && new Date(a.location_expires_at).getTime() < now) status = 'EXPIRED';
      }
      const categories = [
        ...new Set((t.skills ?? []).filter((s: any) => s.approval_status === 'APPROVED').map((s: any) => s.category?.name)),
      ].filter(Boolean);
      return { ...t, status, locationUpdatedAt: a?.location_updated_at, activeJobs: activeJobs.get(t.id) ?? 0, categories };
    })
    .sort((x, y) => Number(y.status === 'ONLINE') - Number(x.status === 'ONLINE'));
}

export const Monitoring: React.FC = () => {
  const { data, error, loading, reload } = useLoader(loadMonitoring);

  return (
    <div className="space-y-6">
      <PageHeader title="Technician Monitoring" subtitle="Live availability, location freshness, and reliability metrics" onRefresh={reload} loading={loading} />

      {error ? (
        <ErrorBox message={error} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.length ? (
        <Empty message="No approved technicians yet. Approve applicants on the Verification page." />
      ) : (
        <Table headers={['Technician', 'Categories', 'Status', 'Location Updated', 'Active Jobs', 'Completed', 'Acceptance', 'Completion', 'Cancel Rate', 'Rating']}>
          {data.map((t) => (
            <tr key={t.id} className="hover:bg-gray-50">
              <td className="py-3 px-4 font-semibold text-gray-900">{t.profile?.full_name ?? '-'}</td>
              <td className="py-3 px-4 text-xs">{t.categories.join(', ') || '-'}</td>
              <td className="py-3 px-4">
                <Badge value={t.status} />
              </td>
              <td className="py-3 px-4 text-xs text-gray-500">{timeAgo(t.locationUpdatedAt)}</td>
              <td className="py-3 px-4 font-medium">{t.activeJobs}</td>
              <td className="py-3 px-4">{t.completed_request_count}</td>
              <td className="py-3 px-4">{pct(t.acceptance_rate)}</td>
              <td className="py-3 px-4">{pct(t.completion_rate)}</td>
              <td className="py-3 px-4 text-rose-600 font-medium">{pct(t.post_acceptance_cancellation_rate)}</td>
              <td className="py-3 px-4 font-bold text-gray-900">
                {t.completed_request_count > 0 ? `⭐ ${Number(t.average_rating).toFixed(1)}` : <span className="font-normal text-gray-400">new</span>}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
};
