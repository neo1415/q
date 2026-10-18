import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateQRunRequestSchema } from "@capital-q/contracts";

import { viewingOf } from "../src/features/q/q-moment";

/**
 * Q watches the pitch with the person (R18): a question asked while a
 * pitch plays carries `viewing` -- the company, the pitch and the
 * position -- on the run request. The label never leaves the client, and
 * a malformed moment is dropped rather than failing the question.
 */

const createQRun = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock("@capital-q/api-client", async () => {
  const actual = await vi.importActual<typeof import("@capital-q/api-client")>(
    "@capital-q/api-client",
  );
  return { ...actual, createQRun: (...args: unknown[]) => createQRun(...args) };
});
vi.mock("@capital-q/config/web", () => ({
  loadWebServerConfig: () => ({ qApiBaseUrl: "http://q.test" }),
}));
vi.mock("@/auth/session", () => ({
  getSessionAccessToken: () => Promise.resolve("eyJ.token.sig"),
}));

const { askQAction } = await import("../src/features/q/actions");

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const ASSET = "a0000000-0000-4000-8000-000000000002";
const RUN = "c0000000-0000-4000-8000-000000000003";
const CONVERSATION = "c0000000-0000-4000-8000-000000000004";

beforeEach(() => {
  createQRun.mockReset();
  createQRun.mockResolvedValue({ runId: RUN, conversationId: CONVERSATION });
});

function sentBody(): unknown {
  const [, body] = createQRun.mock.calls[0] as [unknown, unknown];
  return body;
}

describe("askQAction with a pitch moment", () => {
  it("sends viewing with the company subject, in the contract's shape, without the label", async () => {
    const viewing = viewingOf({
      kind: "PITCH_MOMENT",
      companyId: COMPANY,
      companyLabel: "Kobo Logistics",
      mediaAssetId: ASSET,
      positionSeconds: 102.8,
    });
    await askQAction(
      "what did they say about unit economics?",
      undefined,
      { companyId: COMPANY },
      undefined,
      viewing,
    );

    const body = sentBody();
    expect(body).toMatchObject({
      subjects: [{ kind: "COMPANY", companyId: COMPANY }],
      viewing: {
        kind: "PITCH_PLAYBACK",
        companyId: COMPANY,
        mediaAssetId: ASSET,
        positionSeconds: 102,
      },
    });
    expect(JSON.stringify(body)).not.toContain("Kobo");
    // The strict public contract accepts it as sent.
    expect(CreateQRunRequestSchema.safeParse(body).success).toBe(true);
  });

  it("drops a malformed moment and still asks", async () => {
    const result = await askQAction("hello", undefined, undefined, undefined, {
      kind: "PITCH_PLAYBACK",
      companyId: "nope",
      positionSeconds: -3,
    });
    expect(result.ok).toBe(true);
    expect(sentBody()).not.toHaveProperty("viewing");
  });

  it("sends no viewing when there is none", async () => {
    await askQAction("hello");
    expect(sentBody()).not.toHaveProperty("viewing");
  });

  it("clamps a position to the contract's bound", () => {
    expect(
      viewingOf({
        kind: "PITCH_MOMENT",
        companyId: COMPANY,
        companyLabel: "x",
        mediaAssetId: ASSET,
        positionSeconds: 99_999,
      }).positionSeconds,
    ).toBe(7200);
  });
});
