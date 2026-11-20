import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { resolveTxt } from "node:dns/promises";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const DOMAIN_TXT_RESOLVER = Symbol("DOMAIN_TXT_RESOLVER");
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;
type TxtResolver = (hostname: string) => Promise<string[][]>;
type DomainVerification = { tokenHash: string; expiresAt: string };
type BrandSettings = Record<string, unknown> & {
  customDomainVerification?: DomainVerification;
  customDomainVerifiedAt?: string;
};
type Actor = { id: string; isSystemAdmin: boolean };

@Injectable()
export class CustomDomainsService {
  private readonly resolveTxtRecords: TxtResolver;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(DOMAIN_TXT_RESOLVER) resolver?: TxtResolver,
  ) {
    this.resolveTxtRecords = resolver ?? resolveTxt;
  }

  async status(actor: Actor, projectId: string) {
    await this.requireProjectAdmin(actor, projectId);
    const brand = await this.prisma.projectBrand.findUnique({
      where: { projectId },
      select: { customDomain: true, settings: true },
    });
    const settings = readSettings(brand?.settings);
    return {
      domain: brand?.customDomain ?? null,
      verified: Boolean(settings.customDomainVerifiedAt && brand?.customDomain),
      verifiedAt: settings.customDomainVerifiedAt ?? null,
      challengeName: brand?.customDomain
        ? `_rdps-verification.${brand.customDomain}`
        : null,
    };
  }

  async requestVerification(
    actor: Actor,
    projectId: string,
    inputDomain: string,
  ) {
    await this.requireProjectAdmin(actor, projectId);
    const domain = normalizeDomain(inputDomain);
    const challenge = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    const verification: DomainVerification = {
      tokenHash: this.hash(challenge),
      expiresAt: expiresAt.toISOString(),
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.projectBrand.findUnique({
          where: { projectId },
          select: { settings: true },
        });
        const settings = readSettings(existing?.settings);
        const nextSettings: BrandSettings = {
          ...settings,
          customDomainVerification: verification,
        };
        delete nextSettings.customDomainVerifiedAt;
        await tx.projectBrand.upsert({
          where: { projectId },
          create: {
            projectId,
            customDomain: domain,
            settings: toJson(nextSettings),
          },
          update: { customDomain: domain, settings: toJson(nextSettings) },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            projectId,
            action: "project.custom_domain_verification_requested",
            entityType: "project_brand",
            metadata: { domain, expiresAt: expiresAt.toISOString() },
          },
        });
      });
    } catch (error) {
      if (isPrismaCode(error, "P2002"))
        throw new ConflictException(
          "This custom domain is already assigned to another project",
        );
      throw error;
    }
    return {
      domain,
      verified: false,
      expiresAt: expiresAt.toISOString(),
      txtRecord: {
        name: `_rdps-verification.${domain}`,
        value: `rdps-verification=${challenge}`,
      },
    };
  }

  async verify(actor: Actor, projectId: string) {
    await this.requireProjectAdmin(actor, projectId);
    const brand = await this.prisma.projectBrand.findUnique({
      where: { projectId },
      select: { id: true, customDomain: true, settings: true },
    });
    if (!brand?.customDomain)
      throw new NotFoundException("No custom domain verification is pending");
    const expected = readSettings(brand.settings).customDomainVerification;
    const now = new Date();
    if (!expected || new Date(expected.expiresAt).getTime() <= now.getTime())
      throw new ConflictException(
        "The DNS verification challenge is missing or expired",
      );

    const recordName = `_rdps-verification.${brand.customDomain}`;
    let records: string[][];
    try {
      records = await this.resolveTxtRecords(recordName);
    } catch {
      throw new ConflictException("The required DNS TXT record was not found");
    }
    const matches = records
      .map((record) => record.join(""))
      .filter((record) => record.startsWith("rdps-verification="))
      .some((record) =>
        this.matchesHash(
          expected.tokenHash,
          record.slice("rdps-verification=".length),
        ),
      );
    if (!matches)
      throw new ConflictException(
        "The required DNS TXT record does not match this challenge",
      );

    const verifiedAt = new Date().toISOString();
    await this.prisma.$transaction(
      async (tx) => {
        const latest = await tx.projectBrand.findUnique({
          where: { id: brand.id },
          select: { customDomain: true, settings: true },
        });
        const latestSettings = readSettings(latest?.settings);
        if (
          latest?.customDomain !== brand.customDomain ||
          latestSettings.customDomainVerification?.tokenHash !==
            expected.tokenHash ||
          new Date(
            latestSettings.customDomainVerification.expiresAt,
          ).getTime() <= Date.now()
        )
          throw new ConflictException(
            "The DNS verification challenge changed or expired",
          );
        delete latestSettings.customDomainVerification;
        latestSettings.customDomainVerifiedAt = verifiedAt;
        await tx.projectBrand.update({
          where: { id: brand.id },
          data: { settings: toJson(latestSettings) },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            projectId,
            action: "project.custom_domain_verified",
            entityType: "project_brand",
            entityId: brand.id,
            metadata: { domain: brand.customDomain },
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
    return { domain: brand.customDomain, verified: true, verifiedAt };
  }

  async remove(actor: Actor, projectId: string) {
    await this.requireProjectAdmin(actor, projectId);
    return this.prisma.$transaction(async (tx) => {
      const brand = await tx.projectBrand.findUnique({
        where: { projectId },
        select: { id: true, customDomain: true, settings: true },
      });
      if (!brand?.customDomain) return { removed: false };
      const settings = readSettings(brand.settings);
      delete settings.customDomainVerification;
      delete settings.customDomainVerifiedAt;
      await tx.projectBrand.update({
        where: { id: brand.id },
        data: { customDomain: null, settings: toJson(settings) },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "project.custom_domain_removed",
          entityType: "project_brand",
          entityId: brand.id,
          metadata: { domain: brand.customDomain },
        },
      });
      return { removed: true };
    });
  }

  private async requireProjectAdmin(actor: Actor, projectId: string) {
    if (actor.isSystemAdmin) return;
    const membership = await this.prisma.projectMember.findFirst({
      where: { projectId, userId: actor.id },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException("Project not found");
    if (membership.role !== "ADMIN")
      throw new ForbiddenException("Project administrator access is required");
  }

  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private matchesHash(expectedHash: string, candidate: string) {
    const expected = Buffer.from(expectedHash, "hex");
    const actual = Buffer.from(this.hash(candidate), "hex");
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
}

function normalizeDomain(input: string): string {
  let parsed: URL;
  const trimmed = input.trim();
  try {
    parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new ConflictException("Enter a valid public domain name");
  }
  const domain = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !domain.includes(".") ||
    isIP(domain) ||
    domain === "localhost" ||
    domain.endsWith(".localhost") ||
    domain.endsWith(".local") ||
    domain.endsWith(".internal") ||
    domain.length > 253 ||
    domain
      .split(".")
      .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new ConflictException("Enter a valid public domain name");
  return domain;
}

function readSettings(value: unknown): BrandSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) } as BrandSettings;
}

function toJson(value: BrandSettings): Prisma.InputJsonObject {
  return value as unknown as Prisma.InputJsonObject;
}

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
