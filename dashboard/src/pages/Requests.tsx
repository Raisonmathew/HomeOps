import React, { useState } from 'react';

export const Requests: React.FC = () => {
  const [filter, setFilter] = useState('ALL');

  const requests = [
    {
      id: 'REQ-1042',
      customer: 'Anand R.',
      category: 'Plumbing',
      issue: 'Pipe leakage',
      locality: 'Whitefield',
      status: 'SEARCHING',
      technician: '-',
      created: '5 mins ago',
    },
    {
      id: 'REQ-1040',
      customer: 'Priya M.',
      category: 'Electrical',
      issue: 'Switchboard tripping',
      locality: 'ECC Road',
      status: 'IN_PROGRESS',
      technician: 'Suresh K. (⭐ 4.9)',
      created: '45 mins ago',
    },
    {
      id: 'REQ-1038',
      customer: 'Karthik V.',
      category: 'AC Repair',
      issue: 'Cleaning & Wash',
      locality: 'Hoodi',
      status: 'COMPLETED',
      technician: 'Rajesh P. (⭐ 4.7)',
      created: '2 hours ago',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Request Management</h2>
          <p className="text-sm text-gray-500 mt-1">Track request lifecycles, offers, and assignees</p>
        </div>

        <div className="flex gap-2">
          {['ALL', 'SEARCHING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].map((st) => (
            <button
              key={st}
              onClick={() => setFilter(st)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                filter === st
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-gray-600">
          <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-xs border-b border-gray-200">
            <tr>
              <th className="py-3 px-4">Request #</th>
              <th className="py-3 px-4">Customer</th>
              <th className="py-3 px-4">Service</th>
              <th className="py-3 px-4">Locality</th>
              <th className="py-3 px-4">Assigned Tech</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Created</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {requests.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="py-3 px-4 font-mono font-medium text-gray-900">{r.id}</td>
                <td className="py-3 px-4 font-medium text-gray-900">{r.customer}</td>
                <td className="py-3 px-4">
                  {r.category} <span className="text-xs text-gray-400">({r.issue})</span>
                </td>
                <td className="py-3 px-4">{r.locality}</td>
                <td className="py-3 px-4">{r.technician}</td>
                <td className="py-3 px-4">
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      r.status === 'SEARCHING'
                        ? 'bg-amber-100 text-amber-800'
                        : r.status === 'IN_PROGRESS'
                        ? 'bg-sky-100 text-sky-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="py-3 px-4 text-xs text-gray-400">{r.created}</td>
                <td className="py-3 px-4 text-right">
                  <button className="text-sky-600 hover:text-sky-800 font-medium text-xs">
                    View Audit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
