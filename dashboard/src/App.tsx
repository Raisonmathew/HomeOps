import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { Login } from './pages/Login';
import { MfaGate } from './pages/MfaGate';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { Requests } from './pages/Requests';
import { Technicians } from './pages/Technicians';
import { Monitoring } from './pages/Monitoring';
import { Complaints } from './pages/Complaints';
import { Config } from './pages/Config';
import { Users } from './pages/Users';
import { Reviews } from './pages/Reviews';

type AuthState = 'loading' | 'signed-out' | 'operator' | 'not-operator' | 'mfa-required' | 'error';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState('overview');
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [authError, setAuthError] = useState<string | null>(null);

  const check = useCallback(async () => {
    const fail = (message: string) => {
      setAuthError(message);
      setAuthState('error');
    };
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return setAuthState('signed-out');
    // Spec §10.1: ADMIN accounts must pass TOTP MFA (aal2). The database enforces it too (migration 00010:
    // is_operator() is false for an ADMIN below aal2), so the MFA step must come before the is_operator check.
    // Fail closed: if the role or assurance level cannot be read, do not open the dashboard.
    const { data: op, error: opError } = await supabase
      .from('operator_profiles')
      .select('operator_role, active')
      .eq('supabase_auth_user_id', session.user.id)
      .maybeSingle();
    if (opError) return fail(opError.message);
    if (!op || !op.active) return setAuthState('not-operator');
    if (op.operator_role === 'ADMIN') {
      const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) return fail(aalError.message);
      if (aal.currentLevel !== 'aal2') return setAuthState('mfa-required');
    }

    const { data, error } = await supabase.rpc('is_operator');
    if (error || data !== true) return setAuthState('not-operator');
    setAuthState('operator');
  }, []);

  useEffect(() => {
    check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { check(); });
    return () => sub.subscription.unsubscribe();
  }, [check]);

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
      case 'reviews':
        return <Reviews />;
      case 'config':
        return <Config />;
      default:
        return <Overview />;
    }
  };

  if (authState === 'loading') return <div className="p-8 text-gray-500">Loading...</div>;
  if (authState === 'signed-out') return <Login />;
  if (authState === 'mfa-required') return <MfaGate onVerified={check} />;
  if (authState === 'not-operator' || authState === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-gray-700">
          {authState === 'error' ? 'Could not verify your operator access.' : 'This account is not an active HomeOps operator.'}
        </p>
        {authState === 'error' && authError && <p className="font-mono text-xs text-rose-700">{authError}</p>}
        <div className="flex gap-2">
          {authState === 'error' && (
            <button className="px-4 py-2 border border-gray-300 rounded text-sm" onClick={() => check()}>
              Retry
            </button>
          )}
          <button className="px-4 py-2 bg-slate-800 text-white rounded text-sm" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
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
