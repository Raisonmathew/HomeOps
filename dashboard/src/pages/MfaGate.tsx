import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

type Stage =
  | { kind: 'loading' }
  | { kind: 'enroll'; factorId: string; qrCode: string; secret: string }
  | { kind: 'verify'; factorId: string }
  | { kind: 'error'; message: string };

/** GoTrue returns qr_code as an SVG data URL; older versions returned raw SVG markup. */
const qrSrc = (qr: string) => (qr.startsWith('data:') ? qr : `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`);

/**
 * Spec §10.1: ADMIN operators must complete TOTP MFA (session aal2) before the dashboard opens.
 * Enrols a TOTP factor on first use, then challenges + verifies a 6-digit code.
 */
export const MfaGate: React.FC<{ onVerified: () => Promise<void> }> = ({ onVerified }) => {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false); // StrictMode runs effects twice; enrol only once

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      const totp = data.all.filter((f) => f.factor_type === 'totp');
      const verified = totp.find((f) => f.status === 'verified');
      if (verified) return setStage({ kind: 'verify', factorId: verified.id });

      // Remove abandoned, never-verified enrolments so a fresh QR code can be issued.
      for (const f of totp) {
        const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: f.id });
        if (unenrollError) throw unenrollError;
      }
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        issuer: 'HomeOps',
        friendlyName: 'HomeOps dashboard',
      });
      if (enrollError) throw enrollError;
      setStage({ kind: 'enroll', factorId: enrolled.id, qrCode: enrolled.totp.qr_code, secret: enrolled.totp.secret });
    })().catch((err) => setStage({ kind: 'error', message: err instanceof Error ? err.message : String(err) }));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stage.kind !== 'enroll' && stage.kind !== 'verify') return;
    const clean = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) return setError('Enter the 6-digit code from your authenticator app.');
    setBusy(true);
    setError(null);
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: stage.factorId });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: stage.factorId, challengeId: challenge.id, code: clean });
      if (verifyError) throw verifyError;
      await onVerified(); // re-checks the assurance level; App switches to the dashboard at aal2
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white p-8 rounded-lg shadow border border-gray-200 space-y-4">
        <h1 className="text-xl font-bold text-slate-800">Two-factor authentication</h1>

        {stage.kind === 'loading' && <p className="text-sm text-gray-500">Loading...</p>}

        {stage.kind === 'error' && (
          <p className="text-sm text-red-600">
            Could not set up two-factor authentication: <span className="font-mono text-xs">{stage.message}</span>
          </p>
        )}

        {stage.kind === 'enroll' && (
          <div className="space-y-3 text-sm text-gray-600">
            <p>Admin accounts must use an authenticator app. Scan this QR code with Google Authenticator, 1Password, Authy or similar.</p>
            <img src={qrSrc(stage.qrCode)} alt="TOTP QR code" className="w-44 h-44 mx-auto border border-gray-100 rounded" />
            <p className="text-xs text-gray-500">
              Can't scan it? Enter this secret manually:
              <code className="block mt-1 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded font-mono text-xs text-gray-900 break-all select-all">
                {stage.secret}
              </code>
            </p>
          </div>
        )}

        {stage.kind === 'verify' && <p className="text-sm text-gray-600">Enter the 6-digit code from your authenticator app to continue.</p>}

        {(stage.kind === 'enroll' || stage.kind === 'verify') && (
          <form onSubmit={submit} className="space-y-3">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={7}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm tracking-widest font-mono"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={busy} className="w-full bg-slate-800 text-white rounded py-2 text-sm font-medium disabled:opacity-50">
              {busy ? 'Verifying...' : 'Verify'}
            </button>
          </form>
        )}

        <button onClick={() => supabase.auth.signOut()} className="w-full text-xs text-gray-500 hover:text-gray-700">
          Sign out
        </button>
      </div>
    </div>
  );
};
