// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  QRehearsalDto,
  RehearsalVideoSessionDto,
} from "@capital-q/contracts";

const recovery = vi.hoisted(() => ({ read: vi.fn() }));
const api = vi.hoisted(() => ({
  get: vi.fn(),
  video: vi.fn(),
  start: vi.fn(),
  finish: vi.fn(),
}));
vi.mock("@capital-q/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@capital-q/api-client")>()),
  getRehearsal: api.get,
  getRehearsalVideo: api.video,
  startRehearsalVideo: api.start,
  finishRehearsal: api.finish,
}));
const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, refresh: navigation.refresh }),
  redirect: navigation.redirect,
}));
vi.mock("@/features/q/context", () => ({
  qApiSession: () =>
    Promise.resolve({
      baseUrl: "https://q-api.example",
      accessToken: "fake-token",
    }),
}));
vi.mock("@/features/rehearsal/rehearsal-actions", () => ({
  endRehearsalVideoAction: vi.fn(),
  readRehearsalRoomAction: recovery.read,
}));
vi.mock("@/features/rehearsal/rehearsal-room", () => ({
  RehearsalRoom: ({ initial }: { initial: QRehearsalDto }) => (
    <p>Voice room {initial.id}</p>
  ),
}));
vi.mock("@/components/app-shell/page-container", () => ({
  PageContainer: ({ children }: { children: ReactNode }) => children,
}));

import { ApiProblemError } from "@capital-q/api-client";
import { readRehearsalRoom } from "@/features/rehearsal/read-rehearsal-room";
import { RehearsalLive } from "@/features/rehearsal/rehearsal-live";
import LivePage from "../app/(app)/rehearsals/live/[rehearsalId]/page";
import ReviewPage from "../app/(app)/rehearsals/r/[rehearsalId]/page";

