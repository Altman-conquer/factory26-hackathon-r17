import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api';

function PageError({ message }: { message: string }) {
  return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{message}</p>;
}

export function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient
      .get('/organizations')
      .then((response) => setOrganizations(response.data.organizations))
      .catch((requestError) => setError(getErrorMessage(requestError)));
  }, []);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your organizations</h1>
        <Link className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white" to="/organizations/new">
          New organization
        </Link>
      </div>
      {error && <div className="mt-4"><PageError message={error} /></div>}
      <ul className="mt-5 space-y-2">
        {organizations.map((organization) => (
          <li key={organization.id}>
            <Link className="font-medium text-blue-700 underline" to={`/organizations/${organization.name}`}>
              {organization.displayName}
            </Link>
            <span className="ml-2 text-sm text-slate-500">({organization.name})</span>
          </li>
        ))}
      </ul>
      {organizations.length === 0 && !error && <p className="mt-4 text-slate-500">No organizations yet.</p>}
    </section>
  );
}

export function NewOrganizationPage() {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      const response = await apiClient.post('/organizations', { name, displayName });
      navigate(`/organizations/${response.data.organization.name}`);
    } catch (requestError: any) {
      const fieldErrors = requestError?.response?.data?.errors || {};
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
      } else {
        setErrors({ form: getErrorMessage(requestError) });
      }
    }
  }

  return (
    <section className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">New organization</h1>
      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="org-name" className="block text-sm font-medium text-slate-700">
            Organization name
          </label>
          <input id="org-name" type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} />
          {errors.name && <p className="mt-1 text-sm text-red-700">{errors.name}</p>}
        </div>
        <div>
          <label htmlFor="org-display-name" className="block text-sm font-medium text-slate-700">
            Display name
          </label>
          <input id="org-display-name" type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          {errors.displayName && <p className="mt-1 text-sm text-red-700">{errors.displayName}</p>}
          {errors.form && <p className="mt-1 text-sm text-red-700">{errors.form}</p>}
        </div>
        <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white" type="submit">
          Create organization
        </button>
      </form>
    </section>
  );
}

function OrganizationShell({ orgName, children }: { orgName: string; children: ReactNode }) {
  const [organization, setOrganization] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient
      .get(`/organizations/${orgName}`)
      .then((response) => setOrganization(response.data.organization))
      .catch((requestError) => setError(getErrorMessage(requestError)));
  }, [orgName]);

  if (error) {
    return <PageError message={error} />;
  }
  if (!organization) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <div className="border-b border-slate-200 bg-white pb-4">
        <h1 className="text-3xl font-bold text-slate-900">
          {organization.displayName} <span className="text-lg font-normal text-slate-500">({organization.name})</span>
        </h1>
        <nav className="mt-4 flex flex-wrap gap-4 text-sm font-medium">
          <Link className="text-blue-700 underline" to={`/organizations/${orgName}/repositories`}>
            Repositories
          </Link>
          <Link className="text-blue-700 underline" to={`/organizations/${orgName}/people`}>
            People
          </Link>
          <Link className="text-blue-700 underline" to={`/organizations/${orgName}/teams`}>
            Teams
          </Link>
          {organization.isOwner && (
            <Link className="text-blue-700 underline" to={`/organizations/${orgName}/audit`}>
              Audit log
            </Link>
          )}
        </nav>
      </div>
      <div className="mt-6">{children}</div>
    </div>
  );
}

export function OrganizationOverviewPage() {
  const { orgName = '' } = useParams();
  return (
    <OrganizationShell orgName={orgName}>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-600">This organization page lists its repositories, people, and teams.</p>
      </div>
    </OrganizationShell>
  );
}

