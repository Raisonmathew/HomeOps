import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { csvName, downloadCsv, must, timeAgo, useLoader } from '../lib/data';
import { Empty, ErrorBox, ExportButton, FilterTabs, Loading, PageHeader, Stars, Table, Tags } from '../components/ui';

const FILTERS = ['All', 'About technicians', 'About customers', 'Low (≤ 2 stars)'];

// !inner on `reviewed` lets the role filters below restrict the ratings rows themselves.
const RATING_SELECT =
  'id, score, comment, tags, created_at, reviewer_id, reviewed_profile_id, ' +
  'request:service_requests(request_number, customer_id), ' +
  'reviewer:profiles!ratings_reviewer_id_fkey(full_name, role, telegram_username), ' +
  'reviewed:profiles!ratings_reviewed_profile_id_fkey!inner(full_name, role, telegram_username)';

/** Role the person played on this job (a technician can also book jobs as a customer). */
const jobRole = (profileId: string, r: any) => (r.request?.customer_id === profileId ? 'Customer' : 'Technician');

export const Reviews: React.FC = () => {
  const [filter, setFilter] = useState(FILTERS[0]);

  const { data, error, loading, reload } = useLoader(async () => {
    let q = supabase.from('ratings').select(RATING_SELECT).order('created_at', { ascending: false }).limit(200);
    if (filter === 'About technicians') q = q.eq('reviewed.role', 'TECHNICIAN');
    if (filter === 'About customers') q = q.eq('reviewed.role', 'CUSTOMER');
    if (filter === 'Low (≤ 2 stars)') q = q.lte('score', 2);
    return must(await q) as any[];
  }, [filter]);

  const exportCsv = () =>
    downloadCsv(
      csvName('reviews'),
      (data ?? []).map((r) => ({
        request_number: r.request?.request_number,
        reviewer: r.reviewer?.full_name,
        reviewer_role: jobRole(r.reviewer_id, r),
        reviewed: r.reviewed?.full_name,
        reviewed_role: jobRole(r.reviewed_profile_id, r),
        score: r.score,
        tags: r.tags,
        comment: r.comment,
        created_at: r.created_at,
      }))
    );

  return (
    <div className="space-y-6">
      <PageHeader title="Reviews" subtitle="Two-way ratings: customers rate technicians and technicians rate customers" onRefresh={reload} loading={loading}>
        <FilterTabs options={FILTERS} value={filter} onChange={setFilter} />
        <ExportButton onClick={exportCsv} disabled={!data?.length} />
      </PageHeader>

      {error ? (
        <ErrorBox message={error} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.length ? (
        <Empty message="No reviews match this filter." />
      ) : (
        <Table headers={['Request #', 'Reviewer → Reviewed', 'Score', 'Tags', 'Comment', 'Time']}>
          {data.map((r) => (
            <tr key={r.id} className={`hover:bg-gray-50 ${r.score <= 2 ? 'bg-rose-50/40' : ''}`}>
              <td className="py-3 px-4 font-mono font-medium text-gray-900">{r.request?.request_number ?? '-'}</td>
              <td className="py-3 px-4">
                <Person name={r.reviewer?.full_name} role={jobRole(r.reviewer_id, r)} />
                <span className="mx-1.5 text-gray-400">→</span>
                <Person name={r.reviewed?.full_name} role={jobRole(r.reviewed_profile_id, r)} />
              </td>
              <td className="py-3 px-4">
                <Stars score={r.score} />
              </td>
              <td className="py-3 px-4">
                <Tags tags={r.tags} />
              </td>
              <td className="py-3 px-4 text-xs max-w-sm">{r.comment ? <span className="italic">"{r.comment}"</span> : <span className="text-gray-400">-</span>}</td>
              <td className="py-3 px-4 text-xs text-gray-400 whitespace-nowrap">{timeAgo(r.created_at)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
};

const Person: React.FC<{ name: string | undefined; role: string }> = ({ name, role }) => (
  <span className="whitespace-nowrap">
    <span className="font-medium text-gray-900">{name ?? '-'}</span> <span className="text-xs text-gray-400">({role})</span>
  </span>
);
