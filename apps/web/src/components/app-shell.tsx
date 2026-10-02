'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Activity, Bell, Building2, ChevronDown, Cloud, FileKey2, FolderLock, LayoutDashboard,
  LogOut, Menu, Moon, Search, Settings, ShieldCheck, Sun, Trash2, X
} from 'lucide-react';
import { api, formatBytes } from '@/lib/api';

const navigation = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/vault', label: 'My Vault', icon: FolderLock },
  { href: '/shared', label: 'Shared', icon: FileKey2 },
  { href: '/organizations', label: 'Organizations', icon: Building2 },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/security', label: 'Security', icon: ShieldCheck },
  { href: '/trash', label: 'Trash', icon: Trash2 },
  { href: '/settings', label: 'Settings', icon: Settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [storageUsage, setStorageUsage] = useState<{ used: number; quota: number }>();
  const [notifications, setNotifications] = useState<Array<{ _id: string; title: string; message: string; readAt?: string }>>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('cloudvault-theme');
    const enabled = stored === 'dark' || (stored !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    setDark(enabled);
    document.documentElement.dataset.theme = enabled ? 'dark' : 'light';
    void Promise.all([
      api<{ unread: number; notifications: Array<{ _id: string; title: string; message: string; readAt?: string }> }>('/notifications?limit=5'),
      api<{ storageUsedBytes: number; storageQuotaBytes: number }>('/files/usage/summary')
    ]).then(([notificationData, usage]) => {
      setNotificationCount(notificationData.unread);
      setNotifications(notificationData.notifications);
      setStorageUsage({ used: usage.storageUsedBytes, quota: usage.storageQuotaBytes });
    }).catch(() => undefined);
  }, []);

  const toggleTheme = () => {
    const value = !dark;
    setDark(value);
    document.documentElement.dataset.theme = value ? 'dark' : 'light';
    localStorage.setItem('cloudvault-theme', value ? 'dark' : 'light');
  };

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.push('/login');
  };
  const markRead = async (id: string) => {
    await api(`/notifications/${id}/read`, { method: 'POST' });
    setNotifications((current) => current.map((item) => item._id === id ? { ...item, readAt: new Date().toISOString() } : item));
    setNotificationCount((count) => Math.max(0, count - 1));
  };
  const storagePercent = storageUsage?.quota ? Math.min(100, storageUsage.used / storageUsage.quota * 100) : 0;

  return <div className="app-frame">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Cloud size={20} /></span><span>CloudVault</span></div>
      <button className="mobile-close icon-button" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={20} /></button>
      <nav className="nav-list" aria-label="Main navigation">
        <p className="nav-caption">Workspace</p>
        {navigation.slice(0, 6).map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={pathname === href ? 'nav-link active' : 'nav-link'}><Icon size={18} /><span>{label}</span>{label === 'Security' && <span className="nav-dot" />}</Link>)}
        <p className="nav-caption nav-caption-spaced">Manage</p>
        {navigation.slice(6).map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={pathname === href ? 'nav-link active' : 'nav-link'}><Icon size={18} /><span>{label}</span></Link>)}
      </nav>
      <div className="sidebar-storage">
        <div className="storage-title"><span>Personal vault</span><span>{storageUsage ? `${storagePercent.toFixed(0)}%` : 'Loading'}</span></div>
        <div className="progress-track"><span style={{ width: `${storagePercent}%` }} /></div>
        <p>{storageUsage ? `${formatBytes(storageUsage.used)} of ${formatBytes(storageUsage.quota)} used` : 'Storage usage unavailable'}</p>
      </div>
      <button className="profile-chip" onClick={() => void logout()}><span className="avatar">CV</span><span><strong>My account</strong><small>Sign out securely</small></span><LogOut size={16} /></button>
    </aside>
    {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}
    <div className="main-column">
      <header className="topbar">
        <button className="menu-button icon-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
        <div className="global-search"><Search size={17} /><input aria-label="Search vault" placeholder="Search files, folders, activity…" /><kbd>⌘ K</kbd></div>
        <div className="top-actions">
          <button className="icon-button" onClick={toggleTheme} aria-label="Toggle color theme">{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
          <button className="icon-button notification-button" onClick={() => setNotificationsOpen((open) => !open)} aria-label={`${notificationCount} unread notifications`}><Bell size={19} />{notificationCount > 0 && <span />}</button>
          {notificationsOpen && <section className="notification-popover" aria-label="Notifications">
            <div className="notification-popover-head"><strong>Notifications</strong><span>{notificationCount} unread</span></div>
            {notifications.length === 0 ? <p className="notification-empty">No notifications yet.</p> : notifications.map((item) => <button key={item._id} className={`notification-item ${item.readAt ? '' : 'unread'}`} onClick={() => void markRead(item._id)}><strong>{item.title}</strong><span>{item.message}</span></button>)}
          </section>}
          <button className="workspace-button"><span className="avatar small">CV</span><span>Personal</span><ChevronDown size={15} /></button>
        </div>
      </header>
      <main className="page-content">{children}</main>
    </div>
  </div>;
}
