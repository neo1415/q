// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  QRehearsalDto,
  RehearsalVideoSessionDto,
} from "@capital-q/contracts";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const endAction = vi.fn();
vi.mock("@/features/rehearsal/rehearsal-actions", () => ({
  endRehearsalVideoAction: (...args: unknown[]) =>
    endAction(...args) as unknown,
}));

const { RehearsalVideoStage } =
  await import("@/features/rehearsal/rehearsal-video-stage");

/** ADR 0066: the video stage shows the room, the disclosure and the way out. */

afterEach(() => {
  cleanup();
  push.mockReset();
  endAction.mockReset();
});

const REHEARSAL = {
  id: "e0000000-0000-4000-8000-000000000001",
  counterpart: {
    kind: "INVESTOR_ORGANISATION",
    id: "f0000000-0000-4000-8000-000000000001",
    name: "Fund One",
  },
  status: "ACTIVE",
} satisfies Pick<QRehearsalDto, "id" | "counterpart" | "status">;

function session(
  overrides: Partial<RehearsalVideoSessionDto> = {},
): RehearsalVideoSessionDto {
  return {
    id: "a0000000-0000-4000-8000-000000000001",
    rehearsalId: REHEARSAL.id,
    interviewer: {
      id: "partner-steve",
      name: "Steve",
      style: "Calm",
      available: true,
    },
    status: "LIVE",
    joinUrl: "https://tavus.daily.co/c1?t=tok",
    startedAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 180_000).toISOString(),
    maxSeconds: 180,
    endedReason: null,
    disclosure: "AI rehearsal of Fund One. Not the real person.",
    ...overrides,
  };
}

describe("the video rehearsal stage", () => {
  it("embeds the private room with the disclosure and the time left", () => {
    render(
      <RehearsalVideoStage
        rehearsal={REHEARSAL}
        session={session()}
        onContinueByVoice={() => undefined}
      />,
    );
    const frame = screen.getByTitle(/Video rehearsal with Fund One/u);
    expect(frame.getAttribute("src")).toBe("https://tavus.daily.co/c1?t=tok");
    expect(frame.getAttribute("allow")).toContain("microphone");
    expect(screen.getByText(/Not the real person/u)).toBeTruthy();
    expect(screen.getByText(/^(3:00|2:59)$/u)).toBeTruthy();
  });

  it("ends the call and hands over to the existing review", async () => {
    endAction.mockResolvedValue({
      ok: true,
      value: {
        session: session({ status: "ENDED" }),
        rehearsal: { ...REHEARSAL, status: "FINISHED" },
      },
    });
    render(
      <RehearsalVideoStage
        rehearsal={REHEARSAL}
        session={session()}
        onContinueByVoice={() => undefined}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /End and see my review/u }),
    );
    await vi.waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/rehearsals/r/${REHEARSAL.id}`),
    );
    expect(endAction).toHaveBeenCalledWith(REHEARSAL.id, false);
  });

  it("carries on in the voice room with the same rehearsal", async () => {
    endAction.mockResolvedValue({
      ok: true,
      value: { session: session({ status: "ENDED" }), rehearsal: REHEARSAL },
    });
    const onContinue = vi.fn();
    render(
      <RehearsalVideoStage
        rehearsal={REHEARSAL}
        session={session()}
        onContinueByVoice={onContinue}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Carry on by voice/u }));
    await vi.waitFor(() => expect(onContinue).toHaveBeenCalledWith(REHEARSAL));
    expect(push).not.toHaveBeenCalled();
  });

  it("without a join link shows no room", () => {
    render(
      <RehearsalVideoStage
        rehearsal={REHEARSAL}
        session={session({ joinUrl: null })}
        onContinueByVoice={() => undefined}
      />,
    );
    expect(screen.queryByTitle(/Video rehearsal/u)).toBeNull();
    expect(screen.getByText(/can’t be rejoined/u)).toBeTruthy();
  });
});

it("removes provider media at the absolute deadline even while review saving is pending", () => {
  render(
    <RehearsalVideoStage
      rehearsal={REHEARSAL}
      session={session({ endsAt: new Date(Date.now() - 1).toISOString() })}
      onContinueByVoice={() => undefined}
    />,
  );
  expect(screen.queryByTitle(/Video rehearsal/u)).toBeNull();
  expect(screen.getByText(/Time is up/u)).toBeTruthy();
});
