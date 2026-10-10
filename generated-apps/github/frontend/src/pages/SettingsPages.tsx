import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import apiClient, { getFieldErrors, getErrorMessage } from '../api';
import { useAuth } from '../context/AuthContext';

export function SettingsPage() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Link className="rounded-md border border-slate-200 p-4 font-medium text-blue-700" to="/settings/password">
          Password and authentication
        </Link>
        <Link className="rounded-md border border-slate-200 p-4 font-medium text-blue-700" to="/settings/sessions">
          Active sessions
        </Link>
      </div>
    </section>
  );
}

export function PasswordSettingsPage() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  function update(field: string, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage('');
    try {
      const response = await apiClient.post('/auth/password', form);
      setMessage(response.data.message);
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (requestError) {
      const fieldErrors = getFieldErrors(requestError);
      setErrors(fieldErrors);
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      if (Object.keys(fieldErrors).length === 0) {
        setErrors({ form: getErrorMessage(requestError) });
      }
    }
  }

  return (
    <section className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Password and authentication</h1>
      {message && <p className="mt-3 text-sm font-semibold text-green-700">{message}</p>}
      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="current-password" className="block text-sm font-medium text-slate-700">
            Current password
          </label>
          <input
            id="current-password"
            type="password"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.currentPassword}
            onChange={(event) => update('currentPassword', event.target.value)}
          />
          {errors.currentPassword && <p className="mt-1 text-sm text-red-700">{errors.currentPassword}</p>}
        </div>
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium text-slate-700">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.newPassword}
            onChange={(event) => update('newPassword', event.target.value)}
          />
          {errors.newPassword && <p className="mt-1 text-sm text-red-700">{errors.newPassword}</p>}
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700">
            Confirm password
          </label>
          <input
            id="confirm-password"
            type="password"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.confirmPassword}
            onChange={(event) => update('confirmPassword', event.target.value)}
          />
          {errors.confirmPassword && <p className="mt-1 text-sm text-red-700">{errors.confirmPassword}</p>}
        </div>
        {errors.form && <p className="text-sm text-red-700">{errors.form}</p>}
        <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white" type="submit">
          Update password
        </button>
      </form>
    </section>
  );
}

type SessionRow = {
  id: number;
  deviceLabel: string;
  lastActive: string;
  createdAt: string;
  isCurrent: boolean;
};

export function SessionsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      const response = await apiClient.get('/auth/sessions');
      setSessions(response.data.sessions);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function revoke(id: number) {
    setMessage('');
    setError('');
    try {
      const response = await apiClient.post(`/auth/sessions/${id}/revoke`);
      setMessage(response.data.message);
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Active sessions</h1>
      {message && <p className="mt-3 text-sm font-semibold text-green-700">{message}</p>}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-5 space-y-3">
        {sessions.map((session) => (
          <div key={session.id} className="flex flex-col gap-3 rounded-md border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-slate-900">
                {session.deviceLabel} {session.isCurrent && <span className="ml-2 rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">Current session</span>}
              </p>
              <p className="text-sm text-slate-500">Last active: {session.lastActive}</p>
            </div>
            {!session.isCurrent && (
              <button
                type="button"
                className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700"
                onClick={() => revoke(session.id)}
              >
                Revoke session
              </button>
            )}
          </div>
        ))}
        {sessions.length === 0 && <p className="text-slate-500">No active sessions.</p>}
      </div>
    </section>
  );
}
