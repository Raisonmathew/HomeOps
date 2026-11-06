import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { csvName, downloadCsv, must, operatorAccountAction, timeAgo, useLoader, type AccountAction } from '../lib/data';
import { Badge, Empty, ErrorBox, ExportButton, FilterTabs, Loading, PageHeader, Table } from '../components/ui';

interface ProfileRow {
  id: string;
  telegram_user_id: number;
  telegram_username: string | null;
  full_name: string;
  role: string;
  phone_number: string | null;
  account_status: string;
  warning_count: number | null;
  created_at: string;
  /** Scores of ratings where reviewed_profile_id = this profile (embedded in the same query). */
  ratings_received: { score: number }[] | null;
}

const ratingSummary = (p: ProfileRow) => {
  const scores = (p.ratings_received ?? []).map((r) => r.score);
  return { count: scores.length, avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null };
};

const ROLE_FILTERS = ['ALL', 'CUSTOMER', 'TECHNICIAN', 'OPERATOR'];

const ACTION_META: Record<AccountAction, { label: string; effect: string; className: string }> = {
  WARN: { label: 'Warn', effect: 'sends a formal warning and adds 1 to their warning count.', className: 'text-amber-700' },
  RESTRICT: { label: 'Restrict', effect: 'limits what they can do until reactivated.', className: 'text-orange-700' },
  SUSPEND: {
    label: 'Suspend',
    effect: 'blocks them from using the bot. A suspended technician is released from active jobs and those customers are re-matched.',
    className: 'text-rose-600',
  },
  REACTIVATE: { label: 'Reactivate', effect: 'restores normal access.', className: 'text-emerald-700' },
};

/** Moderation actions that make sense for an account status (DELETED accounts get none). */
const actionsFor = (status: string): AccountAction[] =>
  status === 'ACTIVE'
    ? ['WARN', 'RESTRICT', 'SUSPEND']
    : status === 'RESTRICTED'
      ? ['WARN', 'SUSPEND', 'REACTIVATE']
      : status === 'SUSPENDED'
        ? ['REACTIVATE']
        : [];

export const Users: React.FC = () => {
  const [role, setRole] = useState('ALL');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, reload } = useLoader(async () => {
    let q = supabase
      .from('profiles')
      .select(
        'id, telegram_user_id, telegram_username, full_name, role, phone_number, account_status, warning_count, created_at, ' +
          'ratings_received:ratings!ratings_reviewed_profile_id_fkey(score)'
      )
      .order('created_at', { ascending: false })
      .limit(500);
    if (role !== 'ALL') q = q.eq('role', role);
    return must(await q) as unknown as ProfileRow[];
  }, [role]);

  const moderate = async (p: ProfileRow, action: AccountAction) => {
    const meta = ACTION_META[action];
    const reason = prompt(`${meta.label} ${p.full_name}: ${meta.effect}\n\nReason (required, it is sent to the user):`);
    if (reason === null) return; // cancelled
    if (!reason.trim()) {
      alert('A reason is required. Nothing was changed.');
      return;
    }
    setBusy(p.id);
    try {
      await operatorAccountAction(p.id, action, reason.trim());
      await reload();
    } catch (err) {
      alert(`${meta.label} failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const term = search.trim().toLowerCase();
  const rows = (data ?? []).filter(
    (p) =>
      !term ||
      p.full_name.toLowerCase().includes(term) ||
      (p.telegram_username ?? '').toLowerCase().includes(term) ||
      String(p.telegram_user_id).includes(term) ||
      (p.phone_number ?? '').includes(term)
  );

  const exportCsv = () =>
    downloadCsv(
      csvName(`users-${role.toLowerCase()}`),
      rows.map((p) => {
        const { avg, count } = ratingSummary(p);
        return {
          name: p.full_name,
          telegram_username: p.telegram_username,
          telegram_user_id: p.telegram_user_id,
          role: p.role,
          phone: p.phone_number,
          account_status: p.account_status,
          warning_count: p.warning_count ?? 0,
          joined: p.created_at,
          rating_received_avg: avg === null ? null : avg.toFixed(2),
          rating_received_count: count,
        };
      })
    );

  return (
    <div className="space-y-6">
      <PageHeader title="Users" subtitle="Everyone who has messaged the bot, plus staff profiles" onRefresh={reload} loading={loading}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, @username, ID, phone"
          className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg w-56"
        />
        <FilterTabs options={ROLE_FILTERS} value={role} onChange={setRole} />
        <ExportButton onClick={exportCsv} disabled={!rows.length} />
      </PageHeader>

      {error ? (
        <ErrorBox message={error} />
      ) : loading && !data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty message="No users yet. Send /start to the bot; a profile is created on the first message." />
      ) : (
        <Table headers={['Name', 'Telegram', 'Role', 'Phone', 'Rating received', 'Status', 'Joined', '']}>
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-gray-50">
              <td className="py-3 px-4 font-medium text-gray-900">{p.full_name}</td>
              <td className="py-3 px-4">
                {p.telegram_username ? (
                  <a href={`https://t.me/${p.telegram_username}`} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">
                    @{p.telegram_username}
                  </a>
                ) : (
                  <span className="text-gray-400">-</span>
                )}
                <span className="block text-xs text-gray-400 font-mono">{p.telegram_user_id}</span>
              </td>
              <td className="py-3 px-4">{p.role}</td>
              <td className="py-3 px-4">{p.phone_number ?? '-'}</td>
              <td className="py-3 px-4 whitespace-nowrap">
                <RatingCell p={p} />
              </td>
              <td className="py-3 px-4 whitespace-nowrap">
                <Badge value={p.account_status} />
                {(p.warning_count ?? 0) > 0 && (
                  <span className="ml-1.5 text-xs font-semibold text-amber-700" title={`${p.warning_count} formal warning(s)`}>
                    ⚠️ {p.warning_count}
                  </span>
                )}
              </td>
              <td className="py-3 px-4 text-xs text-gray-400">{timeAgo(p.created_at)}</td>
              <td className="py-3 px-4 text-right whitespace-nowrap">
                {p.role !== 'OPERATOR' && (
                  <span className="inline-flex gap-3">
                    {actionsFor(p.account_status).map((a) => (
                      <button
                        key={a}
                        disabled={busy === p.id}
                        onClick={() => moderate(p, a)}
                        className={`text-xs font-medium hover:underline disabled:opacity-50 ${ACTION_META[a].className}`}
                      >
                        {ACTION_META[a].label}
                      </button>
                    ))}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
};

const RatingCell: React.FC<{ p: ProfileRow }> = ({ p }) => {
  const { avg, count } = ratingSummary(p);
  if (avg === null) return <span className="text-gray-400">-</span>;
  return (
    <span className={avg <= 2 ? 'font-semibold text-rose-700' : 'text-gray-900'}>
      ⭐ {avg.toFixed(1)} <span className="text-xs font-normal text-gray-400">({count})</span>
    </span>
  );
};
