import { z } from "zod";
import { CHANGE_CATEGORIES } from "@rdps/types";

const safeWebUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:");

export const publicChangeSchema = z
  .object({
    title: z.string().min(1).max(240),
    category: z.enum(CHANGE_CATEGORIES),
    description: z.string().optional(),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();

export const publicAttachmentSchema = z
  .object({
    id: z.string().min(1),
    fileName: z.string().min(1).max(255),
    contentType: z.string().min(1).max(160),
    sizeBytes: z.string().regex(/^\d+$/),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    downloadUrl: z
      .string()
      .regex(
        /^\/projects\/[^/]+\/releases\/[^/]+\/attachments\/[^/]+\/download$/,
      ),
  })
  .strict();

export const publicReleaseSchema = z
  .object({
    projectSlug: z.string().min(2).max(80),
    projectName: z.string().min(1).max(160),
    version: z.string().min(1).max(64),
    title: z.string().min(1).max(200),
    summary: z.string().nullable(),
    primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    accentColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .nullable(),
    logoUrl: safeWebUrl.nullable(),
    locale: z.string().min(2).max(255),
    defaultLocale: z.string().min(2).max(255),
    availableLocales: z.array(z.string().min(2).max(255)).max(100).optional(),
    publishedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
    /** Release date from the approved revision; null when none was set. */
    releaseDate: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)))
      .nullable()
      .optional(),
    changes: z.array(publicChangeSchema),
    attachments: z.array(publicAttachmentSchema),
  })
  .strict();

export const publicProjectSchema = z
  .object({
    slug: z.string().min(2).max(80),
    name: z.string().min(1).max(160),
    releaseCount: z.number().int().nonnegative(),
    latestPublishedAt: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value))),
    primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    accentColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .nullable(),
    logoUrl: safeWebUrl.nullable(),
    defaultLocale: z.string().min(2).max(255),
    latestReleaseDate: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)))
      .nullable()
      .optional(),
    latestRelease: z
      .object({
        version: z.string().min(1).max(64),
        title: z.string().min(1).max(200),
        summary: z.string().nullable(),
        locale: z.string().min(2).max(255),
        availableLocales: z
          .array(z.string().min(2).max(255))
          .max(100)
          .optional(),
        publishedAt: z
          .string()
          .refine((value) => !Number.isNaN(Date.parse(value))),
        releaseDate: z
          .string()
          .refine((value) => !Number.isNaN(Date.parse(value)))
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type PublicChangeDto = z.infer<typeof publicChangeSchema>;
export type PublicAttachmentDto = z.infer<typeof publicAttachmentSchema>;
export type PublicReleaseDto = z.infer<typeof publicReleaseSchema>;
export type PublicProjectDto = z.infer<typeof publicProjectSchema>;
