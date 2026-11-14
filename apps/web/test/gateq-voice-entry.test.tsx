// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GateqVoiceLineDto } from "@capital-q/contracts";

/**
 * The GateQ voice-only entry: the live panel's controls and captions, the
 * hand-back to typing on a failure, and that the line credential only ever
 * comes from the guest-credential action. The browser line itself (mic,
 * socket, speaker) is a double: real media is not testable here.
 */

type Action = (...args: unknown[]) => Promise<unknown>;
const actions = {
  state: vi.fn<Action>(),
  start: vi.fn<Action>(),
  end: vi.fn<Action>(),
};
vi.mock("../src/features/gateq/apply-actions", () => ({
  voiceStateAction: (...args: unknown[]) => actions.state(...args),
  startVoiceAction: (...args: unknown[]) => actions.start(...args),
  endVoiceAction: (...args: unknown[]) => actions.end(...args),
}));

const lineDouble = {
  state: "LISTENING" as string,
  captions: [] as { id: string; from: "YOU" | "Q"; text: string }[],
  muted: false,
  start: vi.fn((_line: GateqVoiceLineDto) => Promise.resolve(true)),
  stop: vi.fn(),
  setMuted: vi.fn((next: boolean) => {
    lineDouble.muted = next;
  }),
  onProblem: null as ((p: "microphone" | "connection") => void) | null,
};
vi.mock("../src/features/voice/provider/gateq-voice-line", async () => {
  const actual = await vi.importActual<
    typeof import("../src/features/voice/provider/gateq-voice-line")
  >("../src/features/voice/provider/gateq-voice-line");
  return {
    GATEQ_VOICE_PROBLEMS: actual.GATEQ_VOICE_PROBLEMS,
    useGateqVoiceLine: (events: {
      onProblem?: (p: "microphone" | "connection") => void;
    }) => {
      lineDouble.onProblem = events.onProblem ?? null;
      return lineDouble;
    },
  };
});

const { GateqVoiceEntry } =
  await import("../src/features/gateq/gateq-voice-entry");

const TOKEN = `gqs_${"c".repeat(43)}`;
const SESSION = {
  id: "8b0c2a4e-1f6d-4c3b-9a8e-2d7f5e6a1b3c",
  status: "LIVE",
  endsAt: new Date(Date.now() + 180_000).toISOString(),
  maxSeconds: 180,
  endedReason: null,
  disclosure: "Q is an AI interviewer.",
};
const LINE: GateqVoiceLineDto = {
  provider: "deepgram",
  token: "short-lived",
  agent: { greeting: "What does the company do?" },
};

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  lineDouble.state = "LISTENING";
  lineDouble.captions = [
    { id: "1", from: "Q", text: "What does the company do?" },
    { id: "2", from: "YOU", text: "We sell core banking to SACCOs." },
  ];
  lineDouble.muted = false;
  lineDouble.start.mockClear();
  lineDouble.stop.mockClear();
  actions.state.mockResolvedValue({
    ok: true,
    state: {
      available: true,
      session: null,
      unavailableReason: null,
      perApplication: 3,
      remaining: 1,
    },
  });
  actions.start.mockResolvedValue({
    ok: true,
    state: {
      available: true,
      session: SESSION,
      unavailableReason: null,
      perApplication: 3,
      remaining: 0,
      line: LINE,
    },
  });
  actions.end.mockResolvedValue({
    ok: true,
    state: {
      available: false,
      session: {
        ...SESSION,
        status: "ENDED",
        endedReason: "CONTINUED_BY_TYPING",
      },
      unavailableReason: "APPLICATION_SESSIONS_USED",
      perApplication: 3,
      remaining: 0,
    },
  });
});
afterEach(cleanup);

async function openLine(onEnded = vi.fn(() => Promise.resolve())) {
  const onLiveChange = vi.fn();
  render(
    <GateqVoiceEntry
      token={TOKEN}
      fund="Sahel Capital"
      onEnded={onEnded}
      onLiveChange={onLiveChange}
    />,
  );
  await flush();
  expect(
    screen.getByText("One voice session left for this application."),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Talk with Q" }));
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  return { onEnded, onLiveChange };
}

describe("GateQ voice entry", () => {
  it("opens the line with the credential the guest action returned, and shows a labelled live panel", async () => {
    const { onLiveChange } = await openLine();
    expect(actions.start).toHaveBeenCalledWith(TOKEN, expect.anything());
    expect(lineDouble.start).toHaveBeenCalledWith(LINE);
    expect(onLiveChange).toHaveBeenLastCalledWith(true);
    const panel = screen.getByRole("region", {
      name: "Voice interview with Q",
    });
    expect(panel).toBeTruthy();
    // Captions are a polite live log; state is announced as words.
    const log = screen.getByRole("log", { name: "Captions" });
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(log.textContent).toContain("We sell core banking to SACCOs.");
    expect(screen.getByRole("status").textContent).toContain("Listening.");
    // Mute is a toggle with its state exposed; End is always reachable.
    const mute = screen.getByRole("button", { name: "Mute" });
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(mute);
    expect(lineDouble.setMuted).toHaveBeenCalledWith(true);
    expect(
      screen.getByRole("button", { name: "End and continue by typing" }),
    ).toBeTruthy();
  });

  it("ending hands back to typing: the session ends server side and the transcript is read again", async () => {
    const { onEnded, onLiveChange } = await openLine();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "End and continue by typing" }),
      );
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(lineDouble.stop).toHaveBeenCalled();
    expect(actions.end).toHaveBeenCalledWith(TOKEN, true);
    expect(onEnded).toHaveBeenCalled();
    expect(onLiveChange).toHaveBeenLastCalledWith(false);
    expect(
      screen.queryByRole("region", { name: "Voice interview with Q" }),
    ).toBeNull();
  });

  it("a denied microphone or a dropped line says so and falls back to typing with turns preserved", async () => {
    const { onEnded } = await openLine();
    await act(async () => {
      lineDouble.onProblem?.("microphone");
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(actions.end).toHaveBeenCalledWith(TOKEN, true);
    expect(onEnded).toHaveBeenCalled();
    expect(
      screen.getByText(/Q can't hear you: the microphone isn't available/),
    ).toBeTruthy();
  });

  it("when the server refuses to open a line, it says why and never touches the microphone", async () => {
    actions.start.mockResolvedValue({
      ok: false,
      message:
        "Voice interviews are busy right now. You can continue by typing.",
    });
    await openLine();
    expect(lineDouble.start).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Voice interviews are busy right now. You can continue by typing.",
      ),
    ).toBeTruthy();
  });
});
