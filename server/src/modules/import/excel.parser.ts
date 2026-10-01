/**
 * Smart Report parser.
 *
 * Built against the actual RCM Smart Report layout (one sheet, header in row 1):
 *
 *   A.B. Id | Feeding Date | Name | Mobile | City | District | State | Proposer |
 *   Proposer Name | PUC Home Delivery | Display Wall | April | May | June | July |
 *   August | September | Total
 *
 * - Columns are located by header text, not position, so re-ordered columns or
 *   extra month columns (October..March) are handled.
 * - Month columns carry no year; the caller maps them with a financial year.
 * - "Feeding Date" is the Joining Date.
 * - "Total" is only used to cross-check the month columns; it is never stored.
 * - Cell values are treated as untrusted input. Formulas are never evaluated;
 *   only the cached value saved in the file is read.
 */
import ExcelJS from 'exceljs';
import { normalizeAbNumber } from '../../lib/abNumber.js';
import { monthFromHeader } from '../../lib/months.js';

export type FieldKey =
  | 'abNumber'
  | 'joiningDate'
  | 'name'
  | 'mobile'
  | 'city'
  | 'district'
  | 'state'
  | 'proposerAbNumber'
  | 'proposerName'
  | 'pucHomeDelivery'
  | 'displayWall'
  | 'total';

/** Normalised header text -> field. Normalisation lowercases and drops non-alphanumerics. */
const HEADER_ALIASES: Record<string, FieldKey> = {
  abid: 'abNumber',
  abno: 'abNumber',
  abnumber: 'abNumber',
  feedingdate: 'joiningDate',
  joiningdate: 'joiningDate',
  name: 'name',
  abname: 'name',
  mobile: 'mobile',
  mobileno: 'mobile',
  city: 'city',
  district: 'district',
  state: 'state',
  proposer: 'proposerAbNumber',
  proposerid: 'proposerAbNumber',
  proposerno: 'proposerAbNumber',
  proposername: 'proposerName',
  puchomedelivery: 'pucHomeDelivery',
  displaywall: 'displayWall',
  total: 'total',
  totalpv: 'total',
};

const REQUIRED: FieldKey[] = ['abNumber', 'name'];

export interface ParsedRow {
  rowNumber: number;
  abNumber: string;
  name: string;
  joiningDate: Date | null;
  mobile: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  proposerAbNumber: string | null;
  proposerName: string | null;
  pucHomeDelivery: boolean | null;
  displayWall: boolean | null;
  /** month number (1-12) -> Self PV; months with blank cells are absent */
  pv: Map<number, number>;
}

export interface ParseIssue {
  row: number;
  abNumber?: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface ParseResult {
  sheetName: string;
  headerRow: number;
  columns: Partial<Record<FieldKey, string>>;
  monthColumns: { header: string; month: number }[];
  rows: ParsedRow[];
  totalRows: number;
  invalidRows: number;
  duplicateRows: number;
  issues: ParseIssue[];
}

export class ExcelFormatError extends Error {}

const MAX_ROWS = 100_000;

const normHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Reduce an ExcelJS cell value to a primitive. Formulas: cached result only. */
function primitive(v: ExcelJS.CellValue): string | number | boolean | Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return primitive((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('formula' in v || 'sharedFormula' in v) return null;
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ('error' in v) return null;
  }
  return null;
}

function text(v: ExcelJS.CellValue, max = 200): string | null {
  const p = primitive(v);
  if (p === null) return null;
  let s: string;
  if (p instanceof Date) s = p.toISOString().slice(0, 10);
  else if (typeof p === 'number') s = Number.isInteger(p) ? String(p) : String(p);
  else s = String(p);
  // Strip control characters and collapse whitespace.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, max);
}

function yesNo(v: ExcelJS.CellValue): boolean | null {
  const s = text(v)?.toUpperCase();
  if (!s) return null;
  if (['Y', 'YES', 'TRUE', '1'].includes(s)) return true;
  if (['N', 'NO', 'FALSE', '0'].includes(s)) return false;
  return null;
}

/** Excel serial date (1900 system) -> UTC date */
function fromSerial(n: number): Date {
  return new Date(Math.round((n - 25569) * 86_400_000));
}

export function parseDateCell(v: ExcelJS.CellValue): Date | null | 'invalid' {
  const p = primitive(v);
  if (p === null || p === '') return null;
  let d: Date | null = null;
  if (p instanceof Date) d = p;
  else if (typeof p === 'number') d = p > 0 && p < 2_958_466 ? fromSerial(p) : null;
  else if (typeof p === 'string') {
    const s = p.trim();
    let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s); // dd-mm-yyyy (Indian format)
    if (m) d = new Date(Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!));
    m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s); // yyyy-mm-dd
    if (!d && m) d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
    if (!d) {
      const t = Date.parse(s);
      if (!Number.isNaN(t)) d = new Date(t);
    }
  }
  if (!d || Number.isNaN(d.getTime())) return 'invalid';
  // Keep the calendar date only.
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (out.getUTCFullYear() < 1990 || out.getUTCFullYear() > 2100) return 'invalid';
  return out;
}

