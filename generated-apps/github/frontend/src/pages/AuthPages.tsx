import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import apiClient, { getFieldErrors, getErrorMessage } from '../api';
import { useAuth } from '../context/AuthContext';

type FieldErrors = Record<string, string>;

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }
  return <p className="mt-1 text-sm text-red-700">{message}</p>;
}

export function SignInPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await apiClient.post('/auth/signin', { identifier, password });
      await refresh();
      navigate('/');
    } catch (requestError) {
      setPassword('');
      setError(getErrorMessage(requestError, 'Invalid credentials'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Sign in</h1>
      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="signin-identifier" className="block text-sm font-medium text-slate-700">
            Username or email
          </label>
          <input
            id="signin-identifier"
            name="identifier"
            type="text"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="signin-password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="signin-password"
            name="password"
            type="password"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error && <p className="text-sm font-medium text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          Sign in
        </button>
      </form>
      <div className="mt-4 flex items-center justify-between text-sm">
        <Link className="text-blue-700 underline" to="/signup">
          Create an account
        </Link>
        <Link className="text-blue-700 underline" to="/forgot">
          Forgot password
        </Link>
      </div>
    </section>
  );
}

export function SignUpPage() {
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    agreeToTerms: false,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  function update(field: string, value: string | boolean) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setSubmitting(true);
    try {
      await apiClient.post('/auth/register', form);
      navigate('/signin');
    } catch (requestError) {
      const fieldErrors = getFieldErrors(requestError);
      setErrors(fieldErrors);
      setForm((current) => ({ ...current, password: '', confirmPassword: '' }));
      if (Object.keys(fieldErrors).length === 0) {
        setErrors({ form: getErrorMessage(requestError) });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Create your account</h1>
      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="signup-username" className="block text-sm font-medium text-slate-700">
            Username
          </label>
          <input
            id="signup-username"
            name="username"
            type="text"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.username}
            onChange={(event) => update('username', event.target.value)}
          />
          <FieldError message={errors.username} />
        </div>
        <div>
          <label htmlFor="signup-email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="signup-email"
            name="email"
            type="text"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
          />
          <FieldError message={errors.email} />
        </div>
        <div>
          <label htmlFor="signup-password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="signup-password"
            name="password"
            type="password"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.password}
            onChange={(event) => update('password', event.target.value)}
          />
          <FieldError message={errors.password} />
        </div>
        <div>
          <label htmlFor="signup-confirm" className="block text-sm font-medium text-slate-700">
            Confirm password
          </label>
          <input
            id="signup-confirm"
            name="confirmPassword"
            type="password"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.confirmPassword}
            onChange={(event) => update('confirmPassword', event.target.value)}
          />
          <FieldError message={errors.confirmPassword} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="agreeToTerms"
            checked={form.agreeToTerms}
            onChange={(event) => update('agreeToTerms', event.target.checked)}
          />
          Agree to the terms
        </label>
        <FieldError message={errors.terms} />
        <FieldError message={errors.form} />
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          Create account
        </button>
      </form>
      <p className="mt-4 text-sm">
        Already have an account?{' '}
        <Link className="text-blue-700 underline" to="/signin">
          Sign in
        </Link>
      </p>
    </section>
  );
}

export function ForgotPasswordPage() {
  const [step, setStep] = useState<'email' | 'reset' | 'success'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  async function requestReset(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      const response = await apiClient.post('/auth/forgot', { email });
      setMessage(`Verification code: ${response.data.code}`);
      setStep('reset');
    } catch (requestError) {
      setErrors({ email: getErrorMessage(requestError) });
    }
  }

  async function submitReset(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      await apiClient.post('/auth/reset', { email, code, newPassword, confirmPassword });
      setStep('success');
    } catch (requestError) {
      const fieldErrors = getFieldErrors(requestError);
      setErrors(fieldErrors);
      setNewPassword('');
      setConfirmPassword('');
      if (Object.keys(fieldErrors).length === 0) {
        setErrors({ form: getErrorMessage(requestError) });
      }
    }
  }

  if (step === 'success') {
    return (
      <section className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Password updated</h1>
        <p className="mt-3 text-slate-600">You can now sign in with your new password.</p>
        <button
          type="button"
          className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          onClick={() => navigate('/signin')}
        >
          Sign in
        </button>
      </section>
    );
  }

  if (step === 'reset') {
    return (
      <section className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Reset password</h1>
        <p className="mt-2 text-sm font-semibold text-slate-800">{message}</p>
        <form className="mt-4 space-y-4" onSubmit={submitReset}>
          <div>
            <label htmlFor="reset-email" className="block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="reset-email"
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="reset-code" className="block text-sm font-medium text-slate-700">
              Verification code
            </label>
            <input
              id="reset-code"
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <FieldError message={errors.verificationCode} />
          </div>
          <div>
            <label htmlFor="reset-new-password" className="block text-sm font-medium text-slate-700">
              New password
            </label>
            <input
              id="reset-new-password"
              type="password"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <FieldError message={errors.newPassword} />
          </div>
          <div>
            <label htmlFor="reset-confirm-password" className="block text-sm font-medium text-slate-700">
              Confirm password
            </label>
            <input
              id="reset-confirm-password"
              type="password"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            <FieldError message={errors.confirmPassword} />
          </div>
          <FieldError message={errors.form} />
          <button
            type="submit"
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Reset password
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Forgot password</h1>
      <form className="mt-4 space-y-4" onSubmit={requestReset}>
        <div>
          <label htmlFor="forgot-email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="forgot-email"
            type="text"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldError message={errors.email} />
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Send reset link
        </button>
      </form>
    </section>
  );
}
