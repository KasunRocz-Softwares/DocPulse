export const PROJECT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const PROJECT_ROLES = [
  "ADMIN",
  "RELEASE_MANAGER",
  "DEVELOPER",
  "REVIEWER",
  "CLIENT",
] as const;
export const RELEASE_TYPES = ["MAJOR", "MINOR", "PATCH", "HOTFIX"] as const;
export const RELEASE_CHANNELS = ["ALPHA", "BETA", "RC", "STABLE"] as const;
export const RELEASE_STATUSES = [
  "DRAFT",
  "REVIEW",
  "APPROVED",
  "PUBLISHED",
  "REJECTED",
  "UNPUBLISHED",
  "CANCELLED",
  "ARCHIVED",
] as const;
export const CHANGE_CATEGORIES = [
  "FEATURE",
  "IMPROVEMENT",
  "FIX",
  "BREAKING_CHANGE",
  "SECURITY",
  "PERFORMANCE",
  "DEPRECATION",
  "OTHER",
] as const;
export const CHANGE_VISIBILITIES = [
  "INTERNAL_ONLY",
  "PUBLIC_CANDIDATE",
] as const;
export const RELEASE_AUDIENCE_MODES = ["PUBLIC", "CLIENTS"] as const;
export const ENVIRONMENT_NAMES = [
  "DEVELOPMENT",
  "QA",
  "STAGING",
  "BETA",
  "ENTERPRISE",
  "CANARY",
  "PRODUCTION",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProjectRole = (typeof PROJECT_ROLES)[number];
export type ReleaseType = (typeof RELEASE_TYPES)[number];
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];
export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number];
export type ChangeVisibility = (typeof CHANGE_VISIBILITIES)[number];
export type ReleaseAudienceMode = (typeof RELEASE_AUDIENCE_MODES)[number];
export type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

export type EntityId = string;
export type ISODateTime = string;
export type SemanticVersion = string;

export interface PageQuery {
  page: number;
  pageSize: number;
  q?: string;
}

export interface PageResult<T> {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  results: T[];
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
}

export interface ApiErrorEnvelope {
  error: ApiError;
}

export interface Project {
  id: EntityId;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  status: ProjectStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Release {
  id: EntityId;
  projectId: EntityId;
  version: SemanticVersion;
  title: string;
  type: ReleaseType;
  channel: ReleaseChannel;
  status: ReleaseStatus;
  releaseDate: ISODateTime | null;
  internalSummary: string | null;
  publicSummary: string | null;
  audienceMode: ReleaseAudienceMode;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ReleaseChange {
  id: EntityId;
  releaseId: EntityId;
  title: string;
  category: ChangeCategory;
  internalDescription: string;
  publicDescription: string | null;
  visibility: ChangeVisibility;
  sortOrder: number;
  authorId: EntityId;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface CreateProjectInput {
  name: string;
  slug: string;
  description?: string;
}

export interface CreateReleaseInput {
  version: SemanticVersion;
  title: string;
  type: ReleaseType;
  channel?: ReleaseChannel;
  releaseDate?: ISODateTime;
  internalSummary?: string;
}

export interface CreateChangeInput {
  title: string;
  category: ChangeCategory;
  internalDescription: string;
  publicDescription?: string;
}
