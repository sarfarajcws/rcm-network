import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { importApi } from '../api/endpoints';
import { Alert, EmptyState, ErrorState, errorMessage, Loading, PageHeader, Section, Spinner } from '../components/ui';
import type { ImportIssue, ImportPreview, ImportResult } from '../types/api';
import { fmtDateTime, fmtInt, fyLabel } from '../utils/format';

const MAX_MB = 10;

export function ImportPage() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fy, setFy] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const preview = useMutation({
    mutationFn: ({ f, year }: { f: File; year?: number }) => importApi.preview(f, year),
    onSuccess: (p) => setFy(p.fyStartYear),
  });
  const commit = useMutation({
    mutationFn: () => importApi.commit(file!, fy!),
    onSuccess: () => qc.invalidateQueries(),
  });
  const history = useQuery({ queryKey: ['import-history'], queryFn: importApi.history });

  const choose = (f: File | undefined) => {
    setLocalError(null);
    commit.reset();
    preview.reset();
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) return setLocalError('Choose the Smart Report as an .xlsx file.');
    if (f.size > MAX_MB * 1024 * 1024) return setLocalError(`The file is larger than ${MAX_MB} MB.`);
    setFile(f);
    preview.mutate({ f });
  };

  const reset = () => {
    setFile(null);
    setFy(null);
    preview.reset();
    commit.reset();
    if (input.current) input.current.value = '';
  };

  const p = preview.data;
  const currentFy = (() => {
    const d = new Date(Date.now() + 330 * 60_000);
    return d.getUTCMonth() + 1 >= 4 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  })();
  const fyOptions = Array.from({ length: 6 }, (_, i) => currentFy - i);

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Excel import"
        description="Upload the Smart Report. Rows are matched to members by AB Number only. Sponsor and tree positions are never changed by an import."
      />

      {!commit.data && (
        <div
          className={clsx(
            'card border-dashed border-2 p-6 sm:p-10 text-center transition-colors',
            drag ? 'border-leaf bg-leaf-soft/40' : 'border-line-strong',
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            choose(e.dataTransfer.files[0]);
          }}
        >
          <FileSpreadsheet className="size-8 mx-auto text-leaf" />
          <p className="font-semibold mt-3">{file ? file.name : 'Drop the Smart Report here'}</p>
          <p className="text-sm text-muted mt-1">.xlsx, up to {MAX_MB} MB. You can upload the same month again later — PV is replaced, not added.</p>
          <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
          <button className="btn-primary mt-4" onClick={() => input.current?.click()}>
            <Upload className="size-4" /> {file ? 'Choose another file' : 'Choose file'}
          </button>
        </div>
      )}

      {localError && <Alert tone="danger">{localError}</Alert>}
      {preview.isPending && <Loading label="Reading workbook…" />}
      {preview.isError && <Alert tone="danger">{errorMessage(preview.error)}</Alert>}

      {p && !commit.data && (
        <PreviewPanel
          p={p}
          fy={fy ?? p.fyStartYear}
          fyOptions={fyOptions}
          onFy={(y) => {
            setFy(y);
            if (file) preview.mutate({ f: file, year: y });
          }}
          onImport={() => commit.mutate()}
          importing={commit.isPending}
          error={commit.isError ? errorMessage(commit.error) : null}
          onCancel={reset}
        />
      )}

      {commit.data && <ResultPanel r={commit.data} onAgain={reset} />}

      <Section title="Import history" bodyClassName="p-0 pt-2">
        {history.isLoading ? (
          <Loading />
        ) : history.isError ? (
          <ErrorState compact error={history.error} onRetry={() => history.refetch()} />
        ) : history.data!.length === 0 ? (
          <EmptyState title="No imports yet" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>File</th>
                  <th>FY</th>
                  <th className="text-right">Rows</th>
                  <th className="text-right">Matched</th>
                  <th className="text-right">Updated</th>
                  <th className="text-right">Unmapped</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.data!.map((h) => (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(h.startedAt)}</td>
                    <td className="max-w-[14rem] truncate">{h.fileName}</td>
                    <td className="num">{fyLabel(h.fyStartYear)}</td>
                    <td className="text-right num">{fmtInt(h.totalRows)}</td>
                    <td className="text-right num">{fmtInt(h.matched)}</td>
                    <td className="text-right num">{fmtInt(h.updated)}</td>
                    <td className="text-right num">{fmtInt(h.unmapped)}</td>
                    <td>
                      {h.status === 'COMPLETED' ? (
                        <span className="text-leaf-dark text-xs font-medium">Completed</span>
                      ) : h.status === 'FAILED' ? (
                        <span className="text-danger text-xs font-medium" title={h.errorMessage ?? ''}>
                          Failed
                        </span>
                      ) : (
                        <span className="text-xs text-muted">Processing</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function PreviewPanel({
  p,
  fy,
  fyOptions,
  onFy,
  onImport,
  importing,
  error,
  onCancel,
}: {
  p: ImportPreview;
  fy: number;
  fyOptions: number[];
  onFy: (y: number) => void;
  onImport: () => void;
  importing: boolean;
  error: string | null;
  onCancel: () => void;
}) {
  const futureMonths = p.months.filter((m) => m.future);
  return (
    <Section title="Check before importing" description={`Sheet “${p.sheetName}”, header on row ${p.headerRow}`}>
      <div className="grid gap-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Count label="Rows in file" value={p.totalRows} />
          <Count label="Match existing ABs" value={p.matched} tone="good" />
          <Count label="New / unmapped ABs" value={p.unmapped} tone={p.unmapped ? 'warn' : undefined} />
          <Count label="Invalid or duplicate" value={p.invalid + p.duplicates} tone={p.invalid + p.duplicates ? 'danger' : undefined} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="fy">
              Financial year of this report
            </label>
            <select id="fy" className="input" value={fy} onChange={(e) => onFy(Number(e.target.value))}>
              {fyOptions.map((y) => (
                <option key={y} value={y}>
                  FY {fyLabel(y)} (April {y} – March {y + 1})
                  {y === p.suggestedFyStartYear ? ' — suggested' : ''}
                </option>
              ))}
            </select>
            <p className="hint">The month columns have no year. Suggested from the latest Feeding Date in the file.</p>
          </div>
          <div>
            <p className="label">Month columns will be saved as</p>
            <ul className="flex flex-wrap gap-1.5">
              {p.months.map((m) => (
                <li
                  key={m.header}
                  className={clsx('rounded-full px-2.5 py-1 text-xs font-medium', m.future ? 'bg-danger-soft text-danger line-through' : 'bg-saffron-soft text-saffron-ink')}
                >
                  {m.header} → {m.label}
                </li>
              ))}
            </ul>
            {futureMonths.length > 0 && <p className="text-xs text-danger mt-1.5">Months in the future will be skipped. Check the financial year.</p>}
          </div>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Detected columns</summary>
          <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-muted">
            {Object.entries(p.columns).map(([k, v]) => (
              <li key={k}>
                <span className="text-ink">{v}</span> → {COLUMN_LABELS[k] ?? k}
              </li>
            ))}
          </ul>
        </details>

        {p.issueCount > 0 && <IssueList issues={p.issues} total={p.issueCount} />}
        {error && <Alert tone="danger">{error}</Alert>}

        <div className="flex flex-wrap gap-2 justify-end">
          <button className="btn-secondary" onClick={onCancel} disabled={importing}>
            Cancel
          </button>
          <button className="btn-primary" onClick={onImport} disabled={importing || p.validRows === 0}>
            {importing ? (
              <>
                <Spinner className="size-4 text-white" /> Importing…
              </>
            ) : (
              `Import ${fmtInt(p.validRows)} rows`
            )}
          </button>
        </div>
      </div>
    </Section>
  );
}

const COLUMN_LABELS: Record<string, string> = {
  abNumber: 'AB Number (match key)',
  joiningDate: 'Joining Date',
  name: 'Name',
  mobile: 'Mobile',
  city: 'City',
  district: 'District',
  state: 'State',
  proposerAbNumber: 'Proposer AB',
  proposerName: 'Proposer Name',
  pucHomeDelivery: 'PUC Home Delivery',
  displayWall: 'Display Wall',
  total: 'Total (checked only, not stored)',
};

function ResultPanel({ r, onAgain }: { r: ImportResult; onAgain: () => void }) {
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-leaf" /> Import complete
        </span>
      }
      description={`${r.fileName} · FY ${fyLabel(r.fyStartYear)} · ${fmtDateTime(r.finishedAt ?? r.startedAt)}`}
    >
      <div className="grid gap-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Count label="Total rows" value={r.totalRows} />
          <Count label="Matched ABs" value={r.matched} tone="good" />
          <Count label="ABs with changes" value={r.updated} />
          <Count label="Unchanged" value={r.unchanged} />
          <Count label="PV values changed" value={r.pvValuesChanged} />
          <Count label="New unmapped ABs" value={r.newUnmapped} tone={r.newUnmapped ? 'warn' : undefined} />
          <Count label="Duplicates skipped" value={r.duplicates} tone={r.duplicates ? 'danger' : undefined} />
          <Count label="Invalid rows" value={r.invalid} tone={r.invalid ? 'danger' : undefined} />
        </div>
        {r.proposerLinked > 0 && (
          <p className="text-sm text-muted">
            {r.proposerLinked} AB{r.proposerLinked === 1 ? '' : 's'} had no Proposer link; it was filled from the report. Existing links were not changed.
          </p>
        )}
        {r.unmapped > 0 && (
          <Alert tone="warn">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {fmtInt(r.unmapped)} AB{r.unmapped === 1 ? ' is' : 's are'} in the report but not in your tree. Their data is kept until you place them.
              </span>
              <Link to="/unmapped" className="btn-primary !min-h-9">
                Place unmapped ABs
              </Link>
            </div>
          </Alert>
        )}
        {r.issueCount > 0 && r.issues && <IssueList issues={r.issues} total={r.issueCount} />}
        <div className="flex justify-end">
          <button className="btn-secondary" onClick={onAgain}>
            Import another file
          </button>
        </div>
      </div>
    </Section>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'warn' | 'danger' }) {
  return (
    <div className="rounded-lg bg-paper px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className={clsx('text-xl font-semibold num', tone === 'good' && 'text-leaf-dark', tone === 'warn' && 'text-warn', tone === 'danger' && 'text-danger')}>
        {fmtInt(value)}
      </p>
    </div>
  );
}

function IssueList({ issues, total }: { issues: ImportIssue[]; total: number }) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  return (
    <details className="rounded-lg border border-line" open={errors > 0}>
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">
        {total} note{total === 1 ? '' : 's'} on rows {errors > 0 && <span className="text-danger">({errors} skipped)</span>}
      </summary>
      <ul className="max-h-72 overflow-y-auto divide-y divide-line text-sm">
        {issues.map((i, idx) => (
          <li key={idx} className="px-4 py-2 flex gap-3">
            <span className={clsx('num text-xs mt-0.5 w-14 shrink-0', i.severity === 'error' ? 'text-danger' : 'text-warn')}>Row {i.row}</span>
            <span>
              {i.abNumber && <span className="num text-muted mr-1.5">AB {i.abNumber}:</span>}
              {i.message}
            </span>
          </li>
        ))}
      </ul>
      {total > issues.length && <p className="px-4 py-2 text-xs text-muted">Showing first {issues.length} of {total}.</p>}
    </details>
  );
}
