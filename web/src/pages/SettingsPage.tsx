import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { authApi } from '../api/endpoints';
import { Alert, errorMessage, Field, PageHeader, Section } from '../components/ui';
import { useAuth } from '../hooks/useAuth';

export function SettingsPage() {
  const { leader, signIn, signOut } = useAuth();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const change = useMutation({
    mutationFn: () => authApi.changePassword(f),
    onSuccess: (r) => {
      signIn(r.token);
      setF({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
  });
  const mismatch = f.confirmPassword && f.newPassword !== f.confirmPassword;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="max-w-2xl grid gap-5">
      <PageHeader title="Account" description="The Main Leader is the only login. Other ABs are members only." />
      {leader && (
        <Section title="Main Leader">
          <p className="font-semibold text-lg">{leader.name}</p>
          <p className="text-sm text-muted num">AB {leader.abNumber}</p>
          <p className="text-sm mt-3">
            Upline sponsor:{' '}
            {leader.external.sponsorAbNumber ? `${leader.external.sponsorName ?? ''} (${leader.external.sponsorAbNumber})` : 'not set'}
            <br />
            Upline proposer:{' '}
            {leader.external.proposerAbNumber ? `${leader.external.proposerName ?? ''} (${leader.external.proposerAbNumber})` : 'not set'}
          </p>
          <Link to={`/members/${leader.abNumber}`} className="inline-block mt-3 text-sm font-medium text-leaf">
            Open my profile to edit these
          </Link>
        </Section>
      )}
      <Section title="Change password" description="Other devices will be logged out.">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!mismatch && f.newPassword.length >= 8) change.mutate();
          }}
        >
          <Field label="Current password" htmlFor="cp">
            <input id="cp" type="password" className="input" autoComplete="current-password" value={f.currentPassword} onChange={set('currentPassword')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New password" htmlFor="np" hint="At least 8 characters">
              <input id="np" type="password" className="input" autoComplete="new-password" value={f.newPassword} onChange={set('newPassword')} />
            </Field>
            <Field label="Confirm new password" htmlFor="np2" error={mismatch ? 'Passwords do not match' : null}>
              <input id="np2" type="password" className="input" autoComplete="new-password" value={f.confirmPassword} onChange={set('confirmPassword')} />
            </Field>
          </div>
          {change.isError && <Alert tone="danger">{errorMessage(change.error)}</Alert>}
          {change.isSuccess && <Alert tone="success">Password changed.</Alert>}
          <div className="flex justify-end">
            <button className="btn-primary" disabled={change.isPending || !f.currentPassword || f.newPassword.length < 8 || !!mismatch}>
              {change.isPending ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>
      </Section>
      <button className="btn-danger justify-self-start" onClick={signOut}>
        Log out
      </button>
    </div>
  );
}
