import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  UserCheck,
  Activity,
  AlertTriangle,
  Sliders,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, setCurrentTab }) => {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  const navItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'requests', label: 'Requests', icon: ClipboardList },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'technicians', label: 'Verification', icon: UserCheck },
    { id: 'monitoring', label: 'Monitoring', icon: Activity },
    { id: 'complaints', label: 'Complaints', icon: AlertTriangle },
    { id: 'config', label: 'Configuration', icon: Sliders },
  ];

  return (
    <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col h-screen border-r border-slate-800">
      <div className="p-5 border-b border-slate-800">
        <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <span className="p-1.5 bg-sky-500 rounded-lg text-white">⚡</span>
          HomeOps
        </h1>
        <p className="text-xs text-slate-400 mt-1">Operator Dashboard</p>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800 text-xs text-slate-400">
        <p className="text-slate-500">Signed in as</p>
        <p className="mt-0.5 font-medium text-slate-300 truncate" title={email ?? ''}>{email ?? '...'}</p>
      </div>
    </aside>
  );
};
