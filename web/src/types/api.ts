export type Kyc = 'OK' | 'NOT_OK';
export type Status = 'ACTIVE' | 'TERMINATED';

export interface Ref {
  abNumber: string;
  name: string;
}

export interface Member {
  id: string;
  abNumber: string;
  name: string;
  kycStatus: Kyc;
  status: Status;
  isMainLeader: boolean;
  sponsor: Ref | null;
  proposer: Ref | null;
  external: {
    sponsorAbNumber: string | null;
    sponsorName: string | null;
    proposerAbNumber: string | null;
    proposerName: string | null;
  };
  report: {
    joiningDate: string | null;
    mobile: string | null;
    city: string | null;
    district: string | null;
    state: string | null;
    proposerAbNumber: string | null;
    proposerName: string | null;
    pucHomeDelivery: boolean | null;
    displayWall: boolean | null;
    updatedAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Leg {
  index: number;
  memberId: string;
  abNumber: string;
  name: string;
  status: Status;
  kycStatus: Kyc;
  legSize: number;
  pv: number;
}

export interface PvBreakdown {
  month: string;
  selfPv: number;
  legs: Leg[];
  groupPv: number;
  totalPv: number;
}

export interface NetworkSummary {
  directLegs: number;
  totalDownline: number;
  active: number;
  terminated: number;
  kycNotOk: number;
}

export interface Profile {
  member: Member;
  depth: number | null;
  upline: Ref[];
  summary: NetworkSummary;
  pv: PvBreakdown;
  joinings: { total: number };
}

export interface PvHistory {
  legs: { index: number; memberId: string; abNumber: string; name: string }[];
  months: { month: string; selfPv: number; legs: { memberId: string; pv: number }[]; groupPv: number; totalPv: number }[];
}

export interface PvAudit {
  month: string;
  oldPv: number | null;
  newPv: number;
  source: 'EXCEL' | 'MANUAL';
  importId: string | null;
  at: string;
}

export interface TreeNode {
  abNumber: string;
  name: string;
  status: Status;
  kycStatus: Kyc;
  selfPv: number;
  totalPv: number;
  directCount: number;
  downlineCount: number;
}

export interface MemberRow {
  abNumber: string;
  name: string;
  status: Status;
  kycStatus: Kyc;
  joiningDate: string | null;
  mobile: string | null;
  city: string | null;
  district: string | null;
  sponsorAbNumber: string | null;
  sponsorName: string | null;
  pv: number;
}

export interface MemberList {
  month: string;
  page: number;
  pageSize: number;
  total: number;
  totalPv: number;
  items: MemberRow[];
}

export interface SearchHit {
  abNumber: string;
  name: string;
  status: Status;
  kycStatus: Kyc;
}

export interface Joining {
  joiningDate: string | null;
  abNumber: string;
  name: string;
  status: Status | null;
  kycStatus: Kyc | null;
  mapped: boolean;
  proposerAbNumber: string | null;
  proposerName: string | null;
  proposerInNetwork?: boolean;
}

export interface JoiningList {
  total: number;
  mappedCount: number;
  unmappedCount: number;
  items: Joining[];
  byProposer: { proposerAbNumber: string | null; proposerName: string | null; count: number }[];
}

export interface MemberJoinings {
  total: number;
  months: { month: string; count: number }[];
  items: Joining[];
}

export interface Months {
  current: string;
  latestWithData: string | null;
  available: string[];
}

export interface Dashboard {
  month: string;
  network: {
    totalMembers: number;
    downline: number;
    active: number;
    terminated: number;
    kycNotOk: number;
    directLegs: number;
    activeWithZeroPv: number;
  };
  pv: { selfPv: number; groupPv: number; totalPv: number; legs: Leg[] };
  joinings: { thisMonth: number; mapped: number; unmapped: number };
  unmappedCount: number;
  lastImport: { id: string; fileName: string; status: string; at: string; matched: number; unmapped: number } | null;
  trend: { month: string; pv: number; joinings: number }[];
}

export interface ImportIssue {
  row: number;
  abNumber?: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface ImportPreview {
  fileName: string;
  sheetName: string;
  headerRow: number;
  columns: Record<string, string>;
  fyStartYear: number;
  suggestedFyStartYear: number;
  months: { header: string; month: string; label: string; future: boolean }[];
  totalRows: number;
  validRows: number;
  matched: number;
  unmapped: number;
  invalid: number;
  duplicates: number;
  issues: ImportIssue[];
  issueCount: number;
  sample: { abNumber: string; name: string; joiningDate: string | null; proposerAbNumber: string | null; proposerName: string | null }[];
}

export interface ImportResult {
  id: string;
  fileName: string;
  fileSize: number;
  sheetName: string | null;
  fyStartYear: number;
  months: string[];
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  totalRows: number;
  matched: number;
  updated: number;
  unchanged: number;
  pvValuesChanged: number;
  proposerLinked: number;
  unmapped: number;
  newUnmapped: number;
  duplicates: number;
  invalid: number;
  errorMessage: string | null;
  issueCount: number;
  issues?: ImportIssue[];
  startedAt: string;
  finishedAt: string | null;
}

export interface UnmappedRecord {
  abNumber: string;
  name: string;
  joiningDate: string | null;
  mobile: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  proposerAbNumber: string | null;
  proposerName: string | null;
  proposerInNetwork: boolean;
  proposerPending: boolean;
  monthlyPv: Record<string, number>;
  latestPv: { month: string; pv: number } | null;
  lastSeenAt: string;
}

export interface BulkCreateResult {
  created: number;
  createdItems: { abNumber: string; name: string; sponsorAbNumber: string }[];
  skipped: { abNumber: string; reason: string }[];
}

export interface PvLookup {
  abNumber: string;
  name: string;
  status: Status;
  kycStatus: Kyc;
  month: string;
  currentPv: number;
  hasRecord: boolean;
  source: 'EXCEL' | 'MANUAL' | null;
  updatedAt: string | null;
}
