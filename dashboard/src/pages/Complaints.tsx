import React from 'react';
import { AlertCircle } from 'lucide-react';

export const Complaints: React.FC = () => {
  const complaints = [
    {
      id: 'CMP-101',
      requestNumber: 'REQ-1035',
      complainant: 'Rahul Nair (Customer)',
      against: 'Technician T-104',
      type: 'Pricing Disagreement',
      description: 'Technician demanded higher visiting charges than initially discussed via chat.',
      status: 'OPEN',
      created: '1 day ago',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Complaint Management</h2>
        <p className="text-sm text-gray-500 mt-1">Review disputes, contact parties, and issue account warnings or suspensions</p>
      </div>

      <div className="space-y-4">
        {complaints.map((c) => (
          <div key={c.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-rose-500" />
                <span className="font-bold text-gray-900">{c.id}</span>
                <span className="text-sm text-gray-500">for {c.requestNumber}</span>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800">
                {c.status}
              </span>
            </div>

            <div className="text-sm text-gray-700 bg-gray-50 p-3.5 rounded-lg border border-gray-100">
              <p className="font-semibold text-gray-900 mb-1">{c.type}</p>
              <p>{c.description}</p>
            </div>

            <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-100">
              <span>Reported by: <strong className="text-gray-700">{c.complainant}</strong> against <strong className="text-gray-700">{c.against}</strong></span>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-medium">
                  Contact Parties
                </button>
                <button className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg font-medium">
                  Resolve
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
