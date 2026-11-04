import React from 'react';
import { Check, X, ShieldAlert, Award } from 'lucide-react';

export const Technicians: React.FC = () => {
  const applicants = [
    {
      id: 'T-102',
      name: 'Ramesh Patel',
      phone: '+91 98801 23456',
      experience: '6 years',
      skills: ['Plumbing - Pipe Leakage', 'Plumbing - Tap & Fixtures'],
      baseLocation: 'Whitefield Main Rd',
      radius: '10 km',
      verificationStatus: 'UNDER_REVIEW',
      probationStatus: 'NOT_STARTED',
    },
    {
      id: 'T-103',
      name: 'Deepak Sharma',
      phone: '+91 97412 88990',
      experience: '4 years',
      skills: ['Electrical - Switch & Socket', 'Electrical - MCB Outages'],
      baseLocation: 'Kadugodi',
      radius: '8 km',
      verificationStatus: 'APPLIED',
      probationStatus: 'NOT_STARTED',
    },
    {
      id: 'T-101',
      name: 'Rajesh K.',
      phone: '+91 98450 11223',
      experience: '8 years',
      skills: ['Plumbing - Pipe Leakage', 'Plumbing - Drain Blockage'],
      baseLocation: 'ITPL',
      radius: '12 km',
      verificationStatus: 'APPROVED',
      probationStatus: 'ACTIVE',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Technician Verification</h2>
        <p className="text-sm text-gray-500 mt-1">Review applicant profiles, approve skills, and assign probation</p>
      </div>

      <div className="space-y-4">
        {applicants.map((a) => (
          <div key={a.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-gray-900">{a.name}</h3>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  a.verificationStatus === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}>
                  {a.verificationStatus}
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                  Probation: {a.probationStatus}
                </span>
              </div>
              <p className="text-sm text-gray-600">
                📞 {a.phone} &nbsp;|&nbsp; ⏱ Experience: {a.experience}
              </p>
              <p className="text-sm text-gray-600">
                📍 Base: <span className="font-medium text-gray-800">{a.baseLocation}</span> (Radius: {a.radius})
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {a.skills.map((s, idx) => (
                  <span key={idx} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-md font-medium">
                    {s}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {a.verificationStatus !== 'APPROVED' ? (
                <>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors">
                    <Check className="w-3.5 h-3.5" />
                    Approve Skills
                  </button>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-lg transition-colors">
                    <X className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </>
              ) : (
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg transition-colors">
                  <Award className="w-3.5 h-3.5" />
                  Complete Probation
                </button>
              )}
              <button className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                <ShieldAlert className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
