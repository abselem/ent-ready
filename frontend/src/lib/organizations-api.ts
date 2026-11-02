import { api } from "@/lib/api";

export type OrganizationRole = "owner" | "admin" | "teacher" | "student" | "parent";
export interface OrganizationSettings {
  name: string;
  timezone: string;
  locale: "ru" | "kk";
  grading_scale: "points" | "5" | "10" | "100";
}
export interface Organization extends OrganizationSettings {
  id: number;
  role: OrganizationRole;
  created_at: string;
  updated_at: string;
}
export interface OrganizationMember {
  user_id: number;
  first_name: string;
  last_name: string;
  role: OrganizationRole;
  joined_at: string;
}

export type TransferResourceType = "group" | "lesson" | "test";
export interface TransferCandidate { id: number; title: string }
export interface TransferCandidates {
  groups: TransferCandidate[];
  lessons: TransferCandidate[];
  tests: TransferCandidate[];
  has_more: { groups: boolean; lessons: boolean; tests: boolean };
}
export interface TransferSelection { resource_type: TransferResourceType; resource_id: number }
export interface TransferPreflight {
  resource: { type: TransferResourceType; id: number; title: string };
  target_organization_id: number;
  as_of: string;
  execution_allowed: false;
  tenant_enforcement_ready: false;
  counts: { groups: number; lessons: number; tests: number; questions: number; contexts: number };
  blockers: { code: string; count: number; message: string }[];
  notice: string;
}

export const organizationApi = {
  list: async () => (await api.get<Organization[]>("/organizations")).data,
  create: async (settings: OrganizationSettings) => (await api.post<Organization>("/organizations", settings)).data,
  get: async (id: number) => (await api.get<Organization>(`/organizations/${id}`)).data,
  update: async (id: number, settings: OrganizationSettings) => (await api.patch<Organization>(`/organizations/${id}`, settings)).data,
  members: async (id: number) => (await api.get<OrganizationMember[]>(`/organizations/${id}/members`)).data,
  transferCandidates: async (id: number) => (await api.get<TransferCandidates>(`/organizations/${id}/transfers/candidates`)).data,
  transferPreflight: async (id: number, selection: TransferSelection) => (await api.post<TransferPreflight>(`/organizations/${id}/transfers/preflight`, selection)).data,
};
