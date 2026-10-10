import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import apiClient, { getErrorMessage, getFieldErrors } from '../api';
import { useAuth } from '../context/AuthContext';

function ErrorMessage({ message }: { message: string }) {
  if (!message) return null;
  return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{message}</p>;
}

function useRepository(orgName: string, repoName: string) {
  const [repository, setRepository] = useState<any>(null);
  const [error, setError] = useState('');
  async function load() {
    setError('');
    try {
      const response = await apiClient.get(`/repository-details/${orgName}/${repoName}`);
      setRepository(response.data.repository);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }
  useEffect(() => {
    void load();
  }, [orgName, repoName]);
  return { repository, setRepository, error, reload: load };
}

function CloneButton({ repository }: { repository: any }) {
  const [open, setOpen] = useState(false);
  const [protocol, setProtocol] = useState<'HTTPS' | 'SSH'>('HTTPS');
  const [copied, setCopied] = useState(false);
  const value = protocol === 'HTTPS' ? repository.cloneHttps : repository.cloneSsh;

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium"
        onClick={() => setOpen((current) => !current)}
      >
        Code
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-md border border-slate-200 bg-white p-3 shadow-lg">
          <div className="flex gap-2">
            {(['HTTPS', 'SSH'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={protocol === tab}
                className={`rounded px-2 py-1 text-sm ${protocol === tab ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}
                onClick={() => setProtocol(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input readOnly value={value} className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs" />
            <button type="button" className="rounded bg-slate-900 px-3 py-1 text-sm text-white" onClick={copyValue}>
              Copy
            </button>
          </div>
          {copied && <p className="mt-2 text-sm font-semibold text-green-700">Copied</p>}
        </div>
      )}
    </div>
  );
}

export function RepositoryShell({ children }: { children: ReactNode }) {
  const { orgName = '', repoName = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { account } = useAuth();
  const { repository, error } = useRepository(orgName, repoName);
  const [readme, setReadme] = useState<any>(null);

  useEffect(() => {
    if (!repository) return;
    apiClient
      .get(`/repository-details/${orgName}/${repoName}/tree`, { params: { branch: repository.defaultBranch } })
      .then((response) => {
        const file = (response.data.entries || []).find((entry: any) => entry.type === 'file' && entry.name === 'README.md');
        if (file) setReadme(file);
      })
      .catch(() => setReadme(null));
  }, [repository, orgName, repoName]);

  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;

  const marker = repository.archived ? 'Archived' : repository.visibility === 'public' ? 'Public' : 'Private';
  return (
    <div>
      <div className="border-b border-slate-200 bg-white pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">{repository.fullName}</h1>
            <p className="mt-2 text-slate-600">
              Owner: {repository.ownerDisplayName || repository.owner} · Repository: {repository.name}
            </p>
            <p className="mt-1 text-slate-600">{repository.description}</p>
            <p className="mt-2 flex gap-2 text-xs uppercase tracking-wide text-slate-500">
              <span className="rounded bg-slate-100 px-2 py-1">{marker}</span>
              <span className="rounded bg-slate-100 px-2 py-1">Default branch: {repository.defaultBranch}</span>
            </p>
            {repository.sourceFullName && (
              <p className="mt-2 text-sm text-slate-600">
                Forked from{' '}
                <Link className="text-blue-700 underline" to={`/repositories/${repository.sourceFullName.split('/')[0]}/${repository.sourceFullName.split('/')[1]}`}>
                  {repository.sourceName}
                </Link>
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CloneButton repository={repository} />
            {account && !repository.archived && (
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium"
                onClick={() => navigate(`/repositories/${orgName}/${repoName}/fork`)}
              >
                Fork
              </button>
            )}
          </div>
        </div>
        <nav className="mt-4 flex flex-wrap gap-4 text-sm font-medium">
          <Link className="text-blue-700 underline" to={`/organizations/${orgName}/repositories`}>
            Back to repositories
          </Link>
          <Link
            className="text-blue-700 underline"
            to={location.pathname.endsWith('/search') ? `${location.pathname}${location.search}` : `/repositories/${orgName}/${repoName}/code`}
          >
            Code
          </Link>
          <Link className="text-blue-700 underline" to={`/repositories/${orgName}/${repoName}/issues`}>
            Issues
          </Link>
          <Link className="text-blue-700 underline" to={`/repositories/${orgName}/${repoName}/pulls`}>
            Pull requests
          </Link>
          <Link className="text-blue-700 underline" to={`/repositories/${orgName}/${repoName}/commits`}>
            Commits
          </Link>
          <Link className="text-blue-700 underline" to={`/repositories/${orgName}/${repoName}/releases`}>
            Releases
          </Link>
          {repository.canAdmin && (
            <Link className="text-blue-700 underline" to={`/repositories/${orgName}/${repoName}/settings`}>
              Settings
            </Link>
          )}
        </nav>
      </div>
      <div className="mt-6">
        {readme && (
          <p className="mb-4 text-sm">
            <Link
              className="text-blue-700 underline"
              to={`/repositories/${orgName}/${repoName}/blob/${encodeURIComponent(repository.defaultBranch)}/${readme.path}`}
            >
              README.md
            </Link>
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

export function SearchPage() {
  const [params] = useSearchParams();
  const query = params.get('q') || '';
  const [repositories, setRepositories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get('/search', { params: { q: query } })
      .then((response) => setRepositories(response.data.repositories))
      .catch(() => setRepositories([]))
      .finally(() => setLoading(false));
  }, [query]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Search results</h1>
      <p className="mt-1 text-sm text-slate-500">Query: {query}</p>
      {loading && <p className="mt-4">Loading…</p>}
      {!loading && repositories.length === 0 && <p className="mt-4 text-slate-600">No results</p>}
      <ul className="mt-4 space-y-3">
        {repositories.map((repository) => (
          <li key={repository.id} className="rounded border border-slate-200 p-3">
            <Link
              className="font-semibold text-blue-700 underline"
              to={`/repositories/${repository.owner}/${repository.name}`}
            >
              {repository.name}
            </Link>
            <p className="text-sm text-slate-500">
              {repository.owner}/{repository.name} · {repository.visibility}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RepositoriesPage() {
  const [repositories, setRepositories] = useState<any[]>([]);
  useEffect(() => {
    apiClient.get('/repositories').then((response) => setRepositories(response.data.repositories)).catch(() => setRepositories([]));
  }, []);
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Repositories</h1>
        <Link className="text-blue-700 underline" to="/repositories/new">New repository</Link>
      </div>
      <ul className="mt-4 space-y-2">
        {repositories.map((repository) => (
          <li key={repository.id}>
            <Link className="font-medium text-blue-700 underline" to={`/repositories/${repository.owner}/${repository.name}`}>
              {repository.fullName}
            </Link>
            <span className="ml-2 text-sm text-slate-500">{repository.visibility}</span>
          </li>
        ))}
      </ul>
      {repositories.length === 0 && <p className="mt-4 text-slate-500">No repositories.</p>}
    </section>
  );
}

export function UserRepositoriesPage() {
  const { username = '' } = useParams();
  const [repositories, setRepositories] = useState<any[]>([]);
  useEffect(() => {
    apiClient
      .get(`/users/${username}/repositories`)
      .then((response) => setRepositories(response.data.repositories))
      .catch(() => setRepositories([]));
  }, [username]);
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">{username} repositories</h1>
      <ul className="mt-4 space-y-2">
        {repositories.map((repository) => (
          <li key={repository.id}>
            <Link className="font-medium text-blue-700 underline" to={`/repositories/${repository.owner}/${repository.name}`}>
              {repository.name}
            </Link>
          </li>
        ))}
      </ul>
      {repositories.length === 0 && <p className="mt-4 text-slate-500">No repositories.</p>}
    </section>
  );
}

export function NewRepositoryPage() {
  const navigate = useNavigate();
  const { account } = useAuth();
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [owner, setOwner] = useState(account?.username || '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [addReadme, setAddReadme] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (account) setOwner((current) => current || account.username);
    apiClient
      .get('/organizations')
      .then((response) => setOrganizations(response.data.organizations))
      .catch(() => setOrganizations([]));
  }, [account]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage('');
    try {
      const response = await apiClient.post('/repositories', {
        owner,
        name,
        description,
        visibility,
        addReadme,
      });
      const repository = response.data.repository;
      navigate(`/repositories/${repository.owner}/${repository.name}`);
    } catch (requestError) {
      const fieldErrors = getFieldErrors(requestError);
      setErrors(fieldErrors);
      setMessage(Object.keys(fieldErrors).length > 0 ? '' : getErrorMessage(requestError, ''));
    }
  }

  return (
    <section className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">New repository</h1>
      <form className="mt-5 space-y-4" onSubmit={submit}>
        <div>
          <label htmlFor="new-repo-owner" className="block text-sm font-medium">Owner</label>
          <select id="new-repo-owner" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={owner} onChange={(event) => setOwner(event.target.value)}>
            {account && <option value={account.username}>{account.username}</option>}
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.name}>{organization.displayName}</option>
            ))}
          </select>
          {errors.owner && <p className="text-sm text-red-700">{errors.owner}</p>}
        </div>
        <div>
          <label htmlFor="new-repo-name" className="block text-sm font-medium">Repository name</label>
          <input id="new-repo-name" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} />
          {errors.name && <p className="text-sm text-red-700">{errors.name}</p>}
        </div>
        <div>
          <label htmlFor="new-repo-description" className="block text-sm font-medium">Description</label>
          <input id="new-repo-description" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Visibility</legend>
          <label className="mr-4 inline-flex items-center gap-2">
            <input type="radio" name="visibility" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> Public
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="visibility" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> Private
          </label>
        </fieldset>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={addReadme} onChange={(event) => setAddReadme(event.target.checked)} /> Add a README file
        </label>
        {message && <ErrorMessage message={message} />}
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 font-semibold text-white">Create repository</button>
      </form>
    </section>
  );
}

export function ForkRepositoryPage() {
  const { orgName = '', repoName = '' } = useParams();
  const navigate = useNavigate();
  const { account } = useAuth();
  const { repository, error } = useRepository(orgName, repoName);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [owner, setOwner] = useState(account?.username || '');
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (repository) {
      setName((current) => current || `${repository.name}-fork`);
      setVisibility(repository.visibility === 'private' ? 'private' : 'public');
    }
  }, [repository]);
  useEffect(() => {
    if (account) setOwner((current) => current || account.username);
    apiClient.get('/organizations').then((response) => setOrganizations(response.data.organizations)).catch(() => setOrganizations([]));
  }, [account]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage('');
    try {
      const response = await apiClient.post(`/repository-details/${orgName}/${repoName}/fork`, {
        owner,
        name,
        visibility,
      });
      const fork = response.data.repository;
      navigate(`/repositories/${fork.owner}/${fork.name}`);
    } catch (requestError) {
      const fieldErrors = getFieldErrors(requestError);
      setErrors(fieldErrors);
      setMessage(Object.keys(fieldErrors).length > 0 ? '' : getErrorMessage(requestError, ''));
    }
  }

  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;
  return (
    <section className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Create fork</h1>
      <form className="mt-5 space-y-4" onSubmit={submit}>
        <div>
          <label htmlFor="fork-owner" className="block text-sm font-medium">Owner</label>
          <select id="fork-owner" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={owner} onChange={(event) => setOwner(event.target.value)}>
            {account && <option value={account.username}>{account.username}</option>}
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.name}>{organization.displayName}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="fork-name" className="block text-sm font-medium">Repository name</label>
          <input id="fork-name" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} />
          {errors.name && <p className="text-sm text-red-700">{errors.name}</p>}
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Visibility</legend>
          <label className="mr-4 inline-flex items-center gap-2">
            <input type="radio" name="fork-visibility" checked={visibility === 'public'} disabled={repository.visibility === 'private'} onChange={() => setVisibility('public')} /> Public
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="fork-visibility" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> Private
          </label>
        </fieldset>
        {message && <ErrorMessage message={message} />}
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 font-semibold text-white">Create fork</button>
      </form>
    </section>
  );
}

export function RepositoryOverviewPage() {
  return (
    <RepositoryShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-600">Repository overview</p>
      </section>
    </RepositoryShell>
  );
}

function BranchSelector({
  repository,
  currentBranch,
  onSelect,
  onCreated,
}: {
  repository: any;
  currentBranch: string;
  onSelect: (branch: string) => void;
  onCreated: (branch: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    apiClient
      .get(`/repository-details/${repository.owner}/${repository.name}/branches`)
      .then((response) => setBranches(response.data.branches))
      .catch(() => setBranches([]));
  }, [open, repository.owner, repository.name]);

  const valid = /^[A-Za-z0-9._/-]+$/.test(filter) && filter.length >= 1 && filter.length <= 255 && !filter.endsWith('/') && !filter.endsWith('.') && !filter.includes('..') && !filter.includes('//');
  const existing = branches.includes(filter);
  const canCreate = repository.canWrite && !repository.archived && valid && !existing;
  const matching = branches.filter((branch) => branch.toLowerCase().includes(filter.toLowerCase()));
  const noMatch = filter.length > 0 && matching.length === 0 && !canCreate;

  async function createBranch() {
    setError('');
    try {
      const response = await apiClient.post(`/repository-details/${repository.owner}/${repository.name}/branches`, {
        name: filter,
        baseBranch: currentBranch,
      });
      setOpen(false);
      onCreated(response.data.branch.name);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium"
        onClick={() => {
          setOpen((current) => !current);
          setFilter('');
        }}
      >
        Branch {currentBranch}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-2 w-72 rounded-md border border-slate-200 bg-white p-3 shadow-lg">
          <input
            aria-label="Find branch"
            autoFocus
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
            }}
          />
          <div role="listbox" className="mt-2 max-h-60 overflow-auto">
            {matching.map((branch) => (
              <button
                key={branch}
                type="button"
                role="option"
                aria-selected={branch === currentBranch}
                className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-100"
                onClick={() => {
                  setOpen(false);
                  onSelect(branch);
                }}
              >
                {branch}
              </button>
            ))}
            {canCreate && (
              <button
                type="button"
                role="option"
                className="block w-full rounded px-2 py-1 text-left text-sm font-medium text-green-700 hover:bg-slate-100"
                onClick={createBranch}
              >
                Create branch: {filter}
              </button>
            )}
            {!valid && filter.length > 0 && <p className="px-2 py-1 text-sm text-red-700">Invalid branch</p>}
            {noMatch && <p className="px-2 py-1 text-sm text-slate-500">No matching branch</p>}
          </div>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function RepositoryCodePage() {
  const { orgName = '', repoName = '' } = useParams();
  const { repository, error } = useRepository(orgName, repoName);
  const [searchParams, setSearchParams] = useSearchParams();
  const branch = searchParams.get('branch') || repository?.defaultBranch || '';
  const path = searchParams.get('path') || '';
  const [entries, setEntries] = useState<any[]>([]);
  const [treeError, setTreeError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (repository && !searchParams.get('branch')) {
      const next = new URLSearchParams(searchParams);
      next.set('branch', repository.defaultBranch);
      setSearchParams(next, { replace: true });
    }
  }, [repository, searchParams, setSearchParams]);

  useEffect(() => {
    if (!repository || !branch) return;
    apiClient
      .get(`/repository-details/${orgName}/${repoName}/tree`, { params: { branch, path } })
      .then((response) => setEntries(response.data.entries))
      .catch((requestError) => setTreeError(getErrorMessage(requestError)));
  }, [repository, branch, path, orgName, repoName]);

  function chooseBranch(nextBranch: string) {
    const next = new URLSearchParams(searchParams);
    next.set('branch', nextBranch);
    next.delete('path');
    setSearchParams(next);
  }

  function chooseDirectory(nextPath: string) {
    const next = new URLSearchParams(searchParams);
    next.set('branch', branch);
    next.set('path', nextPath);
    setSearchParams(next);
  }

  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;
  return (
    <RepositoryShell>
      {repository.archived && <p className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-800">This repository is archived and read-only.</p>}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BranchSelector repository={repository} currentBranch={branch} onSelect={chooseBranch} onCreated={chooseBranch} />
            <span className="text-sm text-slate-500">Path: /{path}</span>
          </div>
          <div className="flex items-center gap-2">
            {repository.canWrite && !repository.archived && (
              <div className="relative">
                <button type="button" className="rounded border border-slate-300 px-3 py-1.5 text-sm" onClick={() => setAddOpen((current) => !current)}>
                  Add file
                </button>
                {addOpen && (
                  <div className="absolute right-0 z-20 mt-2 rounded border border-slate-200 bg-white p-2 shadow">
                    <Link className="whitespace-nowrap text-sm text-blue-700 underline" to={`/repositories/${orgName}/${repoName}/new-file?branch=${encodeURIComponent(branch)}`}>
                      Create new file
                    </Link>
                  </div>
                )}
              </div>
            )}
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const query = search.trim();
                window.location.assign(`/repositories/${orgName}/${repoName}/search?q=${encodeURIComponent(query)}&branch=${encodeURIComponent(branch)}`);
              }}
            >
              <input
                type="search"
                aria-label="Search"
                placeholder="Search code"
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button type="submit" className="rounded bg-slate-900 px-3 py-1 text-sm text-white">Search</button>
            </form>
          </div>
        </div>
        {path && (
          <button type="button" className="mt-4 text-sm text-blue-700 underline" onClick={() => chooseDirectory(path.split('/').slice(0, -1).join('/'))}>
            .. parent directory
          </button>
        )}
        {treeError && <div className="mt-4"><ErrorMessage message={treeError} /></div>}
        <ul className="mt-5 divide-y divide-slate-100">
          {entries.map((entry) => (
            <li key={entry.path} className="py-2">
              {entry.type === 'directory' ? (
                <Link
                  className="font-medium text-blue-700 underline"
                  to={`?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(entry.path)}`}
                >
                  {entry.name}
                </Link>
              ) : (
                <Link
                  className="font-medium text-blue-700 underline"
                  to={`/repositories/${orgName}/${repoName}/blob/${encodeURIComponent(branch)}/${entry.path.split('/').map(encodeURIComponent).join('/')}`}
                >
                  {entry.name}
                </Link>
              )}
            </li>
          ))}
        </ul>
        {entries.length === 0 && <p className="mt-4 text-slate-500">This directory is empty.</p>}
      </section>
    </RepositoryShell>
  );
}

export function NewFilePage() {
  const { orgName = '', repoName = '' } = useParams();
  const { repository, error } = useRepository(orgName, repoName);
  const [params] = useSearchParams();
  const branch = params.get('branch') || repository?.defaultBranch || '';
  const navigate = useNavigate();
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      await apiClient.post(`/repository-details/${orgName}/${repoName}/files`, {
        path,
        content,
        message,
        branch,
      });
      navigate(`/repositories/${orgName}/${repoName}/blob/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`);
    } catch (requestError) {
      setErrors(getFieldErrors(requestError));
    }
  }

  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Create new file</h1>
      <form className="mt-5 space-y-4" onSubmit={submit}>
        <div>
          <label htmlFor="file-name" className="block text-sm font-medium">File name</label>
          <input id="file-name" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={path} onChange={(event) => setPath(event.target.value)} />
          {errors.path && <p className="text-sm text-red-700">{errors.path}</p>}
        </div>
        <div>
          <label htmlFor="file-contents" className="block text-sm font-medium">File contents</label>
          <textarea id="file-contents" rows={8} className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm" value={content} onChange={(event) => setContent(event.target.value)} />
        </div>
        <div>
          <label htmlFor="commit-message" className="block text-sm font-medium">Commit message</label>
          <input id="commit-message" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={message} onChange={(event) => setMessage(event.target.value)} />
          {errors.message && <p className="text-sm text-red-700">{errors.message}</p>}
        </div>
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 font-semibold text-white">Commit changes</button>
      </form>
    </section>
  );
}

export function FilePage() {
  const { orgName = '', repoName = '', branch = '', '*' : filePath = '' } = useParams();
  const { repository, error } = useRepository(orgName, repoName);
  const [file, setFile] = useState<any>(null);
  const [fileError, setFileError] = useState('');

  useEffect(() => {
    if (!repository) return;
    apiClient
      .get(`/repository-details/${orgName}/${repoName}/file`, { params: { branch, path: filePath } })
      .then((response) => setFile(response.data.file))
      .catch((requestError) => setFileError(getErrorMessage(requestError)));
  }, [repository, orgName, repoName, branch, filePath]);

  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;
  if (fileError) return <ErrorMessage message={fileError} />;
  if (!file) return <p>Loading…</p>;
  return (
    <RepositoryShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{file.name}</h1>
        <p className="mt-1 text-sm text-slate-500">{repository.fullName} · {branch} · {file.path}</p>
        <pre className="mt-4 overflow-auto rounded bg-slate-50 p-4 text-sm">{file.content}</pre>
      </section>
    </RepositoryShell>
  );
}

export function CommitsPage() {
  const { orgName = '', repoName = '' } = useParams();
  const { repository, error } = useRepository(orgName, repoName);
  const [params] = useSearchParams();
  const branch = params.get('branch') || repository?.defaultBranch || '';
  const [commits, setCommits] = useState<any[]>([]);
  useEffect(() => {
    if (!repository || !branch) return;
    apiClient
      .get(`/repository-details/${orgName}/${repoName}/commits`, { params: { branch } })
      .then((response) => setCommits(response.data.commits))
      .catch(() => setCommits([]));
  }, [repository, orgName, repoName, branch]);
  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;
  return (
    <RepositoryShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Commits</h1>
        <ul className="mt-4 divide-y divide-slate-100">
          {commits.map((commit) => (
            <li key={commit.id} className="py-3">
              <Link className="font-medium text-blue-700 underline" to={`/repositories/${orgName}/${repoName}/commit/${commit.id}`}>
                {commit.message}
              </Link>
              <p className="text-sm text-slate-500">{commit.author} · {commit.relativeTime}</p>
            </li>
          ))}
        </ul>
      </section>
    </RepositoryShell>
  );
}

export function CommitDetailPage() {
  const { orgName = '', repoName = '', commitId = '' } = useParams();
  const { repository, error } = useRepository(orgName, repoName);
  const [commit, setCommit] = useState<any>(null);
  useEffect(() => {
    if (!repository) return;
    apiClient
      .get(`/repository-details/${orgName}/${repoName}/commits/${commitId}`)
      .then((response) => setCommit(response.data.commit))
      .catch(() => setCommit(null));
  }, [repository, orgName, repoName, commitId]);
  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;
  if (!commit) return <p>Loading…</p>;
  return (
    <RepositoryShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{commit.message}</h1>
        <p className="mt-1 text-sm text-slate-500">{commit.author}</p>
        <p className="mt-1 text-sm text-slate-500">Repository: {repository.fullName} · Branch: {commit.branchName} · Revision: {commit.id}</p>
        <h2 className="mt-5 text-lg font-semibold">Changed files</h2>
        <ul className="mt-2 space-y-2">
          {commit.changedFiles.map((file: any) => (
            <li key={file.path} className="rounded border border-slate-200 p-2 text-sm">
              <span className="font-mono">{file.path}</span>
              <span className="ml-3 text-green-700">+{file.additions}</span>
              <span className="ml-2 text-red-700">-{file.deletions}</span>
            </li>
          ))}
        </ul>
      </section>
    </RepositoryShell>
  );
}

export function RepositorySearchPage() {
  const { orgName = '', repoName = '' } = useParams();
  const { repository, error } = useRepository(orgName, repoName);
  const [params] = useSearchParams();
  const query = params.get('q') || '';
  const branch = params.get('branch') || repository?.defaultBranch || '';
  const [search, setSearch] = useState(query);
  const [results, setResults] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!repository) return;
    apiClient
      .get(`/repository-details/${orgName}/${repoName}/code-search`, { params: { q: query, branch } })
      .then((response) => setResults(response.data.results))
      .catch(() => setResults([]));
  }, [repository, orgName, repoName, query, branch]);

  function submit(event: FormEvent) {
    event.preventDefault();
    navigate(`/repositories/${orgName}/${repoName}/search?q=${encodeURIComponent(search)}&branch=${encodeURIComponent(branch)}`);
  }

  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;
  return (
    <RepositoryShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <form className="flex items-center gap-2" onSubmit={submit}>
          <input type="search" aria-label="Search" className="w-full rounded border border-slate-300 px-3 py-2" value={search} onChange={(event) => setSearch(event.target.value)} />
          <button type="submit" className="rounded bg-slate-900 px-4 py-2 text-sm text-white">Search</button>
        </form>
        <h1 className="mt-4 text-xl font-bold">Code results</h1>
        {results.length === 0 && <p className="mt-3 text-slate-600">No code results</p>}
        <ul className="mt-3 space-y-2">
          {results.map((result) => (
            <li key={result.path}>
              <Link
                className="font-medium text-blue-700 underline"
                to={`/repositories/${orgName}/${repoName}/blob/${encodeURIComponent(branch)}/${result.path.split('/').map(encodeURIComponent).join('/')}`}
              >
                {result.name}
              </Link>
              <p className="text-sm text-slate-500">{result.path}</p>
            </li>
          ))}
        </ul>
      </section>
    </RepositoryShell>
  );
}

export function RepositorySettingsPage() {
  const { orgName = '', repoName = '' } = useParams();
  const { repository, reload, error } = useRepository(orgName, repoName);
  const [dialog, setDialog] = useState<'' | 'archive' | 'restore'>('');
  const [message, setMessage] = useState('');
  async function confirmArchive() {
    setMessage('');
    try {
      await apiClient.post(`/repository-details/${orgName}/${repoName}/archive`);
      setDialog('');
      window.location.reload();
    } catch (requestError) {
      setMessage(getErrorMessage(requestError));
    }
  }
  async function confirmRestore() {
    setMessage('');
    try {
      await apiClient.post(`/repository-details/${orgName}/${repoName}/restore`);
      setDialog('');
      window.location.reload();
    } catch (requestError) {
      setMessage(getErrorMessage(requestError));
    }
  }
  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;
  return (
    <RepositoryShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Settings</h2>
        {!repository.canAdmin && <p className="mt-3 text-slate-500">You do not have permission to manage this repository.</p>}
        {repository.canAdmin && (
          <div className="mt-4 space-y-2 text-sm">
            <p><Link className="text-blue-700 underline" to={`/repositories/${orgName}/${repoName}/settings/general`}>General</Link></p>
            <p><Link className="text-blue-700 underline" to={`/repositories/${orgName}/${repoName}/settings/branches`}>Branches</Link></p>
            <p><Link className="text-blue-700 underline" to={`/repositories/${orgName}/${repoName}/access`}>Manage access</Link></p>
          </div>
        )}
        {repository.canAdmin && (
          <div className="mt-5">
            {!repository.archived ? (
              <button type="button" className="rounded bg-amber-600 px-4 py-2 text-sm font-semibold text-white" onClick={() => setDialog('archive')}>
                Archive repository
              </button>
            ) : (
              <button type="button" className="rounded bg-green-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => setDialog('restore')}>
                Restore repository
              </button>
            )}
          </div>
        )}
        {message && <p className="mt-3 text-sm text-red-700">{message}</p>}
      </section>
      {dialog === 'archive' && (
        <div role="dialog" aria-label="Archive repository" className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">Archive repository</h3>
            <p className="mt-2 text-sm text-slate-600">Archived repositories become read-only.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded border px-3 py-1.5" onClick={() => setDialog('')}>Cancel</button>
              <button type="button" className="rounded bg-amber-600 px-3 py-1.5 text-white" onClick={confirmArchive}>Confirm archive</button>
            </div>
          </div>
        </div>
      )}
      {dialog === 'restore' && (
        <div role="dialog" aria-label="Restore repository" className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">Restore repository</h3>
            <p className="mt-2 text-sm text-slate-600">Restore this repository to active status.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded border px-3 py-1.5" onClick={() => setDialog('')}>Cancel</button>
              <button type="button" className="rounded bg-green-700 px-3 py-1.5 text-white" onClick={confirmRestore}>Confirm restore</button>
            </div>
          </div>
        </div>
      )}
    </RepositoryShell>
  );
}

export function RepositoryGeneralSettingsPage() {
  const { orgName = '', repoName = '' } = useParams();
  const { repository, reload, error } = useRepository(orgName, repoName);
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState('public');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (repository) setVisibility(repository.visibility);
  }, [repository]);
  async function confirm() {
    try {
      await apiClient.post(`/repository-details/${orgName}/${repoName}/visibility`, { visibility });
      setOpen(false);
      window.location.reload();
    } catch (requestError) {
      setMessage(getErrorMessage(requestError));
    }
  }
  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;
  return (
    <RepositoryShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">General</h1>
        <p className="mt-3 text-sm text-slate-600">Current visibility: {repository.visibility}</p>
        {repository.canAdmin && <button type="button" className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm text-white" onClick={() => setOpen(true)}>Change visibility</button>}
        {open && (
          <div role="dialog" aria-label="Change visibility" className="mt-4 rounded border border-slate-200 p-4">
            <label className="mr-4 inline-flex items-center gap-2"><input type="radio" name="repo-visibility" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> Public</label>
            <label className="inline-flex items-center gap-2"><input type="radio" name="repo-visibility" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> Private</label>
            <div className="mt-3">
              <button type="button" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={confirm}>Confirm visibility</button>
            </div>
          </div>
        )}
        {message && <p className="mt-3 text-sm text-red-700">{message}</p>}
      </section>
    </RepositoryShell>
  );
}

export function RepositoryBranchesSettingsPage() {
  const { orgName = '', repoName = '' } = useParams();
  const { repository, error } = useRepository(orgName, repoName);
  const [branches, setBranches] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const [rules, setRules] = useState<any[]>([]);
  const [showRule, setShowRule] = useState(false);
  const [branchPattern, setBranchPattern] = useState('main');
  const [requireApproval, setRequireApproval] = useState(false);
  const [requireStatusCheck, setRequireStatusCheck] = useState(false);

  async function loadRules() {
    try {
      const response = await apiClient.get(`/repository-details/${orgName}/${repoName}/branch-protections`);
      setRules(response.data.rules || []);
    } catch {
      setRules([]);
    }
  }

  useEffect(() => {
    if (!repository) return;
    if (repository.canAdmin) {
      apiClient
        .get(`/repository-details/${orgName}/${repoName}/branches`)
        .then((response) => {
          setBranches(response.data.branches);
          setSelected(response.data.defaultBranch);
          if (!branchPattern) setBranchPattern(response.data.defaultBranch || 'main');
        })
        .catch(() => setBranches([]));
      void loadRules();
    }
  }, [repository, orgName, repoName]);

  async function confirm() {
    try {
      await apiClient.post(`/repository-details/${orgName}/${repoName}/default-branch`, { branch: selected });
      setConfirming(false);
      window.location.reload();
    } catch (requestError) {
      setMessage(getErrorMessage(requestError));
    }
  }

  async function saveRule(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      await apiClient.post(`/repository-details/${orgName}/${repoName}/branch-protections`, {
        branchPattern,
        requireApproval,
        requireStatusCheck,
      });
      setShowRule(false);
      await loadRules();
    } catch (requestError) {
      setMessage(getErrorMessage(requestError));
    }
  }

  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;
  return (
    <RepositoryShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Branches</h1>
        {repository.canAdmin ? (
          <>
            <label htmlFor="default-branch" className="mt-4 block text-sm font-medium">Default branch</label>
            <select id="default-branch" className="mt-1 rounded border border-slate-300 px-3 py-2" value={selected} onChange={(event) => setSelected(event.target.value)}>
              {branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
            </select>
            <button type="button" className="ml-3 rounded bg-slate-900 px-3 py-2 text-sm text-white" onClick={() => setConfirming(true)}>Update</button>
            {confirming && (
              <div role="dialog" aria-label="Update default branch" className="mt-4 rounded border border-slate-200 p-3">
                <p className="text-sm">Change default branch to <strong>{selected}</strong>?</p>
                <button type="button" className="mt-2 rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={confirm}>Confirm</button>
              </div>
            )}
            <div className="mt-6 border-t border-slate-200 pt-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Branch protection rules</h2>
                <button type="button" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setShowRule((current) => !current)}>Add branch protection rule</button>
              </div>
              <ul className="mt-3 space-y-2 text-sm">
                {rules.map((rule) => (
                  <li key={rule.id} className="rounded border border-slate-200 p-3">
                    <strong>{rule.branchPattern}</strong>
                    <span className="ml-2">{rule.requireApproval ? '1 approval' : '0 approvals'}</span>
                    <span className="ml-2">{rule.requireStatusCheck ? rule.statusCheckName : 'no status check'}</span>
                  </li>
                ))}
              </ul>
              {showRule && (
                <form className="mt-4 space-y-3 rounded border border-slate-200 p-4" onSubmit={saveRule}>
                  <div>
                    <label htmlFor="branch-pattern" className="block text-sm font-medium">Branch name pattern</label>
                    <input id="branch-pattern" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={branchPattern} onChange={(event) => setBranchPattern(event.target.value)} />
                  </div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={requireApproval} onChange={(event) => setRequireApproval(event.target.checked)} /> Require 1 approval</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={requireStatusCheck} onChange={(event) => setRequireStatusCheck(event.target.checked)} /> Require status check test</label>
                  <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">Create</button>
                </form>
              )}
            </div>
          </>
        ) : (
          <p className="mt-3 text-slate-500">You do not have permission to change the default branch.</p>
        )}
        {message && <p className="mt-3 text-sm text-red-700">{message}</p>}
      </section>
    </RepositoryShell>
  );
}

export function ReleasesPage() {
  const { orgName = '', repoName = '' } = useParams();
  const { repository, error } = useRepository(orgName, repoName);
  const [releases, setReleases] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [tag, setTag] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate();

  async function loadReleases() {
    const response = await apiClient.get(`/repository-details/${orgName}/${repoName}/releases`);
    setReleases(response.data.releases);
  }
  useEffect(() => {
    if (!repository) return;
    void loadReleases();
    apiClient.get(`/repository-details/${orgName}/${repoName}/branches`).then((response) => {
      setBranches(response.data.branches);
      setBranch(response.data.defaultBranch);
    }).catch(() => setBranches([]));
  }, [repository, orgName, repoName]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      const response = await apiClient.post(`/repository-details/${orgName}/${repoName}/releases`, {
        tag,
        title,
        description,
        branch,
      });
      navigate(`/repositories/${orgName}/${repoName}/releases/${encodeURIComponent(response.data.release.tag)}`);
    } catch (requestError) {
      setErrors(getFieldErrors(requestError));
    }
  }

  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;
  return (
    <RepositoryShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Releases</h1>
          {repository.canWrite && !repository.archived && (
            <button type="button" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setShowForm((current) => !current)}>
              New release
            </button>
          )}
        </div>
        {showForm && (
          <form className="mt-4 space-y-3 rounded border border-slate-200 p-4" onSubmit={submit}>
            <div>
              <label htmlFor="release-tag" className="block text-sm font-medium">Tag name</label>
              <input id="release-tag" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={tag} onChange={(event) => setTag(event.target.value)} />
              {errors.tag && <p className="text-sm text-red-700">{errors.tag}</p>}
            </div>
            <div>
              <label htmlFor="release-title" className="block text-sm font-medium">Release title</label>
              <input id="release-title" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={title} onChange={(event) => setTitle(event.target.value)} />
              {errors.title && <p className="text-sm text-red-700">{errors.title}</p>}
            </div>
            <div>
              <label htmlFor="release-description" className="block text-sm font-medium">Description</label>
              <textarea id="release-description" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
            <div>
              <label htmlFor="release-branch" className="block text-sm font-medium">Target branch</label>
              <select id="release-branch" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={branch} onChange={(event) => setBranch(event.target.value)}>
                {branches.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              {errors.branch && <p className="text-sm text-red-700">{errors.branch}</p>}
            </div>
            <button type="submit" className="rounded bg-slate-900 px-4 py-2 text-sm text-white">Publish release</button>
          </form>
        )}
        <ul className="mt-5 space-y-2">
          {releases.map((release) => (
            <li key={release.id}>
              <Link className="font-medium text-blue-700 underline" to={`/repositories/${orgName}/${repoName}/releases/${encodeURIComponent(release.tag)}`}>
                {release.tag}
              </Link>
              <span className="ml-2 text-sm text-slate-500">{release.title}</span>
            </li>
          ))}
        </ul>
      </section>
    </RepositoryShell>
  );
}

export function ReleaseDetailPage() {
  const { orgName = '', repoName = '', tag = '' } = useParams();
  const { repository, error } = useRepository(orgName, repoName);
  const [release, setRelease] = useState<any>(null);
  useEffect(() => {
    if (!repository) return;
    apiClient
      .get(`/repository-details/${orgName}/${repoName}/releases/${encodeURIComponent(tag)}`)
      .then((response) => setRelease(response.data.release))
      .catch(() => setRelease(null));
  }, [repository, orgName, repoName, tag]);
  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;
  if (!release) return <p>Loading…</p>;
  return (
    <RepositoryShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{release.tag}</h1>
        <h2 className="mt-2 text-xl font-semibold">{release.title}</h2>
        <p className="mt-3 text-slate-700">{release.description}</p>
        <p className="mt-3 text-sm text-slate-500">Target branch: {release.branchName}</p>
      </section>
    </RepositoryShell>
  );
}

export function RepositoryIssuesPage() {
  return (
    <RepositoryShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Issues</h1>
        <p className="mt-3 text-slate-500">Issues are outside this assigned scope.</p>
      </section>
    </RepositoryShell>
  );
}

export function RepositoryPullsPage() {
  return (
    <RepositoryShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Pull requests</h1>
        <p className="mt-3 text-slate-500">Pull requests are outside this assigned scope.</p>
      </section>
    </RepositoryShell>
  );
}
