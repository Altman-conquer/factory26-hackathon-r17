import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import apiClient, { getErrorMessage, getFieldErrors } from '../api';
import { RepositoryShell } from './Module2Pages';

function ErrorMessage({ message }: { message: string }) {
  if (!message) return null;
  return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{message}</p>;
}

function useRepositoryDetails(orgName: string, repoName: string) {
  const [repository, setRepository] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    apiClient
      .get(`/repository-details/${orgName}/${repoName}`)
      .then((response) => setRepository(response.data.repository))
      .catch((requestError) => setError(getErrorMessage(requestError)));
  }, [orgName, repoName]);
  return { repository, error, setRepository };
}

function issueDate(value: string) {
  return value ? String(value).replace('T', ' ').replace('Z', '').slice(0, 19) : '';
}

export function RepositoryIssuesPage() {
  const { orgName = '', repoName = '' } = useParams();
  const [searchParams] = useSearchParams();
  const status = searchParams.get('status') || '';
  const [query, setQuery] = useState('');
  const [issues, setIssues] = useState<any[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [repository, setRepository] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient
      .get(`/repository-details/${orgName}/${repoName}`)
      .then((response) => {
        setRepository(response.data.repository);
        setCanWrite(Boolean(response.data.repository.canWrite));
      })
      .catch((requestError) => setError(getErrorMessage(requestError)));
  }, [orgName, repoName]);

  useEffect(() => {
    apiClient
      .get(`/repository-details/${orgName}/${repoName}/issues`, {
        params: { status: status || undefined, q: query || undefined },
      })
      .then((response) => setIssues(response.data.issues))
      .catch((requestError) => setError(getErrorMessage(requestError)));
  }, [orgName, repoName, status, query]);

  return (
    <RepositoryShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Issues</h1>
          {canWrite && !repository?.archived && (
            <Link
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white"
              to={`/repositories/${orgName}/${repoName}/issues/new`}
            >
              New issue
            </Link>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <Link
            className={`rounded border px-3 py-1.5 ${status === 'open' ? 'bg-slate-900 text-white' : 'border-slate-300'}`}
            to={{ pathname: `/repositories/${orgName}/${repoName}/issues`, search: '?status=open' }}
          >
            Open
          </Link>
          <Link
            className={`rounded border px-3 py-1.5 ${status === 'closed' ? 'bg-slate-900 text-white' : 'border-slate-300'}`}
            to={{ pathname: `/repositories/${orgName}/${repoName}/issues`, search: '?status=closed' }}
          >
            Closed
          </Link>
          <label className="ml-auto flex items-center gap-2" htmlFor="search-issues">
            <span className="font-medium">Search issues</span>
            <input
              id="search-issues"
              type="search"
              className="rounded border border-slate-300 px-3 py-1.5"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        {error && <div className="mt-4"><ErrorMessage message={error} /></div>}
        {issues.length === 0 && <p className="mt-5 text-slate-500">No issues match this view.</p>}
        <ul className="mt-5 divide-y divide-slate-100">
          {issues.map((issue) => (
            <li key={issue.id} className="flex flex-wrap items-start gap-3 py-3">
              <Link
                className="text-sm font-semibold text-slate-500"
                to={`/repositories/${orgName}/${repoName}/issues/${issue.number}`}
              >
                #{issue.number}
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  className="font-semibold text-blue-700 underline"
                  to={`/repositories/${orgName}/${repoName}/issues/${issue.number}`}
                >
                  {issue.title}
                </Link>
                <p className="mt-1 text-xs text-slate-500">
                  {issue.status} · opened by {issue.author || 'unknown'} · updated {issueDate(issue.updatedAt)}
                </p>
                {issue.labels?.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {issue.labels.map((label: any) => (
                      <span key={label.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs">
                        {label.name}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </RepositoryShell>
  );
}

export function NewIssuePage() {
  const { orgName = '', repoName = '' } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage('');
    try {
      const response = await apiClient.post(`/repository-details/${orgName}/${repoName}/issues`, {
        title,
        description,
      });
      navigate(`/repositories/${orgName}/${repoName}/issues/${response.data.issue.number}`);
    } catch (requestError) {
      const fieldErrors = getFieldErrors(requestError);
      setErrors(Object.keys(fieldErrors).length > 0 ? fieldErrors : { form: getErrorMessage(requestError) });
    }
  }

  return (
    <RepositoryShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">New issue</h1>
        {message && <div className="mt-3"><ErrorMessage message={message} /></div>}
        <form className="mt-4 space-y-4" onSubmit={submit}>
          <div>
            <label htmlFor="new-issue-title" className="block text-sm font-medium">Title</label>
            <input
              id="new-issue-title"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            {errors.title && <p className="mt-1 text-sm text-red-700">{errors.title}</p>}
          </div>
          <div>
            <label htmlFor="new-issue-description" className="block text-sm font-medium">Description</label>
            <textarea
              id="new-issue-description"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              rows={6}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            {errors.description && <p className="mt-1 text-sm text-red-700">{errors.description}</p>}
          </div>
          {errors.form && <ErrorMessage message={errors.form} />}
          <button type="submit" className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            Submit new issue
          </button>
        </form>
      </section>
    </RepositoryShell>
  );
}

export function IssueDetailPage() {
  const { orgName = '', repoName = '', number = '' } = useParams();
  const [issue, setIssue] = useState<any>(null);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [titleFormOpen, setTitleFormOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descriptionFormOpen, setDescriptionFormOpen] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState('');
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [assigneeQuery, setAssigneeQuery] = useState('');
  const [labelOpen, setLabelOpen] = useState(false);
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [options, setOptions] = useState<any[]>([]);
  const [reactionMenuOpen, setReactionMenuOpen] = useState(false);

  async function loadIssue() {
    setError('');
    try {
      const response = await apiClient.get(`/repository-details/${orgName}/${repoName}/issues/${number}`);
      setIssue(response.data.issue);
      setTitleDraft(response.data.issue.title);
      setDescriptionDraft(response.data.issue.description || '');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  useEffect(() => {
    void loadIssue();
  }, [orgName, repoName, number]);

  async function saveTitle(event: FormEvent) {
    event.preventDefault();
    setActionMessage('');
    try {
      const response = await apiClient.patch(`/repository-details/${orgName}/${repoName}/issues/${number}`, {
        title: titleDraft,
      });
      setIssue(response.data.issue);
      setTitleFormOpen(false);
      setActionMessage('Issue title saved.');
    } catch (requestError) {
      setActionMessage(getErrorMessage(requestError));
    }
  }

  async function saveDescription(event: FormEvent) {
    event.preventDefault();
    setActionMessage('');
    try {
      const response = await apiClient.patch(`/repository-details/${orgName}/${repoName}/issues/${number}`, {
        description: descriptionDraft,
      });
      setIssue(response.data.issue);
      setDescriptionFormOpen(false);
      setActionMessage('Issue description saved.');
    } catch (requestError) {
      setActionMessage(getErrorMessage(requestError));
    }
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    setCommentError('');
    setActionMessage('');
    if (!comment.trim()) {
      setCommentError('Comment is required');
      return;
    }
    try {
      await apiClient.post(`/repository-details/${orgName}/${repoName}/issues/${number}/comments`, {
        body: comment,
      });
      setComment('');
      await loadIssue();
    } catch (requestError) {
      setCommentError(getErrorMessage(requestError));
    }
  }

  async function loadAssignees(query = '') {
    const response = await apiClient.get(
      `/repository-details/${orgName}/${repoName}/issues/${number}/assignees`,
      { params: { q: query } },
    );
    setOptions(response.data.assignees || []);
  }

  async function toggleAssignee(username: string) {
    try {
      const response = await apiClient.post(
        `/repository-details/${orgName}/${repoName}/issues/${number}/assignees`,
        { username },
      );
      setIssue(response.data.issue);
      await loadAssignees(assigneeQuery);
    } catch (requestError) {
      setActionMessage(getErrorMessage(requestError));
    }
  }

  async function loadLabels() {
    const response = await apiClient.get(`/repository-details/${orgName}/${repoName}/labels`);
    setOptions(response.data.labels || []);
  }

  async function applyLabel(name: string) {
    try {
      const response = await apiClient.post(
        `/repository-details/${orgName}/${repoName}/issues/${number}/labels`,
        { name },
      );
      setIssue(response.data.issue);
      setLabelOpen(false);
    } catch (requestError) {
      setActionMessage(getErrorMessage(requestError));
    }
  }

  async function loadMilestones() {
    const response = await apiClient.get(`/repository-details/${orgName}/${repoName}/milestones`);
    setOptions(response.data.milestones || []);
  }

  async function applyMilestone(name: string) {
    try {
      const response = await apiClient.post(
        `/repository-details/${orgName}/${repoName}/issues/${number}/milestone`,
        { name },
      );
      setIssue(response.data.issue);
      setMilestoneOpen(false);
    } catch (requestError) {
      setActionMessage(getErrorMessage(requestError));
    }
  }

  async function transition(status: 'close' | 'reopen') {
    try {
      const response = await apiClient.post(
        `/repository-details/${orgName}/${repoName}/issues/${number}/${status}`,
      );
      setIssue(response.data.issue);
    } catch (requestError) {
      setActionMessage(getErrorMessage(requestError));
    }
  }

  async function toggleReaction() {
    try {
      const response = await apiClient.post(
        `/repository-details/${orgName}/${repoName}/issues/${number}/reactions`,
        { type: '+1' },
      );
      setIssue(response.data.issue);
      setReactionMenuOpen(false);
    } catch (requestError) {
      setActionMessage(getErrorMessage(requestError));
    }
  }

  if (error) return <RepositoryShell><ErrorMessage message={error} /></RepositoryShell>;
  if (!issue) return <RepositoryShell><p>Loading…</p></RepositoryShell>;

  const plusOne = (issue.reactions || []).find((reaction: any) => reaction.type === '+1');
  const hasPlusOne = Boolean(plusOne?.reacted);

  return (
    <RepositoryShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {actionMessage && <div className="mb-4"><ErrorMessage message={actionMessage} /></div>}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-slate-900">{issue.title}</h1>
            <p className="mt-2 text-sm text-slate-500">
              #{issue.number} · <span className="font-semibold">{issue.status}</span> · opened by {issue.author || 'unknown'}
            </p>
            <p className="mt-4 whitespace-pre-wrap text-slate-700">{issue.description}</p>
          </div>
          <aside className="w-full max-w-xs space-y-4 rounded border border-slate-200 p-4">
            <div>
              <h2 className="text-sm font-semibold">Assignees</h2>
              <p className="mt-1 text-sm text-slate-600">
                {issue.assignees?.length ? issue.assignees.map((assignee: any) => assignee.username).join(', ') : 'None yet'}
              </p>
              {issue.permissions?.canManage && (
                <button
                  type="button"
                  className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs"
                  onClick={() => {
                    setAssigneeOpen((current) => !current);
                    void loadAssignees();
                  }}
                >
                  Assignees
                </button>
              )}
              {assigneeOpen && (
                <div className="mt-2 rounded border border-slate-200 p-2">
                  <label className="block text-xs font-medium" htmlFor="search-assignees">Search assignees</label>
                  <input
                    id="search-assignees"
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    value={assigneeQuery}
                    onChange={(event) => {
                      setAssigneeQuery(event.target.value);
                      void loadAssignees(event.target.value);
                    }}
                  />
                  <div className="mt-2 space-y-1">
                    {options.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-100"
                        onClick={() => void toggleAssignee(candidate.username)}
                      >
                        {candidate.username}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div>
              <h2 className="text-sm font-semibold">Labels</h2>
              <p className="mt-1 text-sm text-slate-600">
                {issue.labels?.length ? issue.labels.map((label: any) => label.name).join(', ') : 'None yet'}
              </p>
              {issue.permissions?.canManage && (
                <button
                  type="button"
                  className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs"
                  onClick={() => {
                    setLabelOpen((current) => !current);
                    void loadLabels();
                  }}
                >
                  Labels
                </button>
              )}
              {labelOpen && (
                <div className="mt-2 space-y-1 rounded border border-slate-200 p-2">
                  {options.map((label) => (
                    <button
                      key={label.id}
                      type="button"
                      className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-100"
                      onClick={() => void applyLabel(label.name)}
                    >
                      {label.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h2 className="text-sm font-semibold">Milestone</h2>
              <p className="mt-1 text-sm text-slate-600">{issue.milestone?.name || 'None yet'}</p>
              {issue.permissions?.canManage && (
                <button
                  type="button"
                  className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs"
                  onClick={() => {
                    setMilestoneOpen((current) => !current);
                    void loadMilestones();
                  }}
                >
                  Milestone
                </button>
              )}
              {milestoneOpen && (
                <div className="mt-2 space-y-1 rounded border border-slate-200 p-2">
                  {options.map((milestone) => (
                    <button
                      key={milestone.id}
                      type="button"
                      className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-100"
                      onClick={() => void applyMilestone(milestone.name)}
                    >
                      {milestone.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {issue.permissions?.canEdit && (
            <>
              <button type="button" className="rounded border border-slate-300 px-3 py-1.5 text-sm" onClick={() => setTitleFormOpen((current) => !current)}>
                Edit issue title
              </button>
              <button type="button" className="rounded border border-slate-300 px-3 py-1.5 text-sm" onClick={() => setDescriptionFormOpen((current) => !current)}>
                Edit issue description
              </button>
            </>
          )}
          {issue.permissions?.canManage && issue.status === 'Open' && (
            <button type="button" className="rounded bg-red-700 px-3 py-1.5 text-sm font-semibold text-white" onClick={() => void transition('close')}>
              Close issue
            </button>
          )}
          {issue.permissions?.canManage && issue.status === 'Closed' && (
            <button type="button" className="rounded bg-green-700 px-3 py-1.5 text-sm font-semibold text-white" onClick={() => void transition('reopen')}>
              Reopen issue
            </button>
          )}
          {issue.permissions?.canReact && !hasPlusOne && (
            <div className="relative">
              <button type="button" className="rounded border border-slate-300 px-3 py-1.5 text-sm" onClick={() => setReactionMenuOpen((current) => !current)}>
                Add reaction
              </button>
              {reactionMenuOpen && (
                <div role="menu" className="absolute left-0 z-10 mt-1 rounded border border-slate-200 bg-white p-1 shadow">
                  <button type="button" role="menuitem" className="block rounded px-3 py-1 text-sm hover:bg-slate-100" onClick={() => void toggleReaction()}>
                    +1
                  </button>
                </div>
              )}
            </div>
          )}
          {issue.permissions?.canReact && hasPlusOne && (
            <button type="button" className="rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm" onClick={() => void toggleReaction()}>
              Remove +1 reaction
            </button>
          )}
          {(plusOne?.count || 0) > 0 && (
            <span className="rounded-full border border-slate-300 px-3 py-1.5 text-sm">
              +1 <span className="font-semibold">{plusOne.count}</span>
            </span>
          )}
        </div>

        {titleFormOpen && (
          <form className="mt-4 rounded border border-slate-200 p-4" onSubmit={saveTitle}>
            <label htmlFor="issue-title" className="block text-sm font-medium">Issue title</label>
            <input
              id="issue-title"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
            />
            <button type="submit" className="mt-3 rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
              Save issue title
            </button>
          </form>
        )}

        {descriptionFormOpen && (
          <form className="mt-4 rounded border border-slate-200 p-4" onSubmit={saveDescription}>
            <label htmlFor="issue-description" className="block text-sm font-medium">Issue description</label>
            <textarea
              id="issue-description"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              rows={6}
              value={descriptionDraft}
              onChange={(event) => setDescriptionDraft(event.target.value)}
            />
            <button type="submit" className="mt-3 rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
              Save issue description
            </button>
          </form>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="text-lg font-semibold">Discussion</h2>
            <div className="mt-3 space-y-3">
              {(issue.comments || []).map((item: any) => (
                <article key={item.id} className="rounded border border-slate-200 p-3">
                  <p className="text-sm font-semibold">{item.author || 'unknown'}</p>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700">{item.body}</p>
                </article>
              ))}
              {(!issue.comments || issue.comments.length === 0) && <p className="text-sm text-slate-500">No comments yet.</p>}
            </div>
            {issue.permissions?.canComment && (
              <form className="mt-4" onSubmit={submitComment}>
                <label htmlFor="issue-comment" className="block text-sm font-medium">Comment</label>
                <textarea
                  id="issue-comment"
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  rows={4}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                />
                {commentError && <p className="mt-1 text-sm text-red-700">{commentError}</p>}
                <button
                  type="submit"
                  disabled={!comment.trim()}
                  className="mt-2 rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  Comment
                </button>
              </form>
            )}
          </section>
          <section>
            <h2 className="text-lg font-semibold">Activity</h2>
            <ol className="mt-3 space-y-2">
              {(issue.activity || []).map((event: any) => (
                <li key={event.id} className="rounded border border-slate-100 bg-slate-50 p-3 text-sm">
                  <span className="font-semibold">{event.actor || 'unknown'}</span> {event.detail || event.eventType}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </section>
    </RepositoryShell>
  );
}
