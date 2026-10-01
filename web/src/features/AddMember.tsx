import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { useNavigate } from 'react-router';
import { membersApi } from '../api/endpoints';
import { MemberPicker } from '../components/MemberPicker';
import { Alert, errorMessage, Field, Modal, Segmented } from '../components/ui';
import type { Kyc, Ref, Status } from '../types/api';

export interface AddPrefill {
  abNumber?: string;
  name?: string;
  sponsor?: Ref | null;
  proposer?: Ref | null;
  /** Proposer from the Smart Report — shown for reference, never used as Sponsor */
  reportProposer?: Ref | null;
  fromUnmapped?: boolean;
}

const Ctx = createContext<{ openAdd: (p?: AddPrefill) => void } | null>(null);

export function useAddMember() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAddMember outside provider');
  return c;
}

export function AddMemberProvider({ children }: { children: ReactNode }) {
  const [prefill, setPrefill] = useState<AddPrefill | null>(null);
  const openAdd = useCallback((p?: AddPrefill) => setPrefill(p ?? {}), []);
  return (
    <Ctx.Provider value={{ openAdd }}>
      {children}
      {prefill && <AddMemberDialog prefill={prefill} onClose={() => setPrefill(null)} />}
    </Ctx.Provider>
  );
}

function AddMemberDialog({ prefill, onClose }: { prefill: AddPrefill; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [abNumber, setAb] = useState(prefill.abNumber ?? '');
  const [name, setName] = useState(prefill.name ?? '');
  const [kyc, setKyc] = useState<Kyc>('OK');
  const [status, setStatus] = useState<Status>('ACTIVE');
  const [sponsor, setSponsor] = useState<Ref | null>(prefill.sponsor ?? null);
  const [proposer, setProposer] = useState<Ref | null>(prefill.proposer ?? null);
  const [touched, setTouched] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      membersApi.create({
        abNumber: abNumber.trim(),
        name: name.trim(),
        kycStatus: kyc,
        status,
        sponsorAbNumber: sponsor!.abNumber,
        proposerAbNumber: proposer?.abNumber ?? null,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries();
      onClose();
      nav(`/members/${res.member.abNumber}`);
    },
  });

  const abValid = /^\d{1,15}$/.test(abNumber.trim());
  const errors = {
    ab: !abNumber.trim() ? 'AB Number is required' : !abValid ? 'Digits only' : null,
    name: !name.trim() ? 'Name is required' : null,
    sponsor: !sponsor ? 'Select a Sponsor before placing this AB in the network.' : null,
  };
  const valid = !errors.ab && !errors.name && !errors.sponsor;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (valid) create.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={prefill.fromUnmapped ? 'Assign Sponsor & create node' : 'Add AB'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" form="add-member" type="submit" disabled={create.isPending || !sponsor}>
            {create.isPending ? 'Saving…' : prefill.fromUnmapped ? 'Create / Place AB' : 'Add AB'}
          </button>
        </>
      }
    >
      <form id="add-member" onSubmit={submit} className="grid gap-4" noValidate>
        {prefill.fromUnmapped && (
          <Alert>Report data and monthly PV already imported for this AB will be attached automatically.</Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-[minmax(0,10rem)_1fr]">
          <Field label="AB Number" htmlFor="f-ab" error={touched ? errors.ab : null}>
            <input
              id="f-ab"
              className="input num"
              inputMode="numeric"
              value={abNumber}
              onChange={(e) => setAb(e.target.value.replace(/\s/g, ''))}
              readOnly={prefill.fromUnmapped}
            />
          </Field>
          <Field label="AB Name" htmlFor="f-name" error={touched ? errors.name : null}>
            <input id="f-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>

        <Field
          label="Sponsor · tree position"
          htmlFor="f-sponsor"
          error={touched ? errors.sponsor : null}
          hint={sponsor ? 'Decides where this AB sits in the tree and whose downline PV it adds to.' : 'Select a Sponsor before placing this AB in the network.'}
        >
          <MemberPicker id="f-sponsor" value={sponsor} onChange={setSponsor} exclude={abNumber} invalid={touched && !!errors.sponsor} placeholder="Search AB / select Sponsor" />
        </Field>

        <Field
          label="Proposer · joining / introduced by"
          htmlFor="f-proposer"
          hint="Used for joining history and analytics only. It does not change tree position."
        >
          {prefill.reportProposer && (
            <p className="text-sm mb-1.5">
              Imported Proposer: <span className="font-medium">{prefill.reportProposer.name}</span>{' '}
              <span className="text-muted num">(AB {prefill.reportProposer.abNumber})</span>
              {!prefill.proposer && <span className="block text-xs text-muted">Not in the network yet — leave empty or choose another AB.</span>}
            </p>
          )}
          <MemberPicker id="f-proposer" value={proposer} onChange={setProposer} exclude={abNumber} />
        </Field>

        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <div>
            <span className="label">KYC</span>
            <Segmented label="KYC" value={kyc} onChange={setKyc} options={[{ value: 'OK', label: 'OK' }, { value: 'NOT_OK', label: 'Not OK' }]} />
          </div>
          <div>
            <span className="label">Status</span>
            <Segmented
              label="Status"
              value={status}
              onChange={setStatus}
              options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'TERMINATED', label: 'Terminated' }]}
            />
          </div>
        </div>
        {create.isError && <Alert tone="danger">{errorMessage(create.error)}</Alert>}
      </form>
    </Modal>
  );
}
