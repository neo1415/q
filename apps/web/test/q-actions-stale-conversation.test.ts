import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiProblemError } from "@capital-q/api-client";

/**
 * A question asked in a conversation that is no longer the person's in
 * their current context is asked again in a fresh one (CQ-QX-005,
 * adversarial round 1 #4) — never "I couldn't find that Q conversation".
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

const OLD = "c0000000-0000-4000-8000-000000000001";
const NEW = "c0000000-0000-4000-8000-000000000002";
const RUN = "c0000000-0000-4000-8000-000000000003";

function notFound(): ApiProblemError {
  return new ApiProblemError(
    "I couldn't find that Q conversation.",
    404,
    "NOT_FOUND",
  );
}

beforeEach(() => {
  createQRun.mockReset();
});

describe("askQAction and a conversation that is no longer reachable", () => {
  it("asks again in a fresh conversation and hands back its id", async () => {
    createQRun
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce({ runId: RUN, conversationId: NEW });
    const result = await askQAction("who else invests in logistics?", OLD);
    expect(result).toEqual({
      ok: true,
      value: { runId: RUN, conversationId: NEW },
    });
    expect(createQRun).toHaveBeenCalledTimes(2);
    const [, first] = createQRun.mock.calls[0] as [
      unknown,
      { conversationId?: string },
    ];
    const [, second] = createQRun.mock.calls[1] as [
      unknown,
      { conversationId?: string },
    ];
    expect(first.conversationId).toBe(OLD);
    expect(second.conversationId).toBeUndefined();
  });

  it("sends a relationship subject as the RELATIONSHIP kind, and nothing else", async () => {
    createQRun.mockResolvedValueOnce({ runId: RUN, conversationId: NEW });
    const relationshipId = "c0000000-0000-4000-8000-000000000004";
    await askQAction("where are we?", undefined, { relationshipId });
    const [, sent] = createQRun.mock.calls[0] as [
      unknown,
      { subjects?: unknown },
    ];
    expect(sent.subjects).toEqual([{ kind: "RELATIONSHIP", relationshipId }]);
  });

  it("does not retry a new conversation that was refused", async () => {
    createQRun.mockRejectedValueOnce(notFound());
    const result = await askQAction("who else invests in logistics?");
    expect(result.ok).toBe(false);
    expect(createQRun).toHaveBeenCalledTimes(1);
  });
});
