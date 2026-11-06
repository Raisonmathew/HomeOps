import React, { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { Login } from './pages/Login';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { Requests } from './pages/Requests';
import { Technicians } from './pages/Technicians';
import { Monitoring } from './pages/Monitoring';
import { Complaints } from './pages/Complaints';
import { Config } from './pages/Config';
import { Users } from './pages/Users';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState('overview');
  // 'loading' | 'signed-out' | 'operator' | 'not-operator'
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'operator' | 'not-operator'>('loading');

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return setAuthState('signed-out');
      const { data, error } = await supabase.rpc('is_operator');
      setAuthState(!error && data === true ? 'operator' : 'not-operator');
    };
    check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { check(); });
    return () => sub.subscription.unsubscribe();
  }, []);

  const renderContent = () => {
    switch (currentTab) {
      case 'overview':
        return <Overview />;
      case 'requests':
        return <Requests />;
      case 'users':
        return <Users />;
      case 'technicians':
        return <Technicians />;
      case 'monitoring':
        return <Monitoring />;
      case 'complaints':
        return <Complaints />;
      case 'config':
        return <Config />;
      default:
        return <Overview />;
    }
  };

  if (authState === 'loading') return <div className="p-8 text-gray-500">Loading...</div>;
  if (authState === 'signed-out') return <Login />;
  if (authState === 'not-operator') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-gray-700">This account is not an active HomeOps operator.</p>
        <button className="px-4 py-2 bg-slate-800 text-white rounded text-sm" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <Layout currentTab={currentTab} setCurrentTab={setCurrentTab}>
      {renderContent()}
    </Layout>
  );
};

export default App;
