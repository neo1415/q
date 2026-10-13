// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  QRehearsalDto,
  RehearsalVideoSessionDto,
} from "@capital-q/contracts";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  video: vi.fn(),
  finish: vi.fn(),
  session: vi.fn(),
}));
vi.mock("@capital-q/api-client", async (original) => ({
  ...(await original<typeof import("@capital-q/api-client")>()),
  getRehearsal: api.get,
  getRehearsalVideo: api.video,
  finishRehearsal: api.finish,
}));
vi.mock("@/features/q/context", () => ({ qApiSession: api.session }));
vi.mock("@/components/app-shell/page-container", () => ({
  PageContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/features/rehearsal/rehearsal-active-session", () => ({
  RehearsalActiveSession: ({
    rehearsal,
    session,
  }: {
    rehearsal: QRehearsalDto;
    session: RehearsalVideoSessionDto | null;
  }) => (
    <div
      data-testid="owned-room"
      data-rehearsal={rehearsal.id}
      data-provider-room={session?.joinUrl}
      data-ends-at={session?.endsAt}
    >
      {session === null ? "Voice continuation" : "Recovered video"}
    </div>
  ),
}));
vi.mock("@/features/rehearsal/rehearsal-review", () => ({
  RehearsalReview: () => <div>Saved review</div>,
}));
const { ApiProblemError } = await import("@capital-q/api-client");
const { default: Page } =
  await import("../app/(app)/rehearsals/r/[rehearsalId]/page");
const id = "e0000000-0000-4000-8000-000000000001";
const auth = {
  baseUrl: "https://q.example.test",
  accessToken: "disabled-test-session",
};
const rehearsal = { id, status: "ACTIVE" } as QRehearsalDto;
const video = {
  id: "a0000000-0000-4000-8000-000000000001",
  rehearsalId: id,
  status: "LIVE",
  joinUrl: "https://tavus.daily.co/existing-room?t=private-test-token",
  endsAt: "2026-10-13T05:03:00.000Z",
  endedReason: null,
} as RehearsalVideoSessionDto;
beforeEach(() => {
  vi.clearAllMocks();
  api.session.mockResolvedValue(auth);
  api.get.mockResolvedValue(rehearsal);
  api.video.mockResolvedValue(video);
});
afterEach(cleanup);

describe("canonical rehearsal URL recovery", () => {
  it("recovers the same owned room and deadline on a refresh, without finishing or allocating", async () => {
    render(await Page({ params: Promise.resolve({ rehearsalId: id }) }));
    const recovered = screen.getByTestId("owned-room");
    expect(recovered.getAttribute("data-provider-room")).toBe(video.joinUrl);
    expect(recovered.getAttribute("data-ends-at")).toBe(video.endsAt);
    expect(api.get).toHaveBeenCalledWith(auth, id);
    expect(api.video).toHaveBeenCalledWith(auth, id);
    expect(api.finish).not.toHaveBeenCalled();
  });
  it("does not fetch a private room when the rehearsal is inaccessible", async () => {
    api.get.mockRejectedValue(new Error("not accessible"));
    render(await Page({ params: Promise.resolve({ rehearsalId: id }) }));
    expect(api.video).not.toHaveBeenCalled();
    expect(api.finish).not.toHaveBeenCalled();
    expect(screen.queryByTestId("owned-room")).toBeNull();
  });
  it("never finishes a potentially live provider call on a failed recovery read", async () => {
    api.video.mockRejectedValue(new Error("network unavailable"));
    render(await Page({ params: Promise.resolve({ rehearsalId: id }) }));
    expect(api.finish).not.toHaveBeenCalled();
    expect(
      screen.getByText("Q couldn’t recover this call just now."),
    ).toBeTruthy();
  });
  it("preserves the canonical voice continuation after video was explicitly ended", async () => {
    api.video.mockResolvedValue({
      ...video,
      status: "ENDED",
      joinUrl: null,
      endedReason: "CONTINUED_BY_VOICE",
    });
    render(await Page({ params: Promise.resolve({ rehearsalId: id }) }));
    expect(screen.getByText("Voice continuation")).toBeTruthy();
    expect(api.finish).not.toHaveBeenCalled();
  });
  it("still opens the ordinary voice rehearsal review when no video session exists", async () => {
    api.video.mockRejectedValue(new ApiProblemError(404, undefined));
    api.finish.mockResolvedValue({ ...rehearsal, status: "FINISHED" });
    render(await Page({ params: Promise.resolve({ rehearsalId: id }) }));
    expect(api.finish).toHaveBeenCalledWith(auth, id);
    expect(screen.getByText("Saved review")).toBeTruthy();
  });
});
