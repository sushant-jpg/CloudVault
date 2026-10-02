'use client';

import { useEffect, useState } from 'react';
import { api, formatBytes, relativeTime } from '@/lib/api';
type TrashedFile = { _id: string; displayName: string; size: number; deletedAt?: string };
export default function TrashPage() {
  const [files, setFiles] = useState<TrashedFile[]>([]);
  const [error, setError] = useState('');
  const reload = () => void api<{ files: TrashedFile[] }>('/files?trashed=true').then((data) => setFiles(data.files)).catch((reason: Error) => setError(reason.message));
  useEffect(reload, []);
  const restore = async (id: string) => { try { await api(`/files/${id}/restore`, { method: 'POST' }); reload(); } catch (reason) { setError((reason as Error).message); } };
  return <><header className="page-header"><div><p className="eyebrow">Recoverable files</p><h1 className="page-title">Trash</h1><p className="page-subtitle">Deleted files are retained according to your workspace policy.</p></div></header>{error && <div className="notice error" role="alert">{error}</div>}<section className="panel">{files.length === 0 ? <div className="empty-state"><p>Trash is empty.</p></div> : <div className="data-panel"><table className="file-table"><thead><tr><th>File</th><th>Size</th><th>Deleted</th><th /></tr></thead><tbody>{files.map((file) => <tr key={file._id}><td>{file.displayName}</td><td>{formatBytes(file.size)}</td><td>{file.deletedAt ? relativeTime(file.deletedAt) : 'Recently'}</td><td><button className="button" onClick={() => void restore(file._id)}>Restore</button></td></tr>)}</tbody></table></div>}</section></>;
}
