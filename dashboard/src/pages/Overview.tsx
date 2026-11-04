import React from 'react';
import { Search, Users, Clock, AlertOctagon, CheckCircle2, MapPin } from 'lucide-react';

export const Overview: React.FC = () => {
  const metrics = [
    { label: 'Searching for Technicians', value: '3', icon: Search, color: 'text-amber-600 bg-amber-50' },
    { label: 'Active Assignments', value: '8', icon: Users, color: 'text-sky-600 bg-sky-50' },
    { label: 'Awaiting Confirmation', value: '2', icon: Clock, color: 'text-indigo-600 bg-indigo-50' },
    { label: 'Disputed Requests', value: '1', icon: AlertOctagon, color: 'text-rose-600 bg-rose-50' },
    { label: 'Online Technicians', value: '14', icon: MapPin, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'No Match Escalations', value: '0', icon: CheckCircle2, color: 'text-teal-600 bg-teal-50' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Marketplace Overview</h2>
        <p className="text-sm text-gray-500 mt-1">Real-time matching status and operations summary</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {metrics.map((m, idx) => {
          const Icon = m.icon;
          return (
            <div key={idx} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
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

      {/* Real-time search activity */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Active Matching Searches</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-xs border-y border-gray-200">
              <tr>
                <th className="py-3 px-4">Request #</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Locality</th>
                <th className="py-3 px-4">Batch</th>
                <th className="py-3 px-4">Offers Sent</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr>
                <td className="py-3 px-4 font-mono font-medium text-gray-900">REQ-1042</td>
                <td className="py-3 px-4">Plumbing (Pipe Leak)</td>
                <td className="py-3 px-4">Whitefield</td>
                <td className="py-3 px-4">Batch 1 (Top 3)</td>
                <td className="py-3 px-4">3 offers (45s remaining)</td>
                <td className="py-3 px-4">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                    SEARCHING
                  </span>
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-mono font-medium text-gray-900">REQ-1041</td>
                <td className="py-3 px-4">AC Repair (Not cooling)</td>
                <td className="py-3 px-4">ITPL Road</td>
                <td className="py-3 px-4">Batch 2</td>
                <td className="py-3 px-4">2 offers (10s remaining)</td>
                <td className="py-3 px-4">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                    SEARCHING
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
