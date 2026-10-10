import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  return { repository, error, reload: load };
}

function PullRequestShell({ orgName, repoName, children }: { orgName: string; repoName: string; children: React.ReactNode }) {
  const { repository, error } = useRepository(orgName, repoName);
  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;
  return <div>{children(repository)}</div>;
}

export function RepositoryPullsListPage() {
  const { orgName = '', repoName = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { repository, error } = useRepository(orgName, repoName);
  const [pulls, setPulls] = useState<any[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const status = searchParams.get('status') || '';

  useEffect(() => {
    if (!repository) return;
    apiClient
      .get(`/repository-details/${orgName}/${repoName}/pulls`, { params: status ? { status } : {} })
      .then((response) => {
        setPulls(response.data.pulls || []);
        setCanWrite(Boolean(response.data.canWrite));
      })
      .catch(() => setPulls([]));
  }, [repository, orgName, repoName, status]);

  function setStatus(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('status', next);
    else params.delete('status');
    setSearchParams(params);
  }

  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;
  return (
    <PullRequestShell orgName={orgName} repoName={repoName}>
      {() => (
        <section className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">Pull requests</h1>
              <p className="mt-1 text-sm text-slate-500">{repository.fullName}</p>
            </div>
            <div className="flex items-center gap-3">
              <Link className={`text-sm font-medium ${status === 'open' ? 'text-slate-900 underline' : 'text-blue-700 underline'}`} to={`/repositories/${orgName}/${repoName}/pulls?status=open`}>Open</Link>
              <Link className="text-sm font-medium text-blue-700 underline" to={`/repositories/${orgName}/${repoName}/pulls?status=closed`}>Closed</Link>
              {canWrite && !repository.archived && (
                <Link className="rounded bg-green-700 px-3 py-2 text-sm font-semibold text-white" to={`/repositories/${orgName}/${repoName}/pulls/new`}>
                  New pull request
                </Link>
              )}
            </div>
          </div>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {pulls.map((pr) => (
              <li key={pr.number} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <Link className="text-lg font-semibold text-blue-700 underline" to={`/repositories/${orgName}/${repoName}/pulls/${pr.number}`}>
                    {pr.title}
                  </Link>
                  <p className="mt-1 text-sm text-slate-500">#{pr.number} by {pr.author || 'unknown'} · {pr.baseBranch} ← {pr.compareBranch}</p>
                </div>
                <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold uppercase tracking-wide">{pr.status}</span>
              </li>
            ))}
          </ul>
          {pulls.length === 0 && <p className="text-slate-500">No pull requests found.</p>}
        </section>
      )}
    </PullRequestShell>
  );
}

export function NewPullRequestPage() {
  const { orgName = '', repoName = '' } = useParams();
  const { repository, error } = useRepository(orgName, repoName);
  const navigate = useNavigate();
  const [branches, setBranches] = useState<string[]>([]);
  const [base, setBase] = useState('');
  const [compare, setCompare] = useState('');
  const [comparison, setComparison] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!repository) return;
    setBase(repository.defaultBranch);
    apiClient
      .get(`/repository-details/${orgName}/${repoName}/branches`)
      .then((response) => {
        const names = response.data.branches || [];
        setBranches(names);
        const firstOther = names.find((name: string) => name !== repository.defaultBranch) || '';
        setCompare(firstOther);
      })
      .catch(() => setBranches([]));
  }, [repository, orgName, repoName]);

  async function compareBranches(event?: FormEvent) {
    event?.preventDefault();
    setMessage('');
    setComparison(null);
    setShowForm(false);
    try {
      const response = await apiClient.get(`/repository-details/${orgName}/${repoName}/pulls/compare`, {
        params: { base, compare },
      });
      setComparison(response.data);
    } catch (requestError) {
      setMessage(getErrorMessage(requestError));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      const response = await apiClient.post(`/repository-details/${orgName}/${repoName}/pulls`, {
        base,
        compare,
        title,
        description,
        draft,
      });
      navigate(`/repositories/${orgName}/${repoName}/pulls/${response.data.pullRequest.number}`);
    } catch (requestError) {
      setErrors(getFieldErrors(requestError));
      setMessage(getErrorMessage(requestError));
    }
  }

  if (error) return <ErrorMessage message={error} />;
  if (!repository) return <p>Loading…</p>;
  const canCreate = repository.canWrite && !repository.archived && comparison && !comparison.identical;
  return (
    <PullRequestShell orgName={orgName} repoName={repoName}>
      {() => (
        <section className="space-y-5">
          <h1 className="text-2xl font-bold">Compare changes</h1>
          <p className="text-sm text-slate-500">{repository.fullName}</p>
          <form className="rounded-lg border border-slate-200 bg-white p-5" onSubmit={compareBranches}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="base-branch" className="block text-sm font-medium">Base</label>
                <select id="base-branch" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={base} onChange={(event) => setBase(event.target.value)}>
                  {branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="compare-branch" className="block text-sm font-medium">Compare</label>
                <select id="compare-branch" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={compare} onChange={(event) => setCompare(event.target.value)}>
                  {branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                </select>
              </div>
            </div>
            <button type="submit" className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Compare changes</button>
          </form>
          {message && <ErrorMessage message={message} />}
          {comparison && (
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              {comparison.identical ? (
                <p className="text-sm text-slate-600">{comparison.message || 'There are no differences between these branches.'}</p>
              ) : (
                <>
                  <p className="text-sm text-slate-600">Comparing {comparison.baseBranch} ← {comparison.compareBranch}: +{comparison.additions} −{comparison.deletions}</p>
                  <ul className="mt-3 divide-y divide-slate-100">
                    {(comparison.changedFiles || []).map((file: any) => (
                      <li key={file.path} className="py-2 font-mono text-sm">{file.path} (+{file.additions} −{file.deletions})</li>
                    ))}
                  </ul>
                  {(comparison.commits || []).map((commit: any) => (
                    <p key={commit.id} className="mt-2 text-sm text-slate-500">{commit.message} · {commit.authorName}</p>
                  ))}
                  {canCreate && !showForm && (
                    <div className="mt-4 flex gap-3">
                      <button type="button" className="rounded bg-green-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => { setDraft(false); setShowForm(true); }}>Create pull request</button>
                      <button type="button" className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold" onClick={() => { setDraft(true); setShowForm(true); }}>Create draft pull request</button>
                    </div>
                  )}
                  {showForm && (
                    <form className="mt-4 space-y-3 border-t border-slate-200 pt-4" onSubmit={submit}>
                      <div>
                        <label htmlFor="pr-title" className="block text-sm font-medium">Title</label>
                        <input id="pr-title" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={title} onChange={(event) => setTitle(event.target.value)} />
                        {errors.title && <p className="text-sm text-red-700">{errors.title}</p>}
                      </div>
                      <div>
                        <label htmlFor="pr-description" className="block text-sm font-medium">Description</label>
                        <textarea id="pr-description" rows={4} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={description} onChange={(event) => setDescription(event.target.value)} />
                      </div>
                      <button type="submit" className="rounded bg-green-700 px-4 py-2 text-sm font-semibold text-white">{draft ? 'Create draft pull request' : 'Create pull request'}</button>
                    </form>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}
    </PullRequestShell>
  );
}

export function PullRequestDetailPage() {
  const { orgName = '', repoName = '', number = '' } = useParams();
  const { account } = useAuth();
  const [pullRequest, setPullRequest] = useState<any>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reviewersOpen, setReviewersOpen] = useState(false);
  const [reviewerSearch, setReviewerSearch] = useState('');
  const [candidates, setCandidates] = useState<any[]>([]);
  const [mergeConfirm, setMergeConfirm] = useState(false);
  const [checkStatus, setCheckStatus] = useState('pending');
  const [summary, setSummary] = useState('');
  const [reviewDecision, setReviewDecision] = useState('approve');

  async function load() {
    try {
      const response = await apiClient.get(`/repository-details/${orgName}/${repoName}/pulls/${number}`);
      setPullRequest(response.data.pullRequest);
      setCheckStatus(response.data.pullRequest.checks?.[0]?.status || 'pending');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }
  useEffect(() => { void load(); }, [orgName, repoName, number]);

  async function postAction(path: string) {
    setMessage('');
    try {
      await apiClient.post(`/repository-details/${orgName}/${repoName}/pulls/${number}/${path}`);
      await load();
    } catch (requestError) {
      setMessage(getErrorMessage(requestError));
    }
  }

  async function updateCheck() {
    try {
      await apiClient.post(`/repository-details/${orgName}/${repoName}/pulls/${number}/checks/test`, { status: checkStatus });
      await load();
    } catch (requestError) {
      setMessage(getErrorMessage(requestError));
    }
  }

  async function submitReview(decision: string) {
    try {
      await apiClient.post(`/repository-details/${orgName}/${repoName}/pulls/${number}/reviews`, { decision, summary });
      setSummary('');
      await load();
    } catch (requestError) {
      setMessage(getErrorMessage(requestError));
    }
  }

  async function searchReviewers(value: string) {
    setReviewerSearch(value);
    try {
      const response = await apiClient.get(`/repository-details/${orgName}/${repoName}/pulls/${number}/reviewer-candidates`, { params: { q: value } });
      setCandidates(response.data.accounts || []);
    } catch {
      setCandidates([]);
    }
  }

  async function addReviewer(username: string) {
    try {
      await apiClient.post(`/repository-details/${orgName}/${repoName}/pulls/${number}/reviewers`, { username });
      setReviewerSearch('');
      setCandidates([]);
      await load();
    } catch (requestError) {
      setMessage(getErrorMessage(requestError));
    }
  }

  async function removeReviewer(username: string) {
    try {
      await apiClient.delete(`/repository-details/${orgName}/${repoName}/pulls/${number}/reviewers/${encodeURIComponent(username)}`);
      await load();
    } catch (requestError) {
      setMessage(getErrorMessage(requestError));
    }
  }

  async function confirmMerge() {
    setMessage('');
    try {
      await apiClient.post(`/repository-details/${orgName}/${repoName}/pulls/${number}/merge`, { method: 'Create a merge commit' });
      setMergeConfirm(false);
      await load();
    } catch (requestError) {
      setMessage(getErrorMessage(requestError));
    }
  }

  if (error) return <ErrorMessage message={error} />;
  if (!pullRequest) return <p>Loading…</p>;
  const currentUrl = `/repositories/${orgName}/${repoName}/pulls/${number}`;
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{pullRequest.title}</h1>
          <p className="mt-2 text-sm text-slate-500">#{pullRequest.number} by {pullRequest.author || 'unknown'} · {pullRequest.baseBranch} ← {pullRequest.compareBranch}</p>
          <p className="mt-2 text-sm font-semibold">{pullRequest.status}</p>
          {(pullRequest.reviews || []).some((review: any) => review.decision === 'Approve') && <p className="text-sm font-semibold text-green-700">Approved</p>}
          {(pullRequest.reviews || []).some((review: any) => review.decision === 'Request changes') && <p className="text-sm font-semibold text-red-700">Changes requested</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pullRequest.permissions?.canReady && <button type="button" className="rounded bg-green-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => postAction('ready')}>Ready for review</button>}
          {pullRequest.permissions?.canClose && <button type="button" className="rounded border border-red-300 px-3 py-2 text-sm font-semibold text-red-700" onClick={() => postAction('close')}>Close pull request</button>}
          {pullRequest.permissions?.canReopen && <button type="button" className="rounded bg-green-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => postAction('reopen')}>Reopen pull request</button>}
          {pullRequest.permissions?.canMerge && (
            <button type="button" disabled={!pullRequest.mergeable} className="rounded bg-purple-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-300" onClick={() => setMergeConfirm(true)}>
              Merge pull request
            </button>
          )}
        </div>
      </div>
      <nav className="flex gap-4 border-b border-slate-200 pb-2 text-sm font-medium">
        <Link className="text-blue-700 underline" to={currentUrl}>Conversation</Link>
        <Link className="text-blue-700 underline" to={`${currentUrl}/commits`}>Commits</Link>
        <Link className="text-blue-700 underline" to={`${currentUrl}/files`}>Files changed</Link>
        <a className="text-blue-700 underline" href="#checks">Checks</a>
      </nav>
      {message && <ErrorMessage message={message} />}
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-5">
          <article className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold">Description</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{pullRequest.description || 'No description provided.'}</p>
          </article>
          <article className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold">Conversation</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              {(pullRequest.activities || []).map((activity: any) => (
                <li key={activity.id}><strong>{activity.actor || 'system'}</strong> {activity.detail || activity.eventType}</li>
              ))}
              {(pullRequest.reviews || []).filter((review: any) => review.status === 'submitted').map((review: any) => (
                <li key={`r${review.id}`}><strong>{review.reviewer}</strong> {review.decision}{review.summary ? `: ${review.summary}` : ''}</li>
              ))}
            </ul>
          </article>
        </div>
        <aside className="space-y-4">
          <section id="checks" className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">Checks</h2>
            {(pullRequest.checks || []).map((check: any) => (
              <p key={check.name} className="mt-2 text-sm">{check.name} <span className="font-semibold">{check.status}</span>{check.setter ? ` by ${check.setter}` : ''}</p>
            ))}
            {pullRequest.permissions?.canManageChecks && (
              <div className="mt-3">
                <label htmlFor="test-status" className="block text-sm font-medium">test</label>
                <select id="test-status" aria-label="test status" className="mt-1 rounded border border-slate-300 px-2 py-1" value={checkStatus} onChange={(event) => setCheckStatus(event.target.value)}>
                  <option value="pending">pending</option>
                  <option value="success">success</option>
                  <option value="failure">failure</option>
                </select>
                <button type="button" className="ml-2 rounded bg-slate-900 px-2 py-1 text-sm text-white" onClick={updateCheck}>Update</button>
              </div>
            )}
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Reviewers</h2>
              {pullRequest.permissions?.canManageReviewers && <button type="button" className="text-sm text-blue-700 underline" onClick={() => setReviewersOpen((current) => !current)}>Reviewers</button>}
            </div>
            {(pullRequest.reviewers || []).map((reviewer: any) => (
              <p key={reviewer.username} className="mt-2 text-sm">
                {reviewer.username}
                {pullRequest.permissions?.canManageReviewers && (
                  <button type="button" className="ml-2 text-xs text-red-700 underline" onClick={() => removeReviewer(reviewer.username)}>Remove {reviewer.username}</button>
                )}
              </p>
            ))}
            {reviewersOpen && (
              <div className="mt-3">
                <label htmlFor="reviewer-search" className="block text-sm font-medium">Search</label>
                <input id="reviewer-search" className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={reviewerSearch} onChange={(event) => void searchReviewers(event.target.value)} />
                {candidates.map((candidate) => (
                  <button key={candidate.username} type="button" role="option" className="mt-1 block text-sm text-blue-700 underline" onClick={() => addReviewer(candidate.username)}>{candidate.username}</button>
                ))}
              </div>
            )}
          </section>
          {pullRequest.permissions?.canReview && (
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="font-semibold">Review changes</h2>
              <div className="mt-2 space-y-2 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="review-decision" checked={reviewDecision === 'approve'} onChange={() => setReviewDecision('approve')} /> Approve</label>
                <label className="flex items-center gap-2"><input type="radio" name="review-decision" checked={reviewDecision === 'request_changes'} onChange={() => setReviewDecision('request_changes')} /> Request changes</label>
              </div>
              <label htmlFor="review-summary" className="mt-3 block text-sm font-medium">Summary</label>
              <textarea id="review-summary" rows={2} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={summary} onChange={(event) => setSummary(event.target.value)} />
              <button type="button" className="mt-3 rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white" onClick={() => submitReview(reviewDecision)}>Submit review</button>
            </section>
          )}
          {pullRequest.mergeConditions?.length > 0 && (
            <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
              <h2 className="font-semibold">Merge conditions</h2>
              {pullRequest.mergeConditions.map((condition: any) => (
                <p key={condition.key} className={condition.satisfied ? 'text-green-700' : 'text-red-700'}>{condition.label}{condition.satisfied ? '' : ` — ${condition.detail || 'unsatisfied'}`}</p>
              ))}
            </section>
          )}
        </aside>
      </div>
      {mergeConfirm && (
        <div role="dialog" aria-label="Confirm merge" className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5">
            <h2 className="text-lg font-semibold">Confirm merge</h2>
            <p className="mt-2 text-sm text-slate-600">Create a merge commit</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded border px-3 py-1.5" onClick={() => setMergeConfirm(false)}>Cancel</button>
              <button type="button" className="rounded bg-purple-700 px-3 py-1.5 text-white" onClick={confirmMerge}>Confirm merge</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function PullRequestCommitsPage() {
  const { orgName = '', repoName = '', number = '' } = useParams();
  const [pullRequest, setPullRequest] = useState<any>(null);
  const [commits, setCommits] = useState<any[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      apiClient.get(`/repository-details/${orgName}/${repoName}/pulls/${number}`),
      apiClient.get(`/repository-details/${orgName}/${repoName}/pulls/${number}/commits`),
    ]).then(([prResponse, commitsResponse]) => {
      setPullRequest(prResponse.data.pullRequest);
      setCommits(commitsResponse.data.commits || []);
    }).catch((requestError) => setError(getErrorMessage(requestError)));
  }, [orgName, repoName, number]);
  if (error) return <ErrorMessage message={error} />;
  if (!pullRequest) return <p>Loading…</p>;
  const base = `/repositories/${orgName}/${repoName}/pulls/${number}`;
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-bold">{pullRequest.title}</h1>
      <nav className="flex gap-4 border-b border-slate-200 pb-2 text-sm font-medium">
        <Link className="text-blue-700 underline" to={base}>Conversation</Link>
        <Link className="text-blue-700 underline" to={`${base}/commits`}>Commits</Link>
        <Link className="text-blue-700 underline" to={`${base}/files`}>Files changed</Link>
      </nav>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {commits.map((commit) => (
          <li key={commit.id} className="p-4">
            <p className="font-semibold">{commit.message}</p>
            <p className="text-sm text-slate-500">{commit.authorName} · {commit.createdAt}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PullRequestFilesPage() {
  const { orgName = '', repoName = '', number = '' } = useParams();
  const [pullRequest, setPullRequest] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [additions, setAdditions] = useState(0);
  const [deletions, setDeletions] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [openComment, setOpenComment] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDecision, setReviewDecision] = useState('approve');

  async function load() {
    try {
      const [prResponse, filesResponse] = await Promise.all([
        apiClient.get(`/repository-details/${orgName}/${repoName}/pulls/${number}`),
        apiClient.get(`/repository-details/${orgName}/${repoName}/pulls/${number}/files`),
      ]);
      setPullRequest(prResponse.data.pullRequest);
      setFiles(filesResponse.data.files || []);
      setComments(filesResponse.data.comments || []);
      setAdditions(filesResponse.data.additions || 0);
      setDeletions(filesResponse.data.deletions || 0);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }
  useEffect(() => { void load(); }, [orgName, repoName, number]);

  async function addComment(path: string, pending: boolean) {
    setMessage('');
    try {
      await apiClient.post(`/repository-details/${orgName}/${repoName}/pulls/${number}/review-comments`, {
        body: commentBody,
        path,
        line: 1,
        pending,
      });
      setCommentBody('');
      setOpenComment(null);
      await load();
    } catch (requestError) {
      setMessage(getErrorMessage(requestError));
    }
  }

  async function submitReview(decision: string) {
    try {
      await apiClient.post(`/repository-details/${orgName}/${repoName}/pulls/${number}/reviews`, { decision, summary: '' });
      setReviewOpen(false);
      await load();
    } catch (requestError) {
      setMessage(getErrorMessage(requestError));
    }
  }

  if (error) return <ErrorMessage message={error} />;
  if (!pullRequest) return <p>Loading…</p>;
  const base = `/repositories/${orgName}/${repoName}/pulls/${number}`;
  const hasPending = comments.some((comment) => comment.state === 'pending');
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-bold">{pullRequest.title}</h1>
      {(pullRequest.reviews || []).some((review: any) => review.decision === 'Approve') && <p className="text-sm font-semibold text-green-700">Approved</p>}
      {(pullRequest.reviews || []).some((review: any) => review.decision === 'Request changes') && <p className="text-sm font-semibold text-red-700">Changes requested</p>}
      <nav className="flex gap-4 border-b border-slate-200 pb-2 text-sm font-medium">
        <Link className="text-blue-700 underline" to={base}>Conversation</Link>
        <Link className="text-blue-700 underline" to={`${base}/commits`}>Commits</Link>
        <Link className="text-blue-700 underline" to={`${base}/files`}>Files changed</Link>
      </nav>
      {hasPending && <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">Pending review</p>}
      <p className="text-sm text-slate-600">+{additions} additions −{deletions} deletions</p>
      {message && <ErrorMessage message={message} />}
      <ul className="space-y-4">
        {files.map((file) => (
          <li key={file.path} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="font-mono text-sm font-semibold">{file.path}</p>
            <p className="text-xs text-slate-500">+{file.additions} −{file.deletions}</p>
            <pre className="mt-2 overflow-auto rounded bg-slate-50 p-3 text-xs">{file.newContent || file.oldContent}</pre>
            {pullRequest.permissions?.canReview && (
              <button type="button" className="mt-2 text-sm text-blue-700 underline" onClick={() => setOpenComment(file.path)}>Add comment</button>
            )}
            {openComment === file.path && (
              <div className="mt-3 border-t border-slate-200 pt-3">
                <label htmlFor={`comment-${file.path}`} className="block text-sm font-medium">Comment</label>
                <textarea id={`comment-${file.path}`} rows={3} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={commentBody} onChange={(event) => setCommentBody(event.target.value)} />
                <div className="mt-2 flex gap-2">
                  <button type="button" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => addComment(file.path, false)}>Add single comment</button>
                  <button type="button" className="rounded border border-slate-300 px-3 py-1.5 text-sm" onClick={() => addComment(file.path, true)}>Start a review</button>
                </div>
              </div>
            )}
            {comments.filter((comment) => comment.path === file.path).map((comment) => (
              <p key={comment.id} className="mt-2 rounded bg-slate-50 p-2 text-sm"><strong>{comment.author}</strong>: {comment.body}{comment.state === 'pending' ? ' (Pending review)' : ''}</p>
            ))}
          </li>
        ))}
      </ul>
      {pullRequest.permissions?.canReview && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <button type="button" className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white" onClick={() => setReviewOpen((current) => !current)}>Review changes</button>
          {reviewOpen && (
            <div className="mt-3 space-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="files-review" checked={reviewDecision === 'approve'} onChange={() => setReviewDecision('approve')} /> Approve</label>
              <label className="flex items-center gap-2"><input type="radio" name="files-review" checked={reviewDecision === 'request_changes'} onChange={() => setReviewDecision('request_changes')} /> Request changes</label>
              <button type="button" className="mt-2 rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white" onClick={() => submitReview(reviewDecision)}>Submit review</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
