export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface ApiFailure { success: false; error: { code: string; message: string; requestId: string } }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init.headers }
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json() as { success: true; data: T } | ApiFailure;
  if (!response.ok || !body.success) {
    const failure = body as ApiFailure;
    const error = new Error(failure.error?.message ?? 'The request failed.') as Error & { code?: string; requestId?: string };
    error.code = failure.error?.code;
    error.requestId = failure.error?.requestId;
    throw error;
  }
  return body.data;
}

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
};

export const relativeTime = (date: string): string => {
  const seconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
};