export function OrganizationRepositoriesPage() {
  const { orgName = '' } = useParams();
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState('all');
  const [repositories, setRepositories] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      apiClient
        .get(`/organizations/${orgName}/repositories`, {
          params: { q: query, visibility },
          signal: controller.signal,
        })
        .then((response) => setRepositories(response.data.repositories))
        .catch((requestError) => {
          if (!controller.signal.aborted) {
            setError(getErrorMessage(requestError));
          }
        });
    }, 150);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [orgName, query, visibility]);

  return (
    <OrganizationShell orgName={orgName}>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Repositories</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="find-repository" className="block text-sm font-medium text-slate-700">
              Find a repository
            </label>
            <input
              id="find-repository"
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="repo-visibility" className="block text-sm font-medium text-slate-700">
              Visibility
            </label>
            <select
              id="repo-visibility"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value)}
            >
              <option value="all">All</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </div>
        </div>
        {error && <div className="mt-4"><PageError message={error} /></div>}
        <ul className="mt-5 divide-y divide-slate-100">
          {repositories.map((repository) => (
            <li key={repository.id} className="py-3">
              <Link className="font-medium text-blue-700 underline" to={`/repositories/${orgName}/${repository.name}`}>
                {repository.name}
              </Link>
              <p className="text-sm text-slate-500">{repository.description}</p>
              <p className="text-xs uppercase tracking-wide text-slate-400">
                {repository.visibility} · updated {repository.updatedAt}
              </p>
            </li>
          ))}
        </ul>
        {repositories.length === 0 && <p className="mt-4 text-slate-500">No repositories found.</p>}
      </section>
    </OrganizationShell>
  );
}

type Member = { id: number; username: string; email: string; role: string };

