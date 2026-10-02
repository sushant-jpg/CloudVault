'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, Files, FolderOpen, ShieldAlert, Upload } from 'lucide-react';
import { api, formatBytes, relativeTime } from '@/lib/api';

type DashboardData = {
  user: { name: string; storageUsedBytes: number; storageQuotaBytes: number } | null;
  stats: { files: number; folders: number; activeShares: number; alerts: number };
  recentActivity: Array<{ _id: string; action: string; resourceType: string; createdAt: string }>;
  recentFiles: Array<{ _id: string; displayName: string; mimeType: string; size: number; securityStatus: string; createdAt: string }>;
  recentDownloads: Array<{ _id: string; action: string; createdAt: string }>;
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState('');

  useEffect(() => {
    void api<DashboardData>('/users/dashboard').then(setData).catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <div className="notice error" role="alert">{error}</div>;
  if (!data) return <div className="stats-grid" aria-label="Loading dashboard"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>;

  const stats = [
    { label: 'Files in vault', value: data.stats.files, detail: 'Private documents', icon: Files },
    { label: 'Folders', value: data.stats.folders, detail: 'Your organization system', icon: FolderOpen },
    { label: 'Active shares', value: data.stats.activeShares, detail: 'Links currently available', icon: ArrowDownToLine },
    { label: 'Security alerts', value: data.stats.alerts, detail: 'Events requiring attention', icon: ShieldAlert }
  ];
  return <>
    <header className="page-header">
      <div><p className="eyebrow">Your private workspace</p><h1 className="page-title">Good to see you, {data.user?.name ?? 'there'}.</h1><p className="page-subtitle">Your files are private by default. See what is happening across your vault.</p></div>
      <div className="button-row"><Link className="button" href="/vault">Browse vault <ArrowRight size={15} /></Link><Link className="button primary" href="/vault?upload=1"><Upload size={15} /> Upload a file</Link></div>
    </header>
    <section className="stats-grid" aria-label="Vault overview">
      {stats.map(({ label, value, detail, icon: Icon }) => <article className="stat-card" key={label}><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={15} /></span></div><p className="stat-value">{value}</p><span className="stat-detail">{detail}</span></article>)}
    </section>
    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-head"><div><h2>Recently added</h2><p>Your latest private files</p></div><Link href="/vault">View vault <ArrowRight size={13} /></Link></div>
        {data.recentFiles.length === 0 ? <div className="empty-state"><span className="empty-icon"><Files size={22} /></span><strong>Your vault is ready</strong><p>Upload a file to start building your private workspace.</p><Link className="button primary" href="/vault?upload=1"><Upload size={14} /> Upload a file</Link></div> : <div className="file-list">{data.recentFiles.map((file) => <Link className="file-row" key={file._id} href={`/vault?file=${encodeURIComponent(file._id)}`}><span className="file-icon"><Files size={17} /></span><span><strong>{file.displayName}</strong><small>{formatBytes(file.size)} · {relativeTime(file.createdAt)}</small></span><span className={`status-pill ${file.securityStatus === 'CLEAN' ? '' : 'amber'}`}>{file.securityStatus.replaceAll('_', ' ')}</span></Link>)}</div>}
      </section>
      <div className="stack">
        <section className="panel"><div className="panel-head"><div><h2>Storage</h2><p>Personal vault usage</p></div></div><div className="storage-usage"><strong>{formatBytes(data.user?.storageUsedBytes ?? 0)}</strong><span>of {formatBytes(data.user?.storageQuotaBytes ?? 0)}</span></div><div className="progress-track"><span style={{ width: `${data.user?.storageQuotaBytes ? Math.min(100, (data.user.storageUsedBytes / data.user.storageQuotaBytes) * 100) : 0}%` }} /></div></section>
        <section className="panel"><div className="panel-head"><div><h2>Activity</h2><p>Recent account events</p></div><Link href="/activity">View all <ArrowRight size={13} /></Link></div>{data.recentActivity.length === 0 ? <div className="empty-state compact"><Activity size={20} /><p>Activity will appear here as you use your vault.</p></div> : <div className="activity-list">{data.recentActivity.slice(0, 5).map((event) => <div className="activity-row" key={event._id}><span className="activity-line" /><span><strong>{event.action.replaceAll('_', ' ')}</strong><small>{event.resourceType}</small></span><small>{relativeTime(event.createdAt)}</small></div>)}</div>}</section>
      </div>
    </div>
  </>;
}
