import { describe, expect, it } from "vitest";

import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { AuthorizationService } from "@capital-q/security";

import {
  createPublicIdentityService,
  type PublicIdentityRepository,
} from "../src/index.js";

/**
 * The photo and cover a card shows one audience (founder ask 2026-10-04):
 * each under its own scope, and nothing signed when both are hidden.
 */

const SUBJECT = {
  subjectType: "COMPANY",
  subjectId: "6f0c2a1e-9d1b-4c55-8a51-2f3e8b7c9d10",
} as const;

function serviceWith(card: {
  readonly status: "ACTIVE" | "REVOKED";
  readonly fieldScopes: unknown;
}) {
  let signed = 0;
  const repository = Object.assign({} as PublicIdentityRepository, {
    findCard: () =>
      Promise.resolve({
        id: "card",
        tenantId: "t",
        organisationId: "o",
        subjectType: SUBJECT.subjectType,
        subjectId: SUBJECT.subjectId,
        publicCode: "c",
        fieldScopes: card.fieldScopes,
        indexable: false,
        status: card.status,
        version: 1,
        updatedAt: new Date(0).toISOString(),
      }),
  });
  const service = createPublicIdentityService({
    sql: {} as DatabaseExecutor,
    transactions: {} as TransactionManager,
    authorization: {} as AuthorizationService,
    audit: {} as MaterialActionAuditWriter,
    subjects: { find: () => Promise.resolve(null) },
    repository,
    cardImages: () => {
      signed += 1;
      return Promise.resolve({
        photo: "https://storage.test/photo?sig=1",
        cover: "https://storage.test/cover?sig=1",
      });
    },
  });
  return { service, signedCount: () => signed };
}

describe("cardImagesFor", () => {
  it("gives a participant both images their scopes reach", async () => {
    const { service } = serviceWith({
      status: "ACTIVE",
      fieldScopes: { photo: "network_visible", cover: "network_visible" },
    });
    await expect(
      service.cardImagesFor({ subject: SUBJECT, audience: "PARTICIPANT" }),
    ).resolves.toEqual({
      photo: "https://storage.test/photo?sig=1",
      cover: "https://storage.test/cover?sig=1",
    });
  });

  it("withholds a network-only cover from the public, keeping a public photo", async () => {
    const { service } = serviceWith({
      status: "ACTIVE",
      fieldScopes: { photo: "public_external", cover: "network_visible" },
    });
    await expect(
      service.cardImagesFor({ subject: SUBJECT, audience: "PUBLIC" }),
    ).resolves.toEqual({
      photo: "https://storage.test/photo?sig=1",
      cover: null,
    });
  });

  it("signs nothing when the card shows neither image", async () => {
    const { service, signedCount } = serviceWith({
      status: "ACTIVE",
      fieldScopes: {},
    });
    await expect(
      service.cardImagesFor({ subject: SUBJECT, audience: "PARTICIPANT" }),
    ).resolves.toEqual({ photo: null, cover: null });
    expect(signedCount()).toBe(0);
  });

  it("signs nothing for a revoked card", async () => {
    const { service, signedCount } = serviceWith({
      status: "REVOKED",
      fieldScopes: { photo: "public_external", cover: "public_external" },
    });
    await expect(
      service.cardImagesFor({ subject: SUBJECT, audience: "PARTICIPANT" }),
    ).resolves.toEqual({ photo: null, cover: null });
    expect(signedCount()).toBe(0);
  });
});
