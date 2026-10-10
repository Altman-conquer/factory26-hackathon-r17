import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api';

function PageError({ message }: { message: string }) {
  return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{message}</p>;
}

function RepositoryShell({ orgName, repoName, children }: { orgName: string; repoName: string; children: ReactNode }) {
  const [repository, setRepository] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient
      .get(`/repositories/${orgName}/${repoName}`)
      .then((response) => setRepository(response.data.repository))
      .catch((requestError) => setError(getErrorMessage(requestError)));
  }, [orgName, repoName]);

  if (error) {
    return <PageError message={error} />;
  }
  if (!repository) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <div className="border-b border-slate-200 bg-white pb-4">
        <h1 className="text-3xl font-bold text-slate-900">{repository.fullName}</h1>
        <p className="mt-2 text-slate-600">{repository.description}</p>
        <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">
          {repository.visibility} · updated {repository.updatedAt}
        </p>
        <nav className="mt-4 flex gap-4 text-sm font-medium">
          <Link className="text-blue-700 underline" to={`/organizations/${orgName}/repositories`}>
            Back to repositories
          </Link>
          {repository.canAdmin && (
            <Link className="text-blue-700 underline" to={`/repositories/${orgName}/${repoName}/settings`}>
              Settings
            </Link>
          )}
        </nav>
      </div>
      <div className="mt-6">{children}</div>
    </div>
  );
}

export function RepositoryOverviewPage() {
  const { orgName = '', repoName = '' } = useParams();
  return (
    <RepositoryShell orgName={orgName} repoName={repoName}>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-600">Repository overview</p>
      </section>
    </RepositoryShell>
  );
}

export function RepositorySettingsPage() {
  const { orgName = '', repoName = '' } = useParams();
  return (
    <RepositoryShell orgName={orgName} repoName={repoName}>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Settings</h2>
        <Link className="mt-4 inline-block text-blue-700 underline" to={`/repositories/${orgName}/${repoName}/access`}>
          Manage access
        </Link>
      </section>
    </RepositoryShell>
  );
}

type Grant = {
  id: number;
  role: string;
  accountId: number | null;
  accountUsername: string | null;
  teamId: number | null;
  teamName: string | null;
};

export function ManageAccessPage() {
  const { orgName = '', repoName = '' } = useParams();
  const [grants, setGrants] = useState<Grant[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedTeam, setSelectedTeam] = useState('');
  const [role, setRole] = useState('Read');
  const [draftRoles, setDraftRoles] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const response = await apiClient.get(`/repositories/${orgName}/${repoName}/access`);
    setGrants(response.data.grants);
    const nextRoles: Record<number, string> = {};
    for (const grant of response.data.grants) {
      nextRoles[grant.id] = grant.role;
    }
    setDraftRoles(nextRoles);
  }

  useEffect(() => {
    load().catch((requestError) => setError(getErrorMessage(requestError)));
    apiClient
      .get(`/organizations/${orgName}/teams`)
      .then((response) => setTeams(response.data.teams))
      .catch(() => setTeams([]));
  }, [orgName, repoName]);

  async function addGrant(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      await apiClient.post(`/repositories/${orgName}/${repoName}/access`, {
        teamName: selectedTeam,
        role,
      });
      setShowAdd(false);
      setSearch('');
      setSelectedTeam('');
      setRole('Read');
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  async function saveRole(grant: Grant) {
    setError('');
    setMessage('');
    try {
      await apiClient.patch(`/repositories/${orgName}/${repoName}/access/${grant.id}`, {
        role: draftRoles[grant.id],
      });
      setMessage(`Role updated for ${grant.teamName || grant.accountUsername}`);
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  const filteredTeams = teams.filter((team) => team.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <RepositoryShell orgName={orgName} repoName={repoName}>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Manage access</h2>
          <button type="button" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={() => setShowAdd((current) => !current)}>
            Add people or teams
          </button>
        </div>
        {showAdd && (
          <form className="mt-4 grid gap-3 rounded-md border border-slate-200 p-4 sm:grid-cols-[1fr_1fr_auto_auto]" onSubmit={addGrant}>
            <div>
              <label htmlFor="access-search" className="block text-sm font-medium text-slate-700">
                Search
              </label>
              <input id="access-search" type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <div>
              <label htmlFor="access-team" className="block text-sm font-medium text-slate-700">
                Team
              </label>
              <select id="access-team" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={selectedTeam} onChange={(event) => setSelectedTeam(event.target.value)}>
                <option value="">Select a team</option>
                {filteredTeams.map((team) => (
                  <option key={team.id} value={team.name}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="access-role" className="block text-sm font-medium text-slate-700">
                Role
              </label>
              <select id="access-role" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={role} onChange={(event) => setRole(event.target.value)}>
                <option>Read</option>
                <option>Triage</option>
                <option>Write</option>
                <option>Maintain</option>
                <option>Admin</option>
              </select>
            </div>
            <div className="flex items-end">
              <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                Add
              </button>
            </div>
          </form>
        )}
        {error && <div className="mt-3"><PageError message={error} /></div>}
        {message && <p className="mt-3 text-sm font-semibold text-green-700">{message}</p>}
        <table className="mt-5 w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-4 font-semibold">Team or person</th>
              <th className="py-2 pr-4 font-semibold">Role</th>
              <th className="py-2 font-semibold">Save</th>
            </tr>
          </thead>
          <tbody>
            {grants.map((grant) => {
              const label = grant.teamName || grant.accountUsername || 'Unknown';
              return (
                <tr key={grant.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4">{label}</td>
                  <td className="py-2 pr-4">
                    <select
                      aria-label={`Role for ${label}`}
                      className="rounded-md border border-slate-300 px-2 py-1"
                      value={draftRoles[grant.id] || grant.role}
                      onChange={(event) => setDraftRoles((current) => ({ ...current, [grant.id]: event.target.value }))}
                    >
                      <option>Read</option>
                      <option>Triage</option>
                      <option>Write</option>
                      <option>Maintain</option>
                      <option>Admin</option>
                    </select>
                  </td>
                  <td className="py-2">
                    <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" onClick={() => saveRole(grant)}>
                      Save
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {grants.length === 0 && <p className="mt-4 text-slate-500">No direct access grants.</p>}
      </section>
    </RepositoryShell>
  );
}
