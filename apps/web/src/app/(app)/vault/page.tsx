'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileKey2, Files, Folder, Grid2X2, List, MoreHorizontal, Plus, Search, Share2, Trash2, Upload, Download, X } from 'lucide-react';
import { api, formatBytes, relativeTime } from '@/lib/api';

type FileEntry = { _id: string; displayName: string; mimeType: string; size: number; securityStatus: string; createdAt: string };
type FolderEntry = { _id: string; name: string; parentId?: string | null };

export default function VaultPage() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [selectedFile, setSelectedFile] = useState<FileEntry>();
  const [shareForm, setShareForm] = useState({ password: '', maxDownloads: '', email: '', requireAuthentication: true, oneTime: false });
  const [shareUrl, setShareUrl] = useState('');
  const [rename, setRename] = useState<{ id: string; name: string }>();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ folderId: folderId ?? 'root' });
      if (search.trim()) params.set('search', search.trim());
      const [fileData, folderData] = await Promise.all([
        api<{ files: FileEntry[] }>(`/files?${params}`),
        api<{ folders: FolderEntry[] }>(`/folders?parentId=${encodeURIComponent(folderId ?? 'root')}`)
      ]);
      setFiles(fileData.files);
      setFolders(folderData.folders);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, [folderId, search]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('upload') === '1') document.getElementById('vault-upload')?.click();
    const requestedFile = query.get('file');
    if (requestedFile) void api<{ file: FileEntry }>(`/files/${encodeURIComponent(requestedFile)}`).then((result) => setSelectedFile(result.file)).catch((reason: Error) => setError(reason.message));
  }, []);

  const currentFolder = useMemo(() => folders.find((folder) => folder._id === folderId), [folderId, folders]);
  const upload = async (selected: FileList | null) => {
    const file = selected?.[0];
    if (!file) return;
    setUploading(true); setMessage(''); setError('');
    try {
      const body = new FormData(); body.append('file', file); if (folderId) body.append('folderId', folderId);
      const result = await api<{ file: FileEntry }>('/files/upload', { method: 'POST', body });
      setMessage(`${result.file.displayName} uploaded and queued for malware scanning.`);
      await load();
    } catch (reason) { setError((reason as Error).message); } finally { setUploading(false); }
  };
  const createFolder = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setMessage('');
    try {
      await api('/folders', { method: 'POST', body: JSON.stringify({ name: folderName, parentId: folderId }) });
      setFolderName(''); setMessage('Folder created.'); await load();
    } catch (reason) { setError((reason as Error).message); }
  };
  const download = async (file: FileEntry) => {
    setError('');
    try {
      const result = await api<{ url: string }>(`/files/${file._id}/download`, { method: 'POST' });
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (reason) { setError((reason as Error).message); }
  };
  const trash = async (file: FileEntry) => {
    if (!confirm(`Move "${file.displayName}" to Trash?`)) return;
    try { await api(`/files/${file._id}`, { method: 'DELETE' }); setMessage('File moved to Trash.'); await load(); }
    catch (reason) { setError((reason as Error).message); }
  };
  const saveRename = async (event: React.FormEvent) => {
    event.preventDefault(); if (!rename) return;
    try { await api(`/files/${rename.id}`, { method: 'PATCH', body: JSON.stringify({ displayName: rename.name }) }); setRename(undefined); setMessage('File renamed.'); await load(); }
    catch (reason) { setError((reason as Error).message); }
  };
  const createShare = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selectedFile) return;
    try {
      const result = await api<{ url: string }>('/shares', { method: 'POST', body: JSON.stringify({
        fileId: selectedFile._id, expiresInHours: 24, password: shareForm.password || undefined,
        maxDownloads: shareForm.maxDownloads ? Number(shareForm.maxDownloads) : undefined,
        recipientEmail: shareForm.email || undefined, requireAuthentication: shareForm.requireAuthentication, oneTime: shareForm.oneTime
      }) });
      setShareUrl(result.url); setMessage('Secure share created.');
    } catch (reason) { setError((reason as Error).message); }
  };

  return <>
    <header className="page-header"><div><p className="eyebrow">Private storage</p><h1 className="page-title">My Vault</h1><p className="page-subtitle">Files stay private until you choose to share them.</p></div><div className="button-row"><label className="button primary" htmlFor="vault-upload"><Upload size={15} />{uploading ? 'Uploading…' : 'Upload file'}</label><input id="vault-upload" className="visually-hidden" type="file" onChange={(event) => { void upload(event.target.files); event.target.value = ''; }} /></div></header>
    {error && <div className="notice error" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    <div className="toolbar"><div className="toolbar-left"><label className="local-search"><Search size={15} /><input aria-label="Search files" placeholder="Search your files…" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div><div className="toolbar-right"><form className="folder-create" onSubmit={createFolder}><input aria-label="New folder name" placeholder="New folder name" value={folderName} onChange={(event) => setFolderName(event.target.value)} required /><button className="button" aria-label="Create folder"><Plus size={14} />Folder</button></form><div className="segmented"><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="List view"><List size={15} /></button><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Grid view"><Grid2X2 size={15} /></button></div></div></div>
    <div className="breadcrumbs"><button onClick={() => setFolderId(null)}>My Vault</button>{currentFolder && <><span>/</span><strong>{currentFolder.name}</strong></>}</div>
    {loading ? <div className="skeleton" aria-label="Loading files" /> : <>
      {folders.length > 0 && <section className="folder-strip" aria-label="Folders">{folders.map((folder) => <button key={folder._id} className="folder-card" onClick={() => setFolderId(folder._id)}><Folder size={20} /><span><strong>{folder.name}</strong><small>Open folder</small></span></button>)}</section>}
      {files.length === 0 && folders.length === 0 ? <div className="panel empty-state"><span className="empty-icon"><Files size={23} /></span><strong>{search ? 'No matching files' : 'This folder is empty'}</strong><p>{search ? 'Try another search term.' : 'Upload your first file or create a folder to organize your vault.'}</p></div> :
      view === 'grid' ? <section className="file-grid">{files.map((file) => <article className="file-card" key={file._id}><span className="file-icon"><Files size={19} /></span><strong>{file.displayName}</strong><small>{formatBytes(file.size)} · {relativeTime(file.createdAt)}</small><div className="file-card-footer"><span className={`status-pill ${file.securityStatus === 'CLEAN' ? '' : 'amber'}`}>{file.securityStatus.replaceAll('_', ' ')}</span><div className="table-actions"><button className="icon-button" onClick={() => setSelectedFile(file)} aria-label={`Share ${file.displayName}`}><Share2 size={14} /></button><button className="icon-button" onClick={() => void download(file)} aria-label={`Download ${file.displayName}`}><Download size={14} /></button></div></div></article>)}</section> :
      <div className="data-panel"><table className="file-table"><thead><tr><th>Name</th><th>Security</th><th>Size</th><th>Modified</th><th /></tr></thead><tbody>{files.map((file) => <tr key={file._id}><td><span className="file-name-cell"><span className="file-icon"><Files size={16} /></span><span><strong>{file.displayName}</strong><small>{file.mimeType}</small></span></span></td><td><span className={`status-pill ${file.securityStatus === 'CLEAN' ? '' : 'amber'}`}>{file.securityStatus.replaceAll('_', ' ')}</span></td><td>{formatBytes(file.size)}</td><td>{relativeTime(file.createdAt)}</td><td><div className="table-actions"><button className="icon-button" onClick={() => setSelectedFile(file)} aria-label={`Share ${file.displayName}`}><Share2 size={14} /></button><button className="icon-button" onClick={() => setRename({ id: file._id, name: file.displayName })} aria-label={`Rename ${file.displayName}`}><MoreHorizontal size={15} /></button><button className="icon-button" onClick={() => void download(file)} aria-label={`Download ${file.displayName}`}><Download size={14} /></button><button className="icon-button" onClick={() => void trash(file)} aria-label={`Move ${file.displayName} to trash`}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div>}
    </>}
    {selectedFile && <div className="modal-backdrop" role="presentation" onClick={() => { setSelectedFile(undefined); setShareUrl(''); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={(event) => event.stopPropagation()}><div className="modal-head"><div><h2 id="share-title">Share securely</h2><p>{selectedFile.displayName}</p></div><button className="icon-button" onClick={() => { setSelectedFile(undefined); setShareUrl(''); }} aria-label="Close"><X size={17} /></button></div>{shareUrl ? <div className="share-result"><label className="field"><span>Private share link</span><input readOnly value={shareUrl} /></label><button className="button" onClick={() => void navigator.clipboard.writeText(shareUrl)}>Copy link</button></div> : <form onSubmit={createShare}><div className="field-grid"><label className="field"><span>Password (optional)</span><input type="password" autoComplete="new-password" value={shareForm.password} onChange={(event) => setShareForm({ ...shareForm, password: event.target.value })} /></label><label className="field"><span>Maximum downloads</span><input type="number" min="1" value={shareForm.maxDownloads} onChange={(event) => setShareForm({ ...shareForm, maxDownloads: event.target.value })} /></label><label className="field full"><span>Recipient email (optional)</span><input type="email" value={shareForm.email} onChange={(event) => setShareForm({ ...shareForm, email: event.target.value })} /></label><label className="check-row field full"><span>Require sign-in</span><input type="checkbox" checked={shareForm.requireAuthentication} onChange={(event) => setShareForm({ ...shareForm, requireAuthentication: event.target.checked })} /></label><label className="check-row field full"><span>One-time access</span><input type="checkbox" checked={shareForm.oneTime} onChange={(event) => setShareForm({ ...shareForm, oneTime: event.target.checked })} /></label></div><p className="page-subtitle">Link expires in 24 hours. File must pass malware scanning before sharing.</p><div className="modal-actions"><button className="button primary">Create secure link <FileKey2 size={14} /></button></div></form>}</section></div>}
    {rename && <div className="modal-backdrop"><form className="modal" onSubmit={saveRename}><div className="modal-head"><h2>Rename file</h2><button type="button" className="icon-button" onClick={() => setRename(undefined)} aria-label="Close"><X size={16} /></button></div><label className="field"><span>File name</span><input value={rename.name} onChange={(event) => setRename({ ...rename, name: event.target.value })} required /></label><div className="modal-actions"><button className="button primary">Save name</button></div></form></div>}
  </>;
}
