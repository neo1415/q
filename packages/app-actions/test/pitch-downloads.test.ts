import { describe, expect, it } from "vitest";

import type { CorrelationId } from "@capital-q/contracts";
import type { MediaAsset } from "@capital-q/media";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { SET_PITCH_SHARING } from "../src/index.js";
import type { AppActionPorts } from "../src/ports.js";

/**
 * ADR 0047: "make my pitch downloadable" is the pitch's own sharing choice,
 * on the same declaration (no new tool), its own audited service call, and
 * a card that says copies already saved cannot be recalled.
 */
const COMPANY = "a0000000-0000-4000-8000-000000000001";
const ASSET = "f0000000-0000-4000-8000-000000000001";
const ACTOR: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const CONTEXT = {
  actor: ACTOR,
  idempotencyKey: "k",
  correlationId: "cor_00000000-0000-4000-8000-000000000001" as CorrelationId,
  surface: "Q" as const,
};

function pitch(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: ASSET,
    ownerId: COMPANY,
    purpose: "FOUNDER_PITCH",
    status: "READY",
    title: "Seed pitch",
    audience: "INVESTORS",
    playbackPolicy: "AUTHORISED",
    downloadable: false,
    version: 4,
    ...overrides,
  } as MediaAsset;
}

function fakes(asset: MediaAsset) {
  const calls: { method: string; input: unknown }[] = [];
  const ports: AppActionPorts = {
    media: {
      listCompanyMedia: () => Promise.resolve([asset]),
      setPitchDetails: (command) => {
        calls.push({ method: "setPitchDetails", input: command.details });
        return Promise.resolve(pitch({ version: 5 }));
      },
      setPitchDownloadable: (command) => {
        calls.push({
          method: "setPitchDownloadable",
          input: {
            downloadable: command.downloadable,
            expectedVersion: command.expectedVersion,
          },
        });
        return Promise.resolve(
          pitch({ downloadable: command.downloadable, version: 6 }),
        );
      },
    },
  };
  return { ports, calls };
}

describe("pitch downloads through pitch.details.set (ADR 0047)", () => {
  it("only the download switch: one audited call, on the version Q saw", async () => {
    const { ports, calls } = fakes(pitch());
    const out = await SET_PITCH_SHARING.run(ports, CONTEXT, {
      companyId: COMPANY,
      mediaAssetId: ASSET,
      downloadable: true,
    });
    expect(out).toMatchObject({ downloadable: true });
    expect(calls).toEqual([
      {
        method: "setPitchDownloadable",
        input: { downloadable: true, expectedVersion: 4 },
      },
    ]);
  });

  it("with a sharing change too: details first, then downloads on the version they left", async () => {
    const { ports, calls } = fakes(pitch());
    await SET_PITCH_SHARING.run(ports, CONTEXT, {
      companyId: COMPANY,
      mediaAssetId: ASSET,
      audience: "NETWORK",
      playbackPolicy: "AUTHORISED",
      downloadable: false,
    });
    expect(calls.map((call) => call.method)).toEqual([
      "setPitchDetails",
      "setPitchDownloadable",
    ]);
    expect(calls[1]?.input).toEqual({
      downloadable: false,
      expectedVersion: 5,
    });
  });

  it("refuses a pitch that is not one of the company's videos, changing nothing", async () => {
    const { ports, calls } = fakes(pitch({ purpose: "COMPANY_PRODUCT_DEMO" }));
    expect(
      await SET_PITCH_SHARING.authorize(ports, CONTEXT, {
        companyId: COMPANY,
        mediaAssetId: ASSET,
        downloadable: true,
      }),
    ).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it("the approval card names the consequence in plain words", () => {
    const on = SET_PITCH_SHARING.card({
      companyId: COMPANY,
      mediaAssetId: ASSET,
      downloadable: true,
    });
    expect(on.summary).toBe("Let investors download your pitch video");
    expect(on.preview).toContain("can't be recalled");
    expect(
      SET_PITCH_SHARING.card({
        companyId: COMPANY,
        mediaAssetId: ASSET,
        downloadable: false,
      }).summary,
    ).toBe("Make your pitch video watch-only");
  });

  it("Q's tool takes 'make it downloadable' as a canonical input", async () => {
    const parsed = SET_PITCH_SHARING.tool?.input.safeParse({
      pitch: "my pitch",
      downloadable: true,
    });
    expect(parsed?.success).toBe(true);
    const canonical = await SET_PITCH_SHARING.tool?.toCanonical(
      { pitch: "my pitch", downloadable: true },
      CONTEXT,
      { ownCompanyId: () => Promise.resolve(COMPANY) },
    );
    expect(canonical).toEqual({
      companyId: COMPANY,
      mediaAssetId: "my pitch",
      downloadable: true,
    });
  });
});
