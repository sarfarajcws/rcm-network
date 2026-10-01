import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { ApiError } from '../api/client';
import { authApi } from '../api/endpoints';
import { Alert, ErrorState, errorMessage, Field, Loading } from '../components/ui';
import { useAuth } from '../hooks/useAuth';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="hidden lg:flex flex-col justify-between bg-forest text-white p-12">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10 rounded-lg" />
          <span className="font-semibold text-lg">RCM Network</span>
        </div>
        <TreeArt />
        <p className="text-white/70 max-w-sm">
          Your sponsor tree, monthly PV by leg and every joining in one place, matched to the Smart Report by AB Number.
        </p>
      </div>
      <div className="flex items-start sm:items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <img src="/favicon.svg" alt="" className="size-9 rounded-lg" />
            <span className="font-semibold">RCM Network</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted mt-1 mb-6 text-sm">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Decorative sponsor tree with uneven leg counts — the product's subject. */
function TreeArt() {
  const legs = [
    { x: 60, kids: [20, 60, 100] },
    { x: 200, kids: [200] },
    { x: 330, kids: [270, 310, 350, 390] },
  ];
  return (
    <svg viewBox="0 0 420 260" className="w-full max-w-md" aria-hidden>
      <g stroke="rgba(255,255,255,.35)" strokeWidth="1.5" fill="none">
        {legs.map((l) => (
          <path key={l.x} d={`M210 40 V80 H${l.x} V120`} />
        ))}
        {legs.flatMap((l) => l.kids.map((k) => <path key={`${l.x}-${k}`} d={`M${l.x} 140 V170 H${k} V200`} />))}
      </g>
      <circle cx="210" cy="30" r="12" fill="#d99a1e" />
      {legs.map((l) => (
        <circle key={l.x} cx={l.x} cy="130" r="9" fill="#f5f7f4" />
      ))}
      {legs.flatMap((l) => l.kids.map((k) => <circle key={`c${l.x}-${k}`} cx={k} cy="208" r="6" fill="rgba(245,247,244,.6)" />))}
    </svg>
  );
}

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? 'text' : 'password'} className="input pr-16" />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-muted px-2 py-1">
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

function useSetupStatus() {
  return useQuery({ queryKey: ['setup-status'], queryFn: authApi.status, retry: 1 });
}

