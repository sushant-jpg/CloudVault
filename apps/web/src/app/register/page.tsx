'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2, Cloud, LockKeyhole, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const data = await api<{ verificationToken?: string }>('/auth/register', { method: 'POST', body: JSON.stringify(form) });
      setMessage(`Account created. Verify your email before signing in.${data.verificationToken ? ` Development verification token: ${data.verificationToken}` : ''}`);
    } catch (reason) { setError((reason as Error).message); } finally { setLoading(false); }
  };
  return <main className="auth-page">
    <section className="auth-story"><div className="brand"><span className="brand-mark"><Cloud size={20} /></span><span>CloudVault</span></div><div className="auth-copy"><p className="eyebrow">Private by design</p><h1>Take control<br />after send.</h1><p>Replace permanent links with protected, expiring access and a complete activity trail.</p></div><div className="auth-proof"><span><LockKeyhole size={14} /> Private objects</span><span><ShieldCheck size={14} /> Security scanning</span></div></section>
    <section className="auth-form-wrap"><form className="auth-form" onSubmit={submit}><p className="eyebrow">Create your vault</p><h2>Start securely</h2><p>Your first personal vault includes 5 GB of private storage.</p>
      {message && <div className="notice" style={{ marginBottom: 15 }}><CheckCircle2 size={16} /><span>{message}</span></div>}{error && <div className="notice error" style={{ marginBottom: 15 }}><ShieldCheck size={16} /><span>{error}</span></div>}
      <div className="field"><label htmlFor="name">FULL NAME</label><input id="name" autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></div>
      <div className="field"><label htmlFor="email">EMAIL ADDRESS</label><input id="email" type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></div>
      <div className="field"><label htmlFor="password">PASSWORD</label><input id="password" type="password" minLength={12} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /><small>12+ characters with uppercase, lowercase, and a number.</small></div>
      <button className="button primary auth-submit" disabled={loading || Boolean(message)}>{loading ? 'CREATING VAULT…' : 'CREATE PRIVATE VAULT'}</button><p className="auth-meta">Already have an account? <Link href="/login">Sign in</Link></p>
    </form></section>
  </main>;
}