export function parsePvCell(v: ExcelJS.CellValue): number | null | 'invalid' {
  const p = primitive(v);
  if (p === null || p === '') return null;
  let n: number;
  if (typeof p === 'number') n = p;
  else if (typeof p === 'string') {
    const s = p.replace(/,/g, '').trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) return 'invalid';
    n = Number(s);
  } else return 'invalid';
  if (!Number.isFinite(n) || n < 0 || n > 1e10) return 'invalid';
  return Math.round(n * 100) / 100;
}

function findHeader(ws: ExcelJS.Worksheet) {
  const limit = Math.min(ws.rowCount, 15);
  for (let r = 1; r <= limit; r++) {
    const row = ws.getRow(r);
    const cols: Partial<Record<FieldKey, number>> = {};
    const headers: Partial<Record<FieldKey, string>> = {};
    const months: { col: number; header: string; month: number }[] = [];
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const raw = text(cell.value);
      if (!raw) return;
      const key = HEADER_ALIASES[normHeader(raw)];
      if (key && cols[key] === undefined) {
        cols[key] = col;
        headers[key] = raw;
        return;
      }
      const month = monthFromHeader(raw);
      if (month && !months.some((m) => m.month === month)) months.push({ col, header: raw, month });
    });
    if (cols.abNumber !== undefined && cols.name !== undefined) return { row: r, cols, headers, months };
  }
  return null;
}