export function PeoplePage() {
  const { orgName = '' } = useParams();
  const [members, setMembers] = useState<Member[]>([]);
  const [organization, setOrganization] = useState<any>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [role, setRole] = useState('Member');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);

  async function load() {
    const [organizationResponse, peopleResponse] = await Promise.all([
      apiClient.get(`/organizations/${orgName}`),
      apiClient.get(`/organizations/${orgName}/people`),
    ]);
    setOrganization(organizationResponse.data.organization);
    setMembers(peopleResponse.data.members);
  }

  useEffect(() => {
    load().catch((requestError) => setError(getErrorMessage(requestError)));
  }, [orgName]);

  async function addMember(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      await apiClient.post(`/organizations/${orgName}/people`, { identifier, role });
      setIdentifier('');
      setRole('Member');
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  async function removeMember() {
    if (!removeTarget) {
      return;
    }
    setError('');
    try {
      await apiClient.delete(`/organizations/${orgName}/people/${removeTarget.username}`);
      setRemoveTarget(null);
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  return (
    <OrganizationShell orgName={orgName}>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">People</h2>
          {organization?.isOwner && !showAdd && (
            <button type="button" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={() => setShowAdd(true)}>
              Add member
            </button>
          )}
        </div>
        {showAdd && (
          <form className="mt-4 grid gap-3 rounded-md border border-slate-200 p-4 sm:grid-cols-[1fr_auto_auto]" onSubmit={addMember}>
            <div>
              <label htmlFor="member-identifier" className="block text-sm font-medium text-slate-700">
                Username or email
              </label>
              <input id="member-identifier" type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
            </div>
            <div>
              <label htmlFor="member-role" className="block text-sm font-medium text-slate-700">
                Role
              </label>
              <select id="member-role" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={role} onChange={(event) => setRole(event.target.value)}>
                <option>Member</option>
                <option>Owner</option>
              </select>
            </div>
            <div className="flex items-end">
              <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                Add member
              </button>
            </div>
          </form>
        )}
        {message && <p className="mt-3 text-sm font-semibold text-green-700">{message}</p>}
        {error && <div className="mt-3"><PageError message={error} /></div>}
        <ul className="mt-5 divide-y divide-slate-100">
          {members.map((member) => (
            <li key={member.id} className="flex items-center justify-between py-3">
              <div>
                <span className="font-medium">{member.username}</span>
                <span className="ml-3 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{member.role}</span>
              </div>
              {organization?.isOwner && (
                <div className="relative">
                  <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" onClick={() => setMenuFor(menuFor === member.id ? null : member.id)}>
                    Member menu {member.username}
                  </button>
                  {menuFor === member.id && (
                    <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                      <button type="button" className="block w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50" onClick={() => { setRemoveTarget(member); setMenuFor(null); }}>
                        Remove from organization
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div role="dialog" aria-modal="true" aria-label="Remove member" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">Remove from organization</h3>
            <p className="mt-2 text-sm text-slate-600">Remove {removeTarget.username} from this organization?</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm" onClick={() => setRemoveTarget(null)}>
                Cancel
              </button>
              <button type="button" className="rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white" onClick={removeMember}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </OrganizationShell>
  );
}

export function TeamsPage() {
  const { orgName = '' } = useParams();
  const [teams, setTeams] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient
      .get(`/organizations/${orgName}/teams`)
      .then((response) => setTeams(response.data.teams))
      .catch((requestError) => setError(getErrorMessage(requestError)));
  }, [orgName]);

  return (
    <OrganizationShell orgName={orgName}>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Teams</h2>
          <Link className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white" to={`/organizations/${orgName}/teams/new`}>
            New team
          </Link>
        </div>
        {error && <div className="mt-4"><PageError message={error} /></div>}
        <ul className="mt-5 space-y-2">
          {teams.map((team) => (
            <li key={team.id}>
              <Link className="font-medium text-blue-700 underline" to={`/organizations/${orgName}/teams/${team.name}`}>
                {team.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </OrganizationShell>
  );
}

export function NewTeamPage() {
  const { orgName = '' } = useParams();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const response = await apiClient.post(`/organizations/${orgName}/teams`, { name });
      navigate(`/organizations/${orgName}/teams/${response.data.team.name}`);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  return (
    <OrganizationShell orgName={orgName}>
      <section className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">New team</h2>
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="team-name" className="block text-sm font-medium text-slate-700">
              Team name
            </label>
            <input id="team-name" type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          {error && <PageError message={error} />}
          <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white" type="submit">
            Create team
          </button>
        </form>
      </section>
    </OrganizationShell>
  );
}

function useTeam(orgName: string, teamName: string) {
  const [team, setTeam] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [possibleParents, setPossibleParents] = useState<any[]>([]);
  const [error, setError] = useState('');

  async function load() {
    const response = await apiClient.get(`/organizations/${orgName}/teams/${teamName}`);
    setTeam(response.data.team);
    setMembers(response.data.members);
    setPossibleParents(response.data.possibleParents);
  }

  useEffect(() => {
    load().catch((requestError) => setError(getErrorMessage(requestError)));
  }, [orgName, teamName]);

  return { team, members, possibleParents, error, load };
}

export function TeamOverviewPage() {
  const { orgName = '', teamName = '' } = useParams();
  const { team, error } = useTeam(orgName, teamName);

  if (error) {
    return <OrganizationShell orgName={orgName}><PageError message={error} /></OrganizationShell>;
  }
  if (!team) {
    return <OrganizationShell orgName={orgName}><p>Loading…</p></OrganizationShell>;
  }

  return (
    <OrganizationShell orgName={orgName}>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold">{team.name}</h2>
        <nav className="mt-4 flex gap-4 text-sm font-medium">
          <Link className="text-blue-700 underline" to={`/organizations/${orgName}/teams/${teamName}/members`}>
            Members
          </Link>
          <Link className="text-blue-700 underline" to={`/organizations/${orgName}/teams/${teamName}/settings`}>
            Settings
          </Link>
        </nav>
      </section>
    </OrganizationShell>
  );
}

export function TeamMembersPage() {
  const { orgName = '', teamName = '' } = useParams();
  const { team, members, error, load } = useTeam(orgName, teamName);
  const [showAdd, setShowAdd] = useState(false);
  const [username, setUsername] = useState('');
  const [actionError, setActionError] = useState('');

  async function addMember(event: FormEvent) {
    event.preventDefault();
    setActionError('');
    try {
      await apiClient.post(`/organizations/${orgName}/teams/${teamName}/members`, { username });
      setUsername('');
      setShowAdd(false);
      await load();
    } catch (requestError) {
      setActionError(getErrorMessage(requestError));
    }
  }

  async function removeMember(memberUsername: string) {
    setActionError('');
    try {
      await apiClient.delete(`/organizations/${orgName}/teams/${teamName}/members/${memberUsername}`);
      await load();
    } catch (requestError) {
      setActionError(getErrorMessage(requestError));
    }
  }

  if (error) {
    return <OrganizationShell orgName={orgName}><PageError message={error} /></OrganizationShell>;
  }
  if (!team) {
    return <OrganizationShell orgName={orgName}><p>Loading…</p></OrganizationShell>;
  }

  return (
    <OrganizationShell orgName={orgName}>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Members</h2>
          {!showAdd && (
            <button type="button" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={() => setShowAdd(true)}>
              Add member
            </button>
          )}
        </div>
        {showAdd && (
          <form className="mt-4 flex flex-col gap-3 rounded-md border border-slate-200 p-4 sm:flex-row sm:items-end" onSubmit={addMember}>
            <div className="flex-1">
              <label htmlFor="team-member-username" className="block text-sm font-medium text-slate-700">
                Username
              </label>
              <input id="team-member-username" type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={username} onChange={(event) => setUsername(event.target.value)} />
            </div>
            <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
              Add member
            </button>
          </form>
        )}
        {actionError && <div className="mt-3"><PageError message={actionError} /></div>}
        <ul className="mt-5 divide-y divide-slate-100">
          {members.map((member) => (
            <li key={member.id} className="flex items-center justify-between py-3">
              <span className="font-medium">{member.username}</span>
              <button type="button" className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700" onClick={() => removeMember(member.username)}>
                Remove {member.username}
              </button>
            </li>
          ))}
        </ul>
        {members.length === 0 && <p className="mt-4 text-slate-500">No team members.</p>}
      </section>
    </OrganizationShell>
  );
}

export function TeamSettingsPage() {
  const { orgName = '', teamName = '' } = useParams();
  const { team, possibleParents, error, load } = useTeam(orgName, teamName);
  const [parentTeamName, setParentTeamName] = useState('');
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (team) {
      setParentTeamName(team.parentTeam || '');
    }
  }, [team]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setActionError('');
    try {
      const response = await apiClient.patch(`/organizations/${orgName}/teams/${teamName}`, { parentTeamName });
      setMessage(`Parent team saved: ${response.data.parentTeam || 'None'}`);
      await load();
    } catch (requestError) {
      setActionError(getErrorMessage(requestError));
    }
  }

  if (error) {
    return <OrganizationShell orgName={orgName}><PageError message={error} /></OrganizationShell>;
  }
  if (!team) {
    return <OrganizationShell orgName={orgName}><p>Loading…</p></OrganizationShell>;
  }

  return (
    <OrganizationShell orgName={orgName}>
      <section className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Settings</h2>
        <form className="mt-5 space-y-4" onSubmit={save}>
          <div>
            <label htmlFor="parent-team" className="block text-sm font-medium text-slate-700">
              Parent team
            </label>
            <select id="parent-team" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={parentTeamName} onChange={(event) => setParentTeamName(event.target.value)}>
              <option value="">No parent</option>
              {possibleParents.map((parent) => (
                <option key={parent.id} value={parent.name}>
                  {parent.name}
                </option>
              ))}
            </select>
          </div>
          {actionError && <PageError message={actionError} />}
          {message && <p className="text-sm font-semibold text-green-700">{message}</p>}
          <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white" type="submit">
            Save
          </button>
        </form>
      </section>
    </OrganizationShell>
  );
}

export function AuditLogPage() {
  const { orgName = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const action = searchParams.get('action') || '';
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState('');
  const actions = useMemo(() => ['Member added', 'Repository created', 'Member removed', 'Team created', 'Organization created'], []);

  useEffect(() => {
    apiClient
      .get(`/organizations/${orgName}/audit`, { params: action ? { action } : {} })
      .then((response) => setEvents(response.data.events))
      .catch((requestError) => setError(getErrorMessage(requestError)));
  }, [orgName, action]);

  if (error) {
    return <OrganizationShell orgName={orgName}><PageError message={error} /></OrganizationShell>;
  }

  return (
    <OrganizationShell orgName={orgName}>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold">Audit log</h2>
        <div className="mt-4 max-w-sm">
          <label htmlFor="filter-action" className="block text-sm font-medium text-slate-700">
            Filter action
          </label>
          <select
            id="filter-action"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={action}
            onChange={(event) => {
              const next = event.target.value;
              setSearchParams(next ? { action: next } : {});
            }}
          >
            <option value="">All actions</option>
            {actions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <table className="mt-5 w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-4 font-semibold">Actor</th>
              <th className="py-2 pr-4 font-semibold">Action</th>
              <th className="py-2 pr-4 font-semibold">Target</th>
              <th className="py-2 font-semibold">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b border-slate-100">
                <td className="py-2 pr-4">{event.actor}</td>
                <td className="py-2 pr-4">{event.action}</td>
                <td className="py-2 pr-4">{event.target}</td>
                <td className="py-2">{event.timestamp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </OrganizationShell>
  );
}
