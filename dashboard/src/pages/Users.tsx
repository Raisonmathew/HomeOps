import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { must, timeAgo, useLoader, write } from '../lib/data';
import { Badge, Empty, ErrorBox, FilterTabs, Loading, PageHeader, Table } from '../components/ui';

interface ProfileRow {
  id: string;
  telegram_user_id: number;
  telegram_username: string | null;
  full_name: string;
  role: string;
  phone_number: string | null;
  account_status: string;
  created_at: string;
}

const ROLE_FILTERS = ['ALL', 'CUSTOMER', 'TECHNICIAN', 'OPERATOR'];

export const Users: React.FC = () => {
  const [role, setRole] = useState('ALL');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, reload } = useLoader(async () => {
    let q = supabase
      .from('profiles')
      .select('id, telegram_user_id, telegram_username, full_name, role, phone_number, account_status, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (role !== 'ALL') q = q.eq('role', role);
    return must(await q) as ProfileRow[];
  }, [role]);

  const setStatus = async (p: ProfileRow, status: 'ACTIVE' | 'SUSPENDED') => {
    if (status === 'SUSPENDED' && !confirm(`Suspend ${p.full_name}? They will be blocked from using the bot.`)) return;
    setBusy(p.id);
    try {
      await write(supabase.from('profiles').update({ account_status: status }).eq('id', p.id));
      await reload();
    } catch (err) {
      alert(`Update failed: ${(err as Error).message}`);
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
      </PageHeader>

      {error ? (
        <ErrorBox message={error} />
      ) : loading && !data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty message="No users yet. Send /start to the bot; a profile is created on the first message." />
      ) : (
        <Table headers={['Name', 'Telegram', 'Role', 'Phone', 'Status', 'Joined', '']}>
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
              <td className="py-3 px-4">
                <Badge value={p.account_status} />
              </td>
              <td className="py-3 px-4 text-xs text-gray-400">{timeAgo(p.created_at)}</td>
              <td className="py-3 px-4 text-right">
                {p.role !== 'OPERATOR' &&
                  (p.account_status === 'SUSPENDED' ? (
                    <button disabled={busy === p.id} onClick={() => setStatus(p, 'ACTIVE')} className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50">
                      Reactivate
                    </button>
                  ) : (
                    <button disabled={busy === p.id} onClick={() => setStatus(p, 'SUSPENDED')} className="text-xs font-medium text-rose-600 hover:underline disabled:opacity-50">
                      Suspend
                    </button>
                  ))}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
};
