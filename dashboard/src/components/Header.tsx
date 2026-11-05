import React from 'react';
import { Bell, ShieldCheck, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';

export const Header: React.FC = () => {
  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
          <ShieldCheck className="w-3.5 h-3.5 mr-1" />
          Operator Staff
        </span>
      </div>

      <div className="flex items-center gap-4">
        <button className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-sky-500 rounded-full"></span>
        </button>
        <button
          title="Sign out"
          onClick={() => supabase.auth.signOut()}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
        >
          <LogOut className="w-5 h-5" />
        </button>
        <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-xs">
          OP
        </div>
      </div>
    </header>
  );
};
