import React from 'react';

export const Monitoring: React.FC = () => {
  const technicians = [
    {
      name: 'Rajesh K.',
      category: 'Plumbing',
      status: 'ONLINE',
      locationAge: '12 mins ago',
      activeJobs: 1,
      acceptanceRate: '92%',
      completionRate: '98%',
      cancellationRate: '2%',
      rating: '4.8',
    },
    {
      name: 'Suresh Kumar',
      category: 'Electrical',
      status: 'ONLINE',
      locationAge: '35 mins ago',
      activeJobs: 1,
      acceptanceRate: '88%',
      completionRate: '95%',
      cancellationRate: '3%',
      rating: '4.9',
    },
    {
      name: 'Mohammed Ali',
      category: 'AC Repair',
      status: 'OFFLINE',
      locationAge: '3 hours ago',
      activeJobs: 0,
      acceptanceRate: '80%',
      completionRate: '90%',
      cancellationRate: '5%',
      rating: '4.6',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Technician Monitoring</h2>
        <p className="text-sm text-gray-500 mt-1">Live availability, location freshness, and reliability metrics</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-gray-600">
          <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-xs border-b border-gray-200">
            <tr>
              <th className="py-3 px-4">Technician</th>
              <th className="py-3 px-4">Category</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Location Freshness</th>
              <th className="py-3 px-4">Active Jobs</th>
              <th className="py-3 px-4">Acceptance</th>
              <th className="py-3 px-4">Completion</th>
              <th className="py-3 px-4">Cancel Rate</th>
              <th className="py-3 px-4">Rating</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {technicians.map((t, idx) => (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="py-3 px-4 font-semibold text-gray-900">{t.name}</td>
                <td className="py-3 px-4">{t.category}</td>
                <td className="py-3 px-4">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      t.status === 'ONLINE'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {t.status}
                  </span>
                </td>
                <td className="py-3 px-4 text-xs text-gray-500">{t.locationAge}</td>
                <td className="py-3 px-4 font-medium">{t.activeJobs}</td>
                <td className="py-3 px-4">{t.acceptanceRate}</td>
                <td className="py-3 px-4">{t.completionRate}</td>
                <td className="py-3 px-4 text-rose-600 font-medium">{t.cancellationRate}</td>
                <td className="py-3 px-4 font-bold text-gray-900">⭐ {t.rating}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
