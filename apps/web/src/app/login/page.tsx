'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle2, Cloud, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError('');
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, ...(totpCode ? { totpCode } : {}) }) });
      router.push('/'); router.refresh();
    } catch (reason) {
      const failure = reason as Error & { code?: string };
      if (failure.code === 'AUTH_2FA_REQUIRED') { setNeedsTwoFactor(true); setError('Enter the six-digit code from your authenticator app.'); }
      else setError(failure.message);
    } finally { setLoading(false); }
  };

  return <main className="auth-page">
    <section className="auth-story">
      <div className="brand"><span className="brand-mark"><Cloud size={20} /></span><span>CloudVault</span></div>
      <div className="auth-copy"><p className="eyebrow">Controlled sharing</p><h1>Your files.<br />Your terms.</h1><p>Keep sensitive documents private, decide exactly who gets access, and take that access back whenever you need to.</p></div>
      <div className="auth-proof"><span><LockKeyhole size={14} /> Private by default</span><span><KeyRound size={14} /> Expiring access</span><span><ShieldCheck size={14} /> Audited activity</span></div>
    </section>
    <section className="auth-form-wrap">
      <form className="auth-form" onSubmit={submit}>
        <p className="eyebrow">Secure sign in</p><h2>Welcome back</h2><p>Continue to your private workspace.</p>
        {error && <div className={needsTwoFactor ? 'notice' : 'notice error'} style={{ marginBottom: 15 }}>{needsTwoFactor ? <KeyRound size={16} /> : <ShieldCheck size={16} />}<span>{error}</span></div>}
        <div className="field"><label htmlFor="email">EMAIL ADDRESS</label><input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
        <div className="field"><label htmlFor="password">PASSWORD</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
        {needsTwoFactor && <div className="field"><label htmlFor="totp">AUTHENTICATOR CODE</label><input id="totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))} required /></div>}
        <button className="button primary auth-submit" disabled={loading}>{loading ? 'VERIFYING…' : 'SIGN IN SECURELY'}{!loading && <CheckCircle2 size={16} />}</button>
        <p className="auth-meta">New to CloudVault? <Link href="/register">Create an account</Link></p>
      </form>
    </section>
  </main>;
}
