import { http } from './client';
import type {
  BulkCreateResult,
  Dashboard,
  ImportPreview,
  ImportResult,
  JoiningList,
  Kyc,
  Member,
  MemberJoinings,
  MemberList,
  Months,
  Profile,
  PvAudit,
  PvHistory,
  PvLookup,
  SearchHit,
  Status,
  TreeNode,
  UnmappedRecord,
} from '../types/api';

export const authApi = {
  status: () => http.get<{ setupComplete: boolean }>('/api/auth/status'),
  setup: (body: {
    abNumber: string;
    name: string;
    sponsorAbNumber?: string;
    sponsorName?: string;
    proposerAbNumber?: string;
    proposerName?: string;
    password: string;
    confirmPassword: string;
  }) => http.post<{ token: string; linkedExistingMember: boolean; member: Member }>('/api/auth/setup', body),
  login: (abNumber: string, password: string) => http.post<{ token: string }>('/api/auth/login', { abNumber, password }),
  me: () => http.get<{ userId: string; lastLoginAt: string | null; createdAt: string; member: Member }>('/api/auth/me'),
  changePassword: (body: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
    http.post<{ token: string }>('/api/auth/change-password', body),
};

export const metaApi = {
  months: () => http.get<Months>('/api/meta/months'),
  dashboard: (month: string) => http.get<Dashboard>('/api/dashboard', { month }),
};

export interface MemberFilters {
  q?: string;
  status?: 'ALL' | Status;
  kyc?: 'ALL' | Kyc;
  pv?: string;
  pvMin?: string;
  pvMax?: string;
  month?: string;
  under?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export const membersApi = {
  list: (f: MemberFilters) => http.get<MemberList>('/api/members', { ...f }),
  search: (q: string) => http.get<SearchHit[]>('/api/members/search', { q }),
  profile: (ab: string, month: string) => http.get<Profile>(`/api/members/${ab}`, { month }),
  pvHistory: (ab: string) => http.get<PvHistory>(`/api/members/${ab}/pv-history`),
  pvAudit: (ab: string) => http.get<PvAudit[]>(`/api/members/${ab}/pv-audit`),
  joinings: (ab: string) => http.get<MemberJoinings>(`/api/members/${ab}/joinings`),
  create: (body: {
    abNumber: string;
    name: string;
    kycStatus: Kyc;
    status: Status;
    sponsorAbNumber: string;
    proposerAbNumber?: string | null;
  }) => http.post<{ member: Member; absorbedUnmapped: boolean }>('/api/members', body),
  update: (ab: string, body: Record<string, unknown>) => http.patch<Member>(`/api/members/${ab}`, body),
  remove: (ab: string) => http.del<{ deleted: string }>(`/api/members/${ab}`),
};

export const treeApi = {
  root: (month: string) => http.get<TreeNode>('/api/tree/root', { month }),
  node: (ab: string, month: string) => http.get<TreeNode>(`/api/tree/${ab}`, { month }),
  children: (ab: string, month: string) => http.get<TreeNode[]>(`/api/tree/${ab}/children`, { month }),
  path: (ab: string) => http.get<{ inMainNetwork: boolean; path: { abNumber: string; name: string }[] }>(`/api/tree/${ab}/path`),
};

export const pvApi = {
  lookup: (abNumber: string, month: string) => http.get<PvLookup>('/api/pv/lookup', { abNumber, month }),
  update: (abNumber: string, month: string, pv: number) =>
    http.put<{ abNumber: string; name: string; month: string; previousPv: number; currentPv: number }>('/api/pv', {
      abNumber,
      month,
      pv,
    }),
};

export const joiningsApi = {
  list: (p: { month?: string; from?: string; to?: string; proposer?: string; q?: string; includeUnmapped?: boolean }) =>
    http.get<JoiningList>('/api/joinings', p),
  months: () => http.get<string[]>('/api/joinings/months'),
  trend: (month: string, months = 12) => http.get<{ month: string; count: number }[]>('/api/joinings/trend', { month, months }),
};

export const importApi = {
  preview: (file: File, fyStartYear?: number) => {
    const fd = new FormData();
    fd.append('file', file);
    if (fyStartYear) fd.append('fyStartYear', String(fyStartYear));
    return http.form<ImportPreview>('/api/import/excel/preview', fd);
  },
  commit: (file: File, fyStartYear: number) => {
    const fd = new FormData();
    fd.append('fyStartYear', String(fyStartYear));
    fd.append('file', file);
    return http.form<ImportResult>('/api/import/excel', fd);
  },
  history: () => http.get<ImportResult[]>('/api/import/history'),
  detail: (id: string) => http.get<ImportResult>(`/api/import/${id}`),
  unmapped: (q?: string) => http.get<UnmappedRecord[]>('/api/import/unmapped', { q }),
  dismiss: (ab: string) => http.del<{ dismissed: string }>(`/api/import/unmapped/${ab}`),
  bulkCreate: (body: {
    abNumbers: string[];
    sponsorAbNumber: string;
    linkProposer: boolean;
    kycStatus: Kyc;
    status: Status;
  }) => http.post<BulkCreateResult>('/api/import/unmapped/bulk-create', body),
};
