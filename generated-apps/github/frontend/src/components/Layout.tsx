import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, type FormEvent } from 'react';
import AccountMenu from './AccountMenu';
import { useAuth } from '../context/AuthContext';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { account } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [globalQuery, setGlobalQuery] = useState('');
  const showGlobalSearch = !location.pathname.startsWith('/repositories');

  function submitGlobalSearch(event: FormEvent) {
    event.preventDefault();
    const query = globalQuery.trim();
    navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link to="/" className="shrink-0 text-lg font-bold text-slate-900">
            Collaborative Hub
          </Link>
          {showGlobalSearch && (
            <form role="search" className="flex flex-1 items-center gap-2" onSubmit={submitGlobalSearch}>
              <input
                type="search"
                aria-label="Search"
                placeholder="Search repositories"
                className="w-full min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={globalQuery}
                onChange={(event) => setGlobalQuery(event.target.value)}
              />
              <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                Search
              </button>
            </form>
          )}
          <div className="flex shrink-0 items-center gap-3">
            {account && (
              <>
                <Link className="text-sm font-medium text-blue-700 underline" to="/repositories">
                  Repositories
                </Link>
                <Link className="text-sm font-medium text-blue-700 underline" to="/repositories/new">
                  New repository
                </Link>
              </>
            )}
            {account && <AccountMenu />}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
