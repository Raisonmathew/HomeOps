import React, { useState } from 'react';
import { Check, X, Award, Ban, Eye } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { currentOperatorProfileId, must, timeAgo, useLoader, write } from '../lib/data';
import { Badge, Empty, ErrorBox, FilterTabs, Loading, PageHeader } from '../components/ui';

const FILTERS: Record<string, string[] | null> = {
  PENDING: ['APPLIED', 'UNDER_REVIEW'],
  APPROVED: ['APPROVED'],
  'REJECTED / SUSPENDED': ['REJECTED', 'SUSPENDED'],
  ALL: null,
};

const TECH_SELECT =
  'id, verification_status, probation_status, experience_years, profile_summary, base_latitude, base_longitude, default_radius_km, created_at, ' +
  'profile:profiles!technician_profiles_profile_id_fkey(id, full_name, phone_number, telegram_username, account_status), ' +
  'skills:technician_skills(id, approval_status, category:service_categories(name), issue:issue_types(name))';

export const Technicians: React.FC = () => {
  const [filter, setFilter] = useState('PENDING');
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, reload } = useLoader(async () => {
    let q = supabase.from('technician_profiles').select(TECH_SELECT).order('created_at', { ascending: false });
    const statuses = FILTERS[filter];
    if (statuses) q = q.in('verification_status', statuses);
    return must(await q) as any[];
  }, [filter]);

  const run = async (techId: string, action: () => Promise<void>) => {
    setBusy(techId);
    try {
      await action();
      await reload();
    } catch (err) {
      alert(`Action failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const approve = (t: any) =>
    run(t.id, async () => {
      const operatorProfileId = await currentOperatorProfileId();
      if (!operatorProfileId) throw new Error('Your operator profile could not be found.');
      // Spec §6.2: nobody approves their own technician profile or skills.
      if (operatorProfileId === t.profile?.id) throw new Error('You cannot approve your own technician profile.');
      await write(
        supabase
          .from('technician_profiles')
          .update({
            verification_status: 'APPROVED',
            ...(t.probation_status === 'NOT_STARTED' ? { probation_status: 'ACTIVE' } : {}),
          })
          .eq('id', t.id)
      );
      await write(
        supabase
          .from('technician_skills')
          .update({ approval_status: 'APPROVED', approved_by: operatorProfileId, approved_at: new Date().toISOString() })
          .eq('technician_id', t.id)
          .eq('approval_status', 'PENDING')
      );
    });

  const reject = (t: any) => {
    if (!confirm(`Reject ${t.profile?.full_name ?? 'this applicant'}?`)) return;
    run(t.id, async () => {
      await write(supabase.from('technician_profiles').update({ verification_status: 'REJECTED' }).eq('id', t.id));
      await write(
        supabase.from('technician_skills').update({ approval_status: 'REJECTED' }).eq('technician_id', t.id).eq('approval_status', 'PENDING')
      );
    });
  };

  const setVerification = (t: any, status: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    run(t.id, () => write(supabase.from('technician_profiles').update({ verification_status: status }).eq('id', t.id)));
  };

  const completeProbation = (t: any) =>
    run(t.id, () => write(supabase.from('technician_profiles').update({ probation_status: 'COMPLETED' }).eq('id', t.id)));

  return (
    <div className="space-y-6">
      <PageHeader title="Technician Verification" subtitle="Review applicants, approve skills, and manage probation" onRefresh={reload} loading={loading}>
        <FilterTabs options={Object.keys(FILTERS)} value={filter} onChange={setFilter} />
      </PageHeader>

      {error ? (
        <ErrorBox message={error} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.length ? (
        <Empty message="No technicians in this list." />
      ) : (
        <div className="space-y-4">
          {data.map((t) => {
            const p = t.profile ?? {};
            const disabled = busy === t.id;
            const pending = t.verification_status === 'APPLIED' || t.verification_status === 'UNDER_REVIEW';
            return (
              <div key={t.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-lg font-bold text-gray-900">{p.full_name ?? 'Unknown'}</h3>
                    <Badge value={t.verification_status} />
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">Probation: {t.probation_status}</span>
                    {p.account_status !== 'ACTIVE' && <Badge value={p.account_status} />}
                  </div>
                  <p className="text-sm text-gray-600">
                    📞 {p.phone_number ?? 'no phone'}
                    {p.telegram_username && <> · @{p.telegram_username}</>} · ⏱ {t.experience_years ?? 0} yrs experience · applied{' '}
                    {timeAgo(t.created_at)}
                  </p>
                  <p className="text-sm text-gray-600">
                    📍 Base:{' '}
                    {t.base_latitude != null ? (
                      <a
                        className="text-sky-600 hover:underline"
                        target="_blank"
                        rel="noreferrer"
                        href={`https://maps.google.com/?q=${t.base_latitude},${t.base_longitude}`}
                      >
                        {Number(t.base_latitude).toFixed(4)}, {Number(t.base_longitude).toFixed(4)}
                      </a>
                    ) : (
                      'not set'
                    )}{' '}
                    (Radius: {t.default_radius_km} km)
                  </p>
                  {t.profile_summary && <p className="text-sm text-gray-500 italic">"{t.profile_summary}"</p>}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {(t.skills ?? []).length === 0 ? (
                      <span className="text-xs text-gray-400">No skills submitted</span>
                    ) : (
                      t.skills.map((s: any) => (
                        <span key={s.id} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-md font-medium">
                          {s.category?.name ?? '-'}
                          {s.issue?.name ? ` - ${s.issue.name}` : ''} · {s.approval_status}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {pending && (
                    <>
                      {t.verification_status === 'APPLIED' && (
                        <ActionButton disabled={disabled} onClick={() => setVerification(t, 'UNDER_REVIEW')} icon={Eye} tone="slate">
                          Start Review
                        </ActionButton>
                      )}
                      <ActionButton disabled={disabled} onClick={() => approve(t)} icon={Check} tone="green">
                        Approve
                      </ActionButton>
                      <ActionButton disabled={disabled} onClick={() => reject(t)} icon={X} tone="red">
                        Reject
                      </ActionButton>
                    </>
                  )}
                  {t.verification_status === 'APPROVED' && (
                    <>
                      {t.probation_status !== 'COMPLETED' && (
                        <ActionButton disabled={disabled} onClick={() => completeProbation(t)} icon={Award} tone="indigo">
                          Complete Probation
                        </ActionButton>
                      )}
                      <ActionButton
                        disabled={disabled}
                        onClick={() => setVerification(t, 'SUSPENDED', `Suspend ${p.full_name}? They will stop receiving job offers.`)}
                        icon={Ban}
                        tone="red"
                      >
                        Suspend
                      </ActionButton>
                    </>
                  )}
                  {(t.verification_status === 'SUSPENDED' || t.verification_status === 'REJECTED') && (
                    <ActionButton disabled={disabled} onClick={() => setVerification(t, 'UNDER_REVIEW')} icon={Eye} tone="slate">
                      Re-open Review
                    </ActionButton>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const TONES = {
  green: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  red: 'bg-rose-50 hover:bg-rose-100 text-rose-700',
  indigo: 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700',
  slate: 'bg-slate-100 hover:bg-slate-200 text-slate-700',
};

const ActionButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof TONES;
  children: React.ReactNode;
}> = ({ onClick, disabled, icon: Icon, tone, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 ${TONES[tone]}`}
  >
    <Icon className="w-3.5 h-3.5" />
    {children}
  </button>
);
