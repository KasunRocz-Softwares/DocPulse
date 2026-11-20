import { z } from "zod";
import {
  CHANGE_CATEGORIES,
  RELEASE_CHANNELS,
  RELEASE_TYPES,
} from "@rdps/types";

export const entityIdSchema = z.uuid();

export const semanticVersionSchema = z
  .string()
  .regex(
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    "Expected a semantic version",
  );

export const projectSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const paginationQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});

export const apiErrorSchema = z.strictObject({
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(1000),
  details: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().max(200).optional(),
});

export const apiErrorEnvelopeSchema = z.strictObject({ error: apiErrorSchema });

export const createProjectSchema = z.strictObject({
  name: z.string().trim().min(2).max(160),
  slug: projectSlugSchema,
  description: z.string().max(2_000).optional(),
});

export const createReleaseSchema = z.strictObject({
  projectId: entityIdSchema.optional(),
  version: semanticVersionSchema,
  title: z.string().trim().min(2).max(200),
  type: z.enum(RELEASE_TYPES),
  channel: z.enum(RELEASE_CHANNELS).optional(),
  releaseDate: z.iso.datetime({ offset: true }).optional(),
  internalSummary: z.string().max(10_000).optional(),
});

export const createChangeSchema = z.strictObject({
  title: z.string().trim().min(2).max(240),
  category: z.enum(CHANGE_CATEGORIES),
  internalDescription: z.string().min(1).max(20_000),
  publicDescription: z.string().max(10_000).optional(),
});

/** Strictly reject extra fields such as apiKey, password, token, or privateKey. */
export const releaseDocumentationInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  format: z.enum(["MARKDOWN", "RICH_TEXT"]),
  content: z.string().max(500_000),
});

export const localeSchema = z
  .string()
  .trim()
  .min(2)
  .max(16)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);

export type PaginationQueryInput = z.input<typeof paginationQuerySchema>;
export type PaginationQueryOutput = z.output<typeof paginationQuerySchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateReleaseInput = z.infer<typeof createReleaseSchema>;
export type CreateChangeInput = z.infer<typeof createChangeSchema>;
