'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Organization = { _id: string; name: string };
type Invitation = { _id: string; role: string; organizationId?: Organization };
export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const reload = () => void Promise.all([api<{ organizations: Array<{ organizationId: Organization }> }>('/organizations'), api<{ invitations: Invitation[] }>('/organizations/invitations')]).then(([orgs, invites]) => { setOrganizations(orgs.organizations.map((item) => item.organizationId)); setInvitations(invites.invitations); }).catch((reason: Error) => setError(reason.message));
  useEffect(reload, []);
  const create = async (event: React.FormEvent) => { event.preventDefault(); try { await api('/organizations', { method: 'POST', body: JSON.stringify({ name }) }); setName(''); setMessage('Organization created.'); reload(); } catch (reason) { setError((reason as Error).message); } };
  const accept = async (id: string) => { try { await api(`/organizations/invitations/${id}/accept`, { method: 'POST' }); setMessage('Invitation accepted.'); reload(); } catch (reason) { setError((reason as Error).message); } };
  return <><header className="page-header"><div><p className="eyebrow">Team workspaces</p><h1 className="page-title">Organizations</h1><p className="page-subtitle">Private workspaces with explicit role-based access.</p></div></header>{error && <div className="notice error" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}<section className="panel"><h2>Create an organization</h2><form className="folder-create" onSubmit={create}><input aria-label="Organization name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={100} /><button className="button primary">Create</button></form></section>{invitations.length > 0 && <section className="panel"><h2>Pending invitations</h2>{invitations.map((invite) => <div className="setting-row" key={invite._id}><span>{invite.organizationId?.name ?? 'Organization'} · {invite.role}</span><button className="button primary" onClick={() => void accept(invite._id)}>Accept</button></div>)}</section>}<section className="panel"><h2>Your organizations</h2>{organizations.length === 0 ? <div className="empty-state"><p>No organization memberships yet.</p></div> : organizations.map((organization) => <div className="setting-row" key={organization._id}><strong>{organization.name}</strong><span>Workspace</span></div>)}</section></>;
}