const ID = "e0000000-0000-4000-8000-000000000001";
const session = { baseUrl: "https://q-api.example", accessToken: "fake-token" };
const rehearsal: QRehearsalDto = {
  id: ID,
  counterpart: {
    kind: "INVESTOR_ORGANISATION",
    id: "f0000000-0000-4000-8000-000000000001",
    name: "Fund One",
  },
  userRole: "FOUNDER",
  status: "ACTIVE",
  outcome: null,
  meetingId: null,
  voice: "MALE",
  difficulty: "REALISTIC",
  metrics: {
    yourShareOfWords: 0,
    longestAnswerWords: 0,
    exchanges: 0,
    minutes: 0,
  },
  previousScore: null,
  persona: { summary: "", style: "", priorities: [], grounding: "SOME" },
  turns: [],
  review: null,
  createdAt: "2026-10-13T00:00:00.000Z",
  endedAt: null,
};
const video: RehearsalVideoSessionDto = {
  id: "a0000000-0000-4000-8000-000000000001",
  rehearsalId: ID,
  interviewer: {
    id: "partner-steve",
    name: "Steve",
    style: "Calm",
    available: true,
  },
  status: "LIVE",
  joinUrl: "https://tavus.daily.co/existing-room?t=synthetic-room-token",
  startedAt: new Date().toISOString(),
  endsAt: new Date(Date.now() + 180_000).toISOString(),
  maxSeconds: 180,
  endedReason: null,
  disclosure: "AI rehearsal of Fund One. Not the real person.",
};
const params = Promise.resolve({ rehearsalId: ID });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("durable authorized browser recovery", () => {
  it("refresh reads the same canonical rehearsal and private room without allocating or finishing", async () => {
    api.get.mockResolvedValue(rehearsal);
    api.video.mockResolvedValue(video);
    const first = await readRehearsalRoom(session, ID);
    const refreshed = await readRehearsalRoom(session, ID);
    expect(refreshed).toEqual(first);
    expect(api.get).toHaveBeenNthCalledWith(2, session, ID);
    expect(api.video).toHaveBeenNthCalledWith(2, session, ID);
    const html = renderToStaticMarkup(await LivePage({ params }));
    expect(html).toContain("existing-room?t=synthetic-room-token");
    expect(api.start).not.toHaveBeenCalled();
    expect(api.finish).not.toHaveBeenCalled();
  });

  it("renders the recovered private room and preserves voice continuation on refresh", () => {
    render(<RehearsalLive initialRehearsal={rehearsal} initialVideo={video} />);
    expect(
      screen.getByTitle(/Video rehearsal with Fund One/u).getAttribute("src"),
    ).toBe(`${video.joinUrl}&name=Founder`);
    cleanup();
    render(
      <RehearsalLive
        initialRehearsal={rehearsal}
        initialVideo={{
          ...video,
          status: "ENDED",
          joinUrl: null,
          endedReason: "CONTINUED_BY_VOICE",
        }}
      />,
    );
    expect(screen.getByText(`Voice room ${ID}`)).toBeTruthy();
    expect(screen.queryByTitle(/Video rehearsal/u)).toBeNull();
  });

  it("fails closed on an unknown video read instead of falling through to voice or review", async () => {
    api.get.mockResolvedValue(rehearsal);
    api.video.mockRejectedValue(
      new ApiProblemError("unavailable", 503, "PROVIDER_UNAVAILABLE"),
    );
    await expect(readRehearsalRoom(session, ID)).rejects.toThrow("unavailable");
    const html = renderToStaticMarkup(await LivePage({ params }));
    expect(html).not.toContain("existing-room");
    expect(html).not.toContain("Voice room");
    expect(api.start).not.toHaveBeenCalled();
    expect(api.finish).not.toHaveBeenCalled();
  });

  it("does not reveal any private room when the canonical owner read is refused", async () => {
    api.get.mockRejectedValue(
      new ApiProblemError("not found", 404, "RESOURCE_NOT_FOUND"),
    );
    const html = renderToStaticMarkup(await LivePage({ params }));
    expect(html).not.toContain("existing-room");
    expect(api.video).not.toHaveBeenCalled();
  });

  it("polls the same STARTING room until its saved private link appears, without extending its deadline", async () => {
    vi.useFakeTimers();
    recovery.read.mockResolvedValue({ ok: true, value: { rehearsal, video } });
    render(
      <RehearsalLive
        initialRehearsal={rehearsal}
        initialVideo={{ ...video, joinUrl: null }}
      />,
    );
    expect(screen.getByText("Recovering your video room…")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(recovery.read).toHaveBeenCalledWith(ID);
    expect(
      screen.getByTitle(/Video rehearsal with Fund One/u).getAttribute("src"),
    ).toBe(`${video.joinUrl}&name=Founder`);
    expect(api.start).not.toHaveBeenCalled();
    expect(api.finish).not.toHaveBeenCalled();
  });

  it("waits safely when refresh precedes the video claim, then recovers the same room", async () => {
    vi.useFakeTimers();
    recovery.read
      .mockResolvedValueOnce({ ok: true, value: { rehearsal, video: null } })
      .mockResolvedValueOnce({ ok: true, value: { rehearsal, video } });
    render(
      <RehearsalLive
        initialRehearsal={rehearsal}
        initialVideo={null}
        expectsVideo
      />,
    );
    expect(screen.queryByText(`Voice room ${ID}`)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(recovery.read).toHaveBeenCalledTimes(2);
    expect(
      screen.getByTitle(/Video rehearsal with Fund One/u).getAttribute("src"),
    ).toBe(`${video.joinUrl}&name=Founder`);
    expect(api.start).not.toHaveBeenCalled();
  });

  it("bounds unknown allocation recovery and offers refresh without any new Join or silent voice switch", async () => {
    vi.useFakeTimers();
    recovery.read.mockResolvedValue({ ok: false, message: "unavailable" });
    render(
      <RehearsalLive
        initialRehearsal={rehearsal}
        initialVideo={null}
        expectsVideo
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(
      screen.getByText("We couldn't recover your video room."),
    ).toBeTruthy();
    expect(recovery.read.mock.calls.length).toBeLessThanOrEqual(60);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
    expect(screen.queryByText(`Voice room ${ID}`)).toBeNull();
    expect(screen.queryByRole("button", { name: /Join/u })).toBeNull();
    expect(api.start).not.toHaveBeenCalled();
    expect(api.finish).not.toHaveBeenCalled();
  });

  it("bounds a recovery read that never settles and ignores any opportunity to allocate", async () => {
    vi.useFakeTimers();
    recovery.read.mockImplementation(() => new Promise(() => undefined));
    render(
      <RehearsalLive
        initialRehearsal={rehearsal}
        initialVideo={null}
        expectsVideo
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(
      screen.getByText("We couldn't recover your video room."),
    ).toBeTruthy();
    expect(recovery.read).toHaveBeenCalledTimes(1);
    expect(api.start).not.toHaveBeenCalled();
    expect(api.finish).not.toHaveBeenCalled();
  });

  it("keeps FINISHED plus a STARTING/no-link video open rather than exposing review", async () => {
    api.get.mockResolvedValue({ ...rehearsal, status: "FINISHED" });
    api.video.mockResolvedValue({ ...video, joinUrl: null });
    await expect(ReviewPage({ params })).rejects.toThrow(
      `redirect:/rehearsals/live/${ID}?video=1`,
    );
    const html = renderToStaticMarkup(await LivePage({ params }));
    expect(html).toContain("Recovering your video room");
    expect(api.finish).not.toHaveBeenCalled();
  });

  it("review GET resumes ACTIVE rehearsal instead of finishing it", async () => {
    api.finish.mockResolvedValue({ ...rehearsal, status: "FINISHED" });
    api.get.mockResolvedValue(rehearsal);
    api.video.mockResolvedValue(video);
    await expect(ReviewPage({ params })).rejects.toThrow(
      `redirect:/rehearsals/live/${ID}?video=1`,
    );
    expect(api.finish).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
  });

  it("a canonical FINISHED row cannot show review while video remains physically LIVE", async () => {
    api.get.mockResolvedValue({ ...rehearsal, status: "FINISHED" });
    api.video.mockResolvedValue(video);
    await expect(ReviewPage({ params })).rejects.toThrow(
      `redirect:/rehearsals/live/${ID}?video=1`,
    );
    expect(api.finish).not.toHaveBeenCalled();
  });

  it("keeps normal active voice rehearsal resumable when the server explicitly reports no video", async () => {
    api.get.mockResolvedValue(rehearsal);
    api.video.mockRejectedValue(
      new ApiProblemError("not found", 404, "RESOURCE_NOT_FOUND"),
    );
    const html = renderToStaticMarkup(await LivePage({ params }));
    expect(html).toContain(`Voice room ${ID}`);
    expect(api.finish).not.toHaveBeenCalled();
  });
});
