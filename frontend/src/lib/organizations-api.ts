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

export const organizationApi = {
  list: async () => (await api.get<Organization[]>("/organizations")).data,
  create: async (settings: OrganizationSettings) => (await api.post<Organization>("/organizations", settings)).data,
  get: async (id: number) => (await api.get<Organization>(`/organizations/${id}`)).data,
  update: async (id: number, settings: OrganizationSettings) => (await api.patch<Organization>(`/organizations/${id}`, settings)).data,
  members: async (id: number) => (await api.get<OrganizationMember[]>(`/organizations/${id}/members`)).data,
};
