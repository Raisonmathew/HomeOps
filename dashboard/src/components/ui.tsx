import React from 'react';
import { Download, RefreshCw } from 'lucide-react';

export const PageHeader: React.FC<{
  title: string;
  subtitle: string;
  onRefresh?: () => void;
  loading?: boolean;
  children?: React.ReactNode;
}> = ({ title, subtitle, onRefresh, loading, children }) => (
  <div className="flex flex-wrap items-center justify-between gap-4">
    <div>
      <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
      <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      )}
    </div>
  </div>
);

export const FilterTabs: React.FC<{ options: string[]; value: string; onChange: (v: string) => void }> = ({
  options,
  value,
  onChange,
}) => (
  <>
    {options.map((o) => (
      <button
        key={o}
        onClick={() => onChange(o)}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
          value === o ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
        }`}
      >
        {o}
      </button>
    ))}
  </>
);

export const ErrorBox: React.FC<{ message: string }> = ({ message }) => (
  <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
    <p className="font-semibold">Could not load data</p>
    <p className="mt-1 font-mono text-xs">{message}</p>
  </div>
);

export const Empty: React.FC<{ message: string }> = ({ message }) => (
  <div className="p-8 text-center text-sm text-gray-400 bg-white rounded-xl border border-dashed border-gray-200">
    {message}
  </div>
);

export const Loading: React.FC = () => <div className="p-8 text-center text-sm text-gray-400">Loading...</div>;

const BADGE_COLORS: Record<string, string> = {
  // request
  SEARCHING: 'bg-amber-100 text-amber-800',
  REQUESTED: 'bg-amber-100 text-amber-800',
  DRAFT: 'bg-gray-100 text-gray-600',
  ASSIGNED: 'bg-sky-100 text-sky-800',
  CONTACTED: 'bg-sky-100 text-sky-800',
  DISCUSSING_SCOPE: 'bg-sky-100 text-sky-800',
  AGREED: 'bg-sky-100 text-sky-800',
  IN_PROGRESS: 'bg-sky-100 text-sky-800',
  TECHNICIAN_MARKED_COMPLETE: 'bg-indigo-100 text-indigo-800',
  CUSTOMER_CONFIRMATION_PENDING: 'bg-indigo-100 text-indigo-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  DISPUTED: 'bg-rose-100 text-rose-800',
  NO_TECHNICIAN_FOUND: 'bg-rose-100 text-rose-800',
  // verification / account
  APPLIED: 'bg-amber-100 text-amber-800',
  UNDER_REVIEW: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
  SUSPENDED: 'bg-rose-100 text-rose-800',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  RESTRICTED: 'bg-amber-100 text-amber-800',
  PENDING: 'bg-amber-100 text-amber-800',
  // availability
  ONLINE: 'bg-emerald-100 text-emerald-800',
  OFFLINE: 'bg-gray-100 text-gray-600',
  EXPIRED: 'bg-gray-100 text-gray-600',
  BUSY: 'bg-sky-100 text-sky-800',
  // complaints
  OPEN: 'bg-rose-100 text-rose-800',
  RESOLVED: 'bg-emerald-100 text-emerald-800',
  ACCOUNT_ACTION_TAKEN: 'bg-indigo-100 text-indigo-800',
  URGENT: 'bg-rose-600 text-white',
  // complaint categories
  HARASSMENT: 'bg-rose-100 text-rose-800',
  UNSAFE: 'bg-red-100 text-red-800',
  FRAUD: 'bg-orange-100 text-orange-800',
  SERVICE: 'bg-sky-100 text-sky-800',
  PAYMENT: 'bg-violet-100 text-violet-800',
  OTHER: 'bg-gray-100 text-gray-700',
  AUTO: 'bg-indigo-100 text-indigo-800',
  // payment declaration (HomeOps records, never verifies, direct payment)
  NOT_APPLICABLE: 'bg-gray-100 text-gray-600',
  DIRECT_PAYMENT_CONFIRMED_BY_CUSTOMER: 'bg-emerald-100 text-emerald-800',
  DIRECT_PAYMENT_CONFIRMED_BY_TECHNICIAN: 'bg-teal-100 text-teal-800',
  PAYMENT_DISPUTE_REPORTED: 'bg-rose-100 text-rose-800',
  // estimate acknowledgement
  NOT_REVIEWED: 'bg-gray-100 text-gray-600',
  ACKNOWLEDGED: 'bg-emerald-100 text-emerald-800',
};

export const Badge: React.FC<{ value: string | null | undefined }> = ({ value }) => (
  <span
    className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${
      BADGE_COLORS[value ?? ''] ?? 'bg-gray-100 text-gray-700'
    }`}
  >
    {value ?? '-'}
  </span>
);

/** 1-5 star score, e.g. ★★★★☆ */
export const Stars: React.FC<{ score: number }> = ({ score }) => (
  <span className="whitespace-nowrap" title={`${score} / 5`}>
    <span className="text-amber-500">{'★'.repeat(score)}</span>
    <span className="text-gray-300">{'★'.repeat(Math.max(0, 5 - score))}</span>
  </span>
);

export const Tags: React.FC<{ tags: string[] | null | undefined }> = ({ tags }) =>
  tags?.length ? (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="px-1.5 py-0.5 bg-gray-100 text-gray-700 text-[11px] rounded font-medium">
          {t}
        </span>
      ))}
    </span>
  ) : null;

export const ExportButton: React.FC<{ onClick: () => void; disabled?: boolean }> = ({ onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
  >
    <Download className="w-3.5 h-3.5" />
    Export CSV
  </button>
);

export const Table: React.FC<{ headers: string[]; children: React.ReactNode }> = ({ headers, children }) => (
  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
    <table className="w-full text-left text-sm text-gray-600">
      <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-xs border-b border-gray-200">
        <tr>
          {headers.map((h) => (
            <th key={h} className="py-3 px-4 whitespace-nowrap">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">{children}</tbody>
    </table>
  </div>
);
