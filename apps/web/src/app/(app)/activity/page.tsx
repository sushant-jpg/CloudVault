'use client';

import { useEffect, useState } from 'react';
import { api, relativeTime } from '@/lib/api';
type Event = { _id: string; action: string; resourceType: string; createdAt: string };
export default function ActivityPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { void api<{ events: Event[] }>('/audit?limit=100').then((data) => setEvents(data.events)).catch((reason: Error) => setError(reason.message)); }, []);
  return <><header className="page-header"><div><p className="eyebrow">Account history</p><h1 className="page-title">Activity</h1><p className="page-subtitle">A record of security-relevant activity in your account and workspaces.</p></div></header>{error && <div className="notice error" role="alert">{error}</div>}<section className="panel">{events.length === 0 ? <div className="empty-state"><p>No activity has been recorded yet.</p></div> : <div className="activity-list">{events.map((event) => <div className="activity-row" key={event._id}><span className="activity-line" /><span><strong>{event.action.replaceAll('_', ' ')}</strong><small>{event.resourceType}</small></span><small>{relativeTime(event.createdAt)}</small></div>)}</div>}</section></>;
}