export function LoginPage() {
  const { token, signIn } = useAuth();
  const status = useSetupStatus();
  const [ab, setAb] = useState('');
  const [pw, setPw] = useState('');
  const login = useMutation({ mutationFn: () => authApi.login(ab.trim(), pw), onSuccess: (r) => signIn(r.token) });

  if (token) return <Navigate to="/" replace />;
  if (status.isLoading) return <Loading />;
  if (status.isError) return <ErrorState error={status.error} onRetry={() => status.refetch()} />;
  if (status.data && !status.data.setupComplete) return <Navigate to="/setup" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ab && pw) login.mutate();
  };

  return (
    <AuthShell title="Log in" subtitle="Main Leader access. Use your AB Number and password.">
      <form onSubmit={submit} className="grid gap-4">
        <Field label="AB Number" htmlFor="ab">
          <input id="ab" className="input num" inputMode="numeric" autoComplete="username" value={ab} onChange={(e) => setAb(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="pw">
          <PasswordInput id="pw" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        {login.isError && <Alert tone="danger">{errorMessage(login.error)}</Alert>}
        <button className="btn-primary w-full min-h-11" disabled={login.isPending || !ab || !pw}>
          {login.isPending ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </AuthShell>
  );
}

export function SetupPage() {
  const { token, signIn } = useAuth();
  const status = useSetupStatus();
  const [f, setF] = useState({
    abNumber: '',
    name: '',
    sponsorAbNumber: '',
    sponsorName: '',
    proposerAbNumber: '',
    proposerName: '',
    password: '',
    confirmPassword: '',
  });
  const [touched, setTouched] = useState(false);
  const setup = useMutation({ mutationFn: () => authApi.setup(f), onSuccess: (r) => signIn(r.token) });

  if (token) return <Navigate to="/" replace />;
  if (status.isLoading) return <Loading />;
  if (status.isError) return <ErrorState error={status.error} onRetry={() => status.refetch()} />;
  if (status.data?.setupComplete) return <Navigate to="/login" replace />;

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const digits = (v: string) => !v || /^\d{1,15}$/.test(v.trim());
  const errs = {
    abNumber: !f.abNumber ? 'AB Number is required' : !digits(f.abNumber) ? 'Digits only' : null,
    name: !f.name.trim() ? 'Name is required' : null,
    sponsorAbNumber: !digits(f.sponsorAbNumber) ? 'Digits only' : null,
    proposerAbNumber: !digits(f.proposerAbNumber) ? 'Digits only' : null,
    password: f.password.length < 8 ? 'At least 8 characters' : null,
    confirmPassword: f.confirmPassword !== f.password ? 'Passwords do not match' : null,
  };
  const valid = Object.values(errs).every((e) => !e);
  const fieldErr = (k: keyof typeof errs) => {
    if (touched && errs[k]) return errs[k];
    if (setup.error instanceof ApiError) {
      const fields = (setup.error.details as { fields?: { field: string; message: string }[] } | undefined)?.fields;
      return fields?.find((x) => x.field === k)?.message ?? null;
    }
    return null;
  };

  return (
    <AuthShell
      title="Set up your account"
      subtitle="You are the Main Leader: the top of the network and the only login. If your AB already exists in the database it is reused, never duplicated."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (valid) setup.mutate();
        }}
        className="grid gap-4"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label="AB Number" htmlFor="s-ab" error={fieldErr('abNumber')}>
            <input id="s-ab" className="input num" inputMode="numeric" value={f.abNumber} onChange={set('abNumber')} />
          </Field>
          <Field label="AB Name" htmlFor="s-name" error={fieldErr('name')}>
            <input id="s-name" className="input" autoComplete="name" value={f.name} onChange={set('name')} />
          </Field>
        </div>
        <fieldset className="grid gap-3 rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-medium">Your upline (outside this network, optional)</legend>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <Field label="Sponsor AB" htmlFor="s-sab" error={fieldErr('sponsorAbNumber')}>
              <input id="s-sab" className="input num" inputMode="numeric" value={f.sponsorAbNumber} onChange={set('sponsorAbNumber')} />
            </Field>
            <Field label="Sponsor name" htmlFor="s-sname">
              <input id="s-sname" className="input" value={f.sponsorName} onChange={set('sponsorName')} />
            </Field>
            <Field label="Proposer AB" htmlFor="s-pab" error={fieldErr('proposerAbNumber')}>
              <input id="s-pab" className="input num" inputMode="numeric" value={f.proposerAbNumber} onChange={set('proposerAbNumber')} />
            </Field>
            <Field label="Proposer name" htmlFor="s-pname">
              <input id="s-pname" className="input" value={f.proposerName} onChange={set('proposerName')} />
            </Field>
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" htmlFor="s-pw" error={fieldErr('password')} hint="At least 8 characters">
            <PasswordInput id="s-pw" autoComplete="new-password" value={f.password} onChange={set('password')} />
          </Field>
          <Field label="Confirm password" htmlFor="s-pw2" error={fieldErr('confirmPassword')}>
            <PasswordInput id="s-pw2" autoComplete="new-password" value={f.confirmPassword} onChange={set('confirmPassword')} />
          </Field>
        </div>
        {setup.isError && <Alert tone="danger">{errorMessage(setup.error)}</Alert>}
        <button className="btn-primary w-full min-h-11" disabled={setup.isPending}>
          {setup.isPending ? 'Creating account…' : 'Create account'}
        </button>
        <p className="text-sm text-muted text-center">
          Already set up? <Link to="/login" className="text-leaf font-medium">Log in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
