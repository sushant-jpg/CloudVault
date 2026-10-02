'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
type UserSettings = { name: string; email: string; emailVerified: boolean; twoFactorEnabled: boolean };
export default function SettingsPage() {
  const [user, setUser] = useState<UserSettings>();
  const [error, setError] = useState('');
  useEffect(() => { void api<{ user: UserSettings }>('/users/dashboard').then((data) => setUser(data.user)).catch((reason: Error) => setError(reason.message)); }, []);
  return <><header className="page-header"><div><p className="eyebrow">Account preferences</p><h1 className="page-title">Settings</h1><p className="page-subtitle">Your account and security configuration.</p></div></header>{error && <div className="notice error" role="alert">{error}</div>}{!user ? <div className="skeleton" /> : <section className="panel"><div className="setting-row"><span><strong>Name</strong><p>Your profile display name.</p></span><span>{user.name}</span></div><div className="setting-row"><span><strong>Email address</strong><p>{user.emailVerified ? 'Verified' : 'Verification required'}</p></span><span>{user.email}</span></div><div className="setting-row"><span><strong>Two-factor authentication</strong><p>Additional protection for sign-in.</p></span><span>{user.twoFactorEnabled ? 'Enabled' : 'Not enabled'}</span></div><p className="page-subtitle">Theme preferences are available from the top bar. Password and 2FA management endpoints are available through the API.</p></section>}</>;
}