export async function parseSmartReport(buffer: Buffer): Promise<ParseResult> {
  // .xlsx files are ZIP archives — reject anything else early.
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new ExcelFormatError('The file is not a valid .xlsx workbook.');
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new ExcelFormatError('The workbook could not be read. Make sure it is an unmodified .xlsx Smart Report.');
  }

  let found: { ws: ExcelJS.Worksheet; h: NonNullable<ReturnType<typeof findHeader>> } | null = null;
  for (const ws of wb.worksheets) {
    const h = findHeader(ws);
    if (h) {
      found = { ws, h };
      break;
    }
  }
  if (!found) {
    throw new ExcelFormatError(
      'Could not find the Smart Report header row. Expected columns such as "A.B. Id" and "Name" in the first rows of a sheet.',
    );
  }
  const { ws, h } = found;
  for (const req of REQUIRED) {
    if (h.cols[req] === undefined) throw new ExcelFormatError(`Required column for ${req} is missing.`);
  }
  if (ws.rowCount - h.row > MAX_ROWS) {
    throw new ExcelFormatError(`The sheet has more than ${MAX_ROWS} rows, which is above the supported limit.`);
  }
  h.months.sort((a, b) => ((a.month + 8) % 12) - ((b.month + 8) % 12)); // April first

  const issues: ParseIssue[] = [];
  const rows: ParsedRow[] = [];
  const seen = new Map<string, number>();
  let totalRows = 0;
  let invalidRows = 0;
  let duplicateRows = 0;

  const cell = (row: ExcelJS.Row, key: FieldKey) =>
    h.cols[key] === undefined ? null : row.getCell(h.cols[key]!).value;

  for (let r = h.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row.hasValues) continue;
    // Skip rows where every cell is blank after trimming.
    let any = false;
    row.eachCell({ includeEmpty: false }, (c) => {
      if (text(c.value) !== null) any = true;
    });
    if (!any) continue;
    totalRows++;

    const rawAb = cell(row, 'abNumber');
    const abNumber = normalizeAbNumber(primitive(rawAb));
    if (!abNumber) {
      invalidRows++;
      issues.push({ row: r, severity: 'error', message: `Invalid or missing AB Number "${text(rawAb) ?? ''}" — row skipped` });
      continue;
    }
    const name = text(cell(row, 'name'), 120);
    if (!name) {
      invalidRows++;
      issues.push({ row: r, abNumber, severity: 'error', message: 'Name is missing — row skipped' });
      continue;
    }
    if (seen.has(abNumber)) {
      duplicateRows++;
      issues.push({
        row: r,
        abNumber,
        severity: 'warning',
        message: `Duplicate AB Number (first seen on row ${seen.get(abNumber)}) — this row was ignored`,
      });
      continue;
    }
    seen.set(abNumber, r);

    let joiningDate: Date | null = null;
    const jd = parseDateCell(cell(row, 'joiningDate'));
    if (jd === 'invalid') issues.push({ row: r, abNumber, severity: 'warning', message: 'Feeding Date is not a valid date — left unchanged' });
    else joiningDate = jd;

    let proposerAbNumber: string | null = null;
    const rawProp = cell(row, 'proposerAbNumber');
    if (text(rawProp)) {
      proposerAbNumber = normalizeAbNumber(primitive(rawProp));
      if (!proposerAbNumber)
        issues.push({ row: r, abNumber, severity: 'warning', message: `Proposer "${text(rawProp)}" is not a valid AB Number` });
    }

    const pv = new Map<number, number>();
    let monthSum = 0;
    for (const mc of h.months) {
      const v = parsePvCell(row.getCell(mc.col).value);
      if (v === 'invalid') {
        issues.push({
          row: r,
          abNumber,
          severity: 'warning',
          message: `${mc.header} PV "${text(row.getCell(mc.col).value)}" is not a valid non-negative number — ignored`,
        });
      } else if (v !== null) {
        pv.set(mc.month, v);
        monthSum += v;
      }
    }
    const total = parsePvCell(cell(row, 'total'));
    if (typeof total === 'number' && Math.abs(total - monthSum) > 0.01) {
      issues.push({
        row: r,
        abNumber,
        severity: 'warning',
        message: `Total (${total}) does not equal the sum of the month columns (${Math.round(monthSum * 100) / 100})`,
      });
    }

    rows.push({
      rowNumber: r,
      abNumber,
      name,
      joiningDate,
      mobile: text(cell(row, 'mobile'), 20),
      city: text(cell(row, 'city'), 100),
      district: text(cell(row, 'district'), 100),
      state: text(cell(row, 'state'), 100),
      proposerAbNumber,
      proposerName: text(cell(row, 'proposerName'), 120),
      pucHomeDelivery: yesNo(cell(row, 'pucHomeDelivery')),
      displayWall: yesNo(cell(row, 'displayWall')),
      pv,
    });
  }

  return {
    sheetName: ws.name,
    headerRow: h.row,
    columns: h.headers,
    monthColumns: h.months.map((m) => ({ header: m.header, month: m.month })),
    rows,
    totalRows,
    invalidRows,
    duplicateRows,
    issues,
  };
}
