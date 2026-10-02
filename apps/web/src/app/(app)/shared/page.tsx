'use client';

import { useEffect, useState } from 'react';
import { api, relativeTime } from '@/lib/api';

type Share = { _id: string; status: string; expiresAt: string; downloadCount: number; maxDownloads?: number | null; fileId?: { displayName: string } };
export default function SharedPage() {
  const [shares, setShares] = useState<Share[]>([]);
  const [error, setError] = useState('');
  const reload = () => void api<{ shares: Share[] }>('/shares').then((data) => setShares(data.shares)).catch((reason: Error) => setError(reason.message));
  useEffect(reload, []);
  const revoke = async (id: string) => { try { await api(`/shares/${id}/revoke`, { method: 'POST' }); reload(); } catch (reason) { setError((reason as Error).message); } };
  return <><header className="page-header"><div><p className="eyebrow">Controlled access</p><h1 className="page-title">Shared links</h1><p className="page-subtitle">Review and revoke links you have created.</p></div></header>{error && <div role="alert" className="notice error">{error}</div>}<section className="panel">{shares.length === 0 ? <div className="empty-state"><strong>No secure links yet</strong><p>Create a link from a file in My Vault.</p></div> : <div className="data-panel"><table className="file-table"><thead><tr><th>File</th><th>Status</th><th>Downloads</th><th>Expires</th><th /></tr></thead><tbody>{shares.map((share) => <tr key={share._id}><td>{share.fileId?.displayName ?? 'Shared file'}</td><td>{share.status}</td><td>{share.downloadCount}{share.maxDownloads ? ` / ${share.maxDownloads}` : ''}</td><td>{relativeTime(share.expiresAt)}</td><td><button className="button danger" onClick={() => void revoke(share._id)}>Revoke</button></td></tr>)}</tbody></table></div>}</section></>;
}
