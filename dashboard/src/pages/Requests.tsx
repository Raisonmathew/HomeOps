import React, { Fragment, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  ASSIGNABLE_STATUSES,
  AWAITING_CONFIRMATION_STATUSES,
  CLOSED_STATUSES,
  TERMINAL_STATUSES,
  csvName,
  downloadCsv,
  must,
  operatorAssign,
  operatorCancel,
  operatorResolve,
  timeAgo,
  useLoader,
} from '../lib/data';
import { Badge, Empty, ErrorBox, ExportButton, FilterTabs, Loading, PageHeader, Stars, Table, Tags } from '../components/ui';

const FILTERS: Record<string, string[] | null> = {
  ALL: null,
  SEARCHING: ['REQUESTED', 'SEARCHING'],
  ACTIVE: ACTIVE_ASSIGNMENT_STATUSES,
  'AWAITING CONFIRMATION': AWAITING_CONFIRMATION_STATUSES,
  DISPUTED: ['DISPUTED'],
  CLOSED: CLOSED_STATUSES,
};

const REQUEST_SELECT =
  'id, request_number, status, urgency, created_at, service_locality, service_address_text, description, current_offer_batch, ' +
  'payment_declaration, customer_id, assigned_technician_id, service_category_id, ' +
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

  const exportCsv = () =>
    downloadCsv(
      csvName(`requests-${filter.toLowerCase().replace(/\s+/g, '-')}`),
      (data ?? []).map((r) => ({
        request_number: r.request_number,
        status: r.status,
        urgency: r.urgency,
        created_at: r.created_at,
        customer: r.customer?.full_name,
        customer_telegram: r.customer?.telegram_username,
        category: r.category?.name,
        issue: r.issue?.name,
        locality: r.service_locality,
        address: r.service_address_text,
        technician: r.technician?.profile?.full_name,
        technician_rating: r.technician?.average_rating,
        current_offer_batch: r.current_offer_batch,
        payment_declaration: r.payment_declaration,
        description: r.description,
      }))
    );

  return (
    <div className="space-y-6">
      <PageHeader title="Request Management" subtitle="Track request lifecycles, offers, and assignees" onRefresh={reload} loading={loading}>
        <FilterTabs options={Object.keys(FILTERS)} value={filter} onChange={setFilter} />
        <ExportButton onClick={exportCsv} disabled={!data?.length} />
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
                <td className="py-3 px-4 text-xs">
                  {r.service_locality && <span className="block font-medium text-gray-700">{r.service_locality}</span>}
                  {r.service_address_text ?? (r.service_locality ? null : '-')}
                </td>
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
                    <RequestAudit request={r} onChanged={reload} />
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

const money = (v: unknown) => (v === null || v === undefined ? '-' : Number(v).toFixed(2));

const RequestAudit: React.FC<{ request: any; onChanged: () => Promise<void> }> = ({ request, onChanged }) => {
  const requestId: string = request.id;
  const { data, error, loading, reload } = useLoader(async () => {
    const [events, offers, ratings, estimates] = await Promise.all([
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
      supabase
        .from('ratings')
        .select(
          'id, reviewer_id, reviewed_profile_id, score, comment, tags, created_at, ' +
            'reviewer:profiles!ratings_reviewer_id_fkey(full_name), reviewed:profiles!ratings_reviewed_profile_id_fkey(full_name)'
        )
        .eq('service_request_id', requestId),
      supabase
        .from('estimate_records')
        .select('id, visit_charge, labour_amount, parts_amount, estimated_total, warranty_text, customer_acknowledgement_status, created_at')
        .eq('service_request_id', requestId)
        .order('created_at', { ascending: false })
        .limit(1),
    ]);
    return {
      events: must(events) as any[],
      offers: must(offers) as any[],
      ratings: must(ratings) as any[],
      estimate: ((must(estimates) as any[]) ?? [])[0] ?? null,
    };
  }, [requestId]);

  const afterAction = async () => {
    await Promise.all([onChanged(), reload()]);
  };

  if (error) return <ErrorBox message={error} />;
  if (loading || !data) return <Loading />;

  const byCustomer = data.ratings.find((x) => x.reviewer_id === request.customer_id);
  const aboutCustomer = data.ratings.find((x) => x.reviewed_profile_id === request.customer_id);

  return (
    <div className="space-y-6 text-xs">
      <OperatorActions request={request} onDone={afterAction} />

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <p className="font-semibold text-gray-700 mb-2">Description</p>
          <p className="text-gray-600 mb-4">{request.description}</p>
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
        <div className="space-y-6">
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

          <div>
            <p className="font-semibold text-gray-700 mb-2">Estimate &amp; payment</p>
            <p className="mb-2 flex items-center gap-2 text-gray-600">
              Payment declaration: <Badge value={request.payment_declaration} />
            </p>
            {!data.estimate ? (
              <p className="text-gray-400">No estimate recorded.</p>
            ) : (
              <div className="space-y-1.5 text-gray-600">
                <p>
                  Visit {money(data.estimate.visit_charge)} · Labour {money(data.estimate.labour_amount)} · Parts {money(data.estimate.parts_amount)} ·{' '}
                  <span className="font-semibold text-gray-900">Total {money(data.estimate.estimated_total)}</span>
                </p>
                {data.estimate.warranty_text && <p className="text-gray-500">Warranty: {data.estimate.warranty_text}</p>}
                <p className="flex items-center gap-2">
                  Customer: <Badge value={data.estimate.customer_acknowledgement_status} />
                  <span className="text-gray-400">recorded {timeAgo(data.estimate.created_at)}</span>
                </p>
              </div>
            )}
          </div>

          <div>
            <p className="font-semibold text-gray-700 mb-2">Reviews</p>
            <div className="space-y-2">
              <ReviewLine label="Customer → Technician" rating={byCustomer} />
              <ReviewLine label="Technician → Customer" rating={aboutCustomer} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ReviewLine: React.FC<{ label: string; rating: any }> = ({ label, rating }) => (
  <div className="px-3 py-2 bg-white rounded-lg border border-gray-100">
    <p className="text-gray-500 mb-1">{label}</p>
    {!rating ? (
      <p className="text-gray-400">Not reviewed yet.</p>
    ) : (
      <div className="space-y-1 text-gray-600">
        <p className="flex flex-wrap items-center gap-2">
          <Stars score={rating.score} />
          <span className="text-gray-400">
            {rating.reviewer?.full_name ?? '-'} → {rating.reviewed?.full_name ?? '-'} · {timeAgo(rating.created_at)}
          </span>
        </p>
        <Tags tags={rating.tags} />
        {rating.comment && <p className="italic">"{rating.comment}"</p>}
      </div>
    )}
  </div>
);

/** Assign / reassign and cancel, both executed by the Worker so it can notify everyone on Telegram. */
const OperatorActions: React.FC<{ request: any; onDone: () => Promise<void> }> = ({ request, onDone }) => {
  const canAssign = ASSIGNABLE_STATUSES.includes(request.status);
  const canCancel = !TERMINAL_STATUSES.includes(request.status);
  const [techId, setTechId] = useState('');
  const [busy, setBusy] = useState(false);

  const techs = useLoader(async () => {
    if (!canAssign) return [];
    const rows = must(
      await supabase
        .from('technician_profiles')
        .select(
          'id, profile:profiles!technician_profiles_profile_id_fkey(full_name, account_status), ' +
            'skills:technician_skills(approval_status, service_category_id, category:service_categories(name))'
        )
        .eq('verification_status', 'APPROVED')
    ) as any[];
    return rows
      .filter((t) => t.profile?.account_status === 'ACTIVE')
      .map((t) => {
        const approved = (t.skills ?? []).filter((s: any) => s.approval_status === 'APPROVED');
        return {
          id: t.id as string,
          name: (t.profile?.full_name ?? 'Unknown') as string,
          categories: [...new Set(approved.map((s: any) => s.category?.name).filter(Boolean))] as string[],
          fits: approved.some((s: any) => s.service_category_id === request.service_category_id),
        };
      })
      .sort((a, b) => Number(b.fits) - Number(a.fits) || a.name.localeCompare(b.name));
  }, [canAssign, request.service_category_id]);

  // Disputed / never-confirmed jobs: operator closes them after checking with both parties
  const canResolve = ['DISPUTED', 'CUSTOMER_CONFIRMATION_PENDING'].includes(request.status);

  if (!canAssign && !canCancel && !canResolve) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setTechId('');
      await onDone();
    } catch (err) {
      alert(`Action failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const assign = () => {
    const tech = techs.data?.find((t) => t.id === techId);
    if (!tech) return;
    const verb = request.assigned_technician_id ? 'Reassign' : 'Assign';
    if (!confirm(`${verb} ${request.request_number} to ${tech.name}? Both parties will be notified on Telegram.`)) return;
    run(() => operatorAssign(request.id, tech.id));
  };

  const cancel = () => {
    const reason = prompt(`Cancel ${request.request_number}? Enter a reason (sent to the customer and technician):`);
    if (reason === null) return;
    if (!reason.trim()) {
      alert('A reason is required to cancel a request.');
      return;
    }
    run(() => operatorCancel(request.id, reason.trim()));
  };

  const resolve = (outcome: 'COMPLETED' | 'PARTIALLY_COMPLETED') => {
    const label = outcome === 'COMPLETED' ? 'completed' : 'partly completed';
    if (!confirm(`Close ${request.request_number} as ${label}? Held ratings will start counting and both parties are notified.`)) return;
    run(() => operatorResolve(request.id, outcome));
  };

  return (
    <div className="flex flex-wrap items-end gap-6 px-4 py-3 bg-white rounded-lg border border-gray-200">
      {canResolve && (
        <div>
          <p className="font-semibold text-gray-700 mb-1.5">Resolve (after checking with both parties)</p>
          <div className="flex gap-2">
            <button
              onClick={() => resolve('COMPLETED')}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
            >
              Close as completed
            </button>
            <button
              onClick={() => resolve('PARTIALLY_COMPLETED')}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 disabled:opacity-50"
            >
              Close as partly completed
            </button>
          </div>
        </div>
      )}
      {canAssign && (
        <div>
          <p className="font-semibold text-gray-700 mb-1.5">Assign / reassign technician</p>
          {techs.error ? (
            <p className="text-rose-700">Could not load technicians: {techs.error}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={techId}
                onChange={(e) => setTechId(e.target.value)}
                disabled={busy || techs.loading}
                className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white max-w-md"
              >
                <option value="">{techs.loading ? 'Loading technicians...' : `Choose technician (${techs.data?.length ?? 0} approved & active)`}</option>
                {(techs.data ?? []).map((t) => (
                  <option key={t.id} value={t.id} disabled={t.id === request.assigned_technician_id}>
                    {t.name} - {t.categories.join(', ') || 'no approved categories'}
                    {t.id === request.assigned_technician_id ? ' (current)' : ''}
                  </option>
                ))}
              </select>
              <button
                onClick={assign}
                disabled={busy || !techId}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50"
              >
                {busy ? 'Working...' : 'Assign'}
              </button>
            </div>
          )}
        </div>
      )}
      {canCancel && (
        <button
          onClick={cancel}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 disabled:opacity-50"
        >
          Cancel request
        </button>
      )}
    </div>
  );
};
