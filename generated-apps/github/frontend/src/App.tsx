import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { AuthProvider, useAuth } from './context/AuthContext';
import HomePage from './pages/HomePage';
import { ForgotPasswordPage, SignInPage, SignUpPage } from './pages/AuthPages';
import { PasswordSettingsPage, SessionsPage, SettingsPage } from './pages/SettingsPages';
import {
  AuditLogPage,
  NewOrganizationPage,
  NewTeamPage,
  OrganizationOverviewPage,
  OrganizationRepositoriesPage,
  OrganizationsPage,
  PeoplePage,
  TeamMembersPage,
  TeamOverviewPage,
  TeamSettingsPage,
  TeamsPage,
} from './pages/OrganizationPages';
import { ManageAccessPage } from './pages/RepositoryPages';
import {
  SearchPage,
  RepositoriesPage,
  UserRepositoriesPage,
  NewRepositoryPage,
  ForkRepositoryPage,
  RepositoryOverviewPage,
  RepositoryCodePage,
  NewFilePage,
  FilePage,
  CommitsPage,
  CommitDetailPage,
  RepositorySearchPage,
  RepositorySettingsPage,
  RepositoryGeneralSettingsPage,
  RepositoryBranchesSettingsPage,
  ReleasesPage,
  ReleaseDetailPage,
} from './pages/Module2Pages';
import {
  NewPullRequestPage,
  PullRequestCommitsPage,
  PullRequestDetailPage,
  PullRequestFilesPage,
  RepositoryPullsListPage,
} from './pages/Module4Pages';
import { IssueDetailPage, NewIssuePage, RepositoryIssuesPage } from './pages/IssuePages';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { account, loading } = useAuth();
  if (loading) {
    return <p>Loading…</p>;
  }
  if (!account) {
    return <Navigate to="/signin" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/forgot" element={<ForgotPasswordPage />} />

          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/settings/password" element={<ProtectedRoute><PasswordSettingsPage /></ProtectedRoute>} />
          <Route path="/settings/sessions" element={<ProtectedRoute><SessionsPage /></ProtectedRoute>} />

          <Route path="/organizations" element={<ProtectedRoute><OrganizationsPage /></ProtectedRoute>} />
          <Route path="/organizations/new" element={<ProtectedRoute><NewOrganizationPage /></ProtectedRoute>} />
          <Route path="/organizations/:orgName" element={<OrganizationOverviewPage />} />
          <Route path="/organizations/:orgName/repositories" element={<OrganizationRepositoriesPage />} />
          <Route path="/organizations/:orgName/people" element={<ProtectedRoute><PeoplePage /></ProtectedRoute>} />
          <Route path="/organizations/:orgName/teams" element={<ProtectedRoute><TeamsPage /></ProtectedRoute>} />
          <Route path="/organizations/:orgName/teams/new" element={<ProtectedRoute><NewTeamPage /></ProtectedRoute>} />
          <Route path="/organizations/:orgName/teams/:teamName" element={<ProtectedRoute><TeamOverviewPage /></ProtectedRoute>} />
          <Route path="/organizations/:orgName/teams/:teamName/members" element={<ProtectedRoute><TeamMembersPage /></ProtectedRoute>} />
          <Route path="/organizations/:orgName/teams/:teamName/settings" element={<ProtectedRoute><TeamSettingsPage /></ProtectedRoute>} />
          <Route path="/organizations/:orgName/audit" element={<ProtectedRoute><AuditLogPage /></ProtectedRoute>} />

          <Route path="/search" element={<SearchPage />} />
          <Route path="/repositories" element={<RepositoriesPage />} />
          <Route path="/repositories/new" element={<ProtectedRoute><NewRepositoryPage /></ProtectedRoute>} />
          <Route path="/users/:username/repositories" element={<UserRepositoriesPage />} />
          <Route path="/repositories/:orgName/:repoName" element={<RepositoryOverviewPage />} />
          <Route path="/repositories/:orgName/:repoName/code" element={<RepositoryCodePage />} />
          <Route path="/repositories/:orgName/:repoName/new-file" element={<ProtectedRoute><NewFilePage /></ProtectedRoute>} />
          <Route path="/repositories/:orgName/:repoName/blob/:branch/*" element={<FilePage />} />
          <Route path="/repositories/:orgName/:repoName/commits" element={<CommitsPage />} />
          <Route path="/repositories/:orgName/:repoName/commit/:commitId" element={<CommitDetailPage />} />
          <Route path="/repositories/:orgName/:repoName/search" element={<RepositorySearchPage />} />
          <Route path="/repositories/:orgName/:repoName/releases" element={<ReleasesPage />} />
          <Route path="/repositories/:orgName/:repoName/releases/:tag" element={<ReleaseDetailPage />} />
          <Route path="/repositories/:orgName/:repoName/issues" element={<RepositoryIssuesPage />} />
          <Route path="/repositories/:orgName/:repoName/issues/new" element={<ProtectedRoute><NewIssuePage /></ProtectedRoute>} />
          <Route path="/repositories/:orgName/:repoName/issues/:number" element={<IssueDetailPage />} />
          <Route path="/repositories/:orgName/:repoName/pulls" element={<RepositoryPullsListPage />} />
          <Route path="/repositories/:orgName/:repoName/pulls/new" element={<ProtectedRoute><NewPullRequestPage /></ProtectedRoute>} />
          <Route path="/repositories/:orgName/:repoName/pulls/:number" element={<PullRequestDetailPage />} />
          <Route path="/repositories/:orgName/:repoName/pulls/:number/commits" element={<PullRequestCommitsPage />} />
          <Route path="/repositories/:orgName/:repoName/pulls/:number/files" element={<PullRequestFilesPage />} />
          <Route path="/repositories/:orgName/:repoName/fork" element={<ProtectedRoute><ForkRepositoryPage /></ProtectedRoute>} />
          <Route path="/repositories/:orgName/:repoName/settings" element={<ProtectedRoute><RepositorySettingsPage /></ProtectedRoute>} />
          <Route path="/repositories/:orgName/:repoName/settings/general" element={<ProtectedRoute><RepositoryGeneralSettingsPage /></ProtectedRoute>} />
          <Route path="/repositories/:orgName/:repoName/settings/branches" element={<ProtectedRoute><RepositoryBranchesSettingsPage /></ProtectedRoute>} />
          <Route path="/repositories/:orgName/:repoName/access" element={<ProtectedRoute><ManageAccessPage /></ProtectedRoute>} />
        </Routes>
      </Layout>
    </AuthProvider>
  );
}

export default App;
