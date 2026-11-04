import React from 'react';

export const Config: React.FC = () => {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Marketplace Configuration</h2>
        <p className="text-sm text-gray-500 mt-1">Configure matching parameters, batch sizes, and timeouts</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
        <h3 className="text-lg font-semibold text-gray-900">Matching Weights</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <label className="block font-medium text-gray-700">Skill Fit Weight</label>
            <input type="number" defaultValue={30} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block font-medium text-gray-700">Proximity Weight</label>
            <input type="number" defaultValue={25} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block font-medium text-gray-700">Time Availability Weight</label>
            <input type="number" defaultValue={15} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block font-medium text-gray-700">Reliability Weight</label>
            <input type="number" defaultValue={15} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block font-medium text-gray-700">Rating Weight</label>
            <input type="number" defaultValue={10} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block font-medium text-gray-700">Fairness Weight</label>
            <input type="number" defaultValue={5} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
        </div>

        <h3 className="text-lg font-semibold text-gray-900 pt-4 border-t border-gray-100">Offer Batching</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <label className="block font-medium text-gray-700">Batch 1 Size (Technicians)</label>
            <input type="number" defaultValue={3} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block font-medium text-gray-700">Batch 1 Expiry (Seconds)</label>
            <input type="number" defaultValue={90} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block font-medium text-gray-700">Max Concurrent Active Jobs</label>
            <input type="number" defaultValue={2} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block font-medium text-gray-700">Location Session Duration (Hours)</label>
            <input type="number" defaultValue={8} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
        </div>

        <div className="pt-4 flex justify-end">
          <button className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-lg text-sm transition-colors">
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};
