import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api';
import { useAuth } from '../context/AuthContext';

function HomePage() {
  const { account, loading } = useAuth();
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [repositories, setRepositories] = useState<any[]>([]);

  useEffect(() => {
    if (!account) {
      apiClient
        .get('/organizations/public')
        .then((response) => setOrganizations(response.data.organizations))
        .catch(() => setOrganizations([]));
      apiClient
        .get('/repositories')
        .then((response) => setRepositories(response.data.repositories))
        .catch(() => setRepositories([]));
    }
  }, [account]);

  if (loading) {
    return <p>Loading…</p>;
  }

  if (!account) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-slate-900">Collaborative Hub</h1>
        <p className="mt-3 text-slate-600">
          A simplified GitHub collaboration platform for repositories, teams, and reviews.
        </p>
        <div className="mt-6 flex gap-4">
          <Link className="text-blue-700 underline" to="/signin">
            Sign in
          </Link>
          <Link className="text-blue-700 underline" to="/signup">
            Sign up
          </Link>
          <Link className="text-blue-700 underline" to="/forgot">
            Forgot password
          </Link>
        </div>
        {repositories.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900">Public repositories</h2>
            <ul className="mt-3 space-y-2">
              {repositories.map((repository) => (
                <li key={repository.id}>
                  <Link className="text-blue-700 underline" to={`/repositories/${repository.owner}/${repository.name}`}>
                    {repository.name}
                  </Link>
                  <span className="ml-2 text-sm text-slate-500">{repository.owner}/{repository.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {organizations.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900">Public organizations</h2>
            <ul className="mt-3 space-y-2">
              {organizations.map((organization) => (
                <li key={organization.id}>
                  <Link className="text-blue-700 underline" to={`/organizations/${organization.name}`}>
                    {organization.displayName}
                  </Link>
                  <span className="ml-2 text-sm text-slate-500">({organization.name})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-3xl font-bold text-slate-900">Workspace</h1>
      <p className="mt-3 text-lg text-slate-700" data-testid="current-username">
        {account.username}
      </p>
    </section>
  );
}

export default HomePage;
