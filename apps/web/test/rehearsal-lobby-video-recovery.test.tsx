// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  QRehearsalPersonaDto,
  RehearsalInterviewersDto,
} from "@capital-q/contracts";

const actions = vi.hoisted(() => ({
  persona: vi.fn(),
  interviewers: vi.fn(),
  start: vi.fn(),
  video: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/features/rehearsal/meet-sounds", () => ({
  primeMeetSounds: vi.fn(),
}));
vi.mock("@/features/rehearsal/rehearsal-actions", () => ({
  rehearsalPersonaAction: actions.persona,
  rehearsalInterviewersAction: actions.interviewers,
  startRehearsalAction: actions.start,
  startRehearsalVideoAction: actions.video,
}));
vi.mock("@/features/rehearsal/rehearsal-room", () => ({
  RehearsalRoom: () => <p>Existing voice room</p>,
}));
vi.mock("@/features/rehearsal/rehearsal-video-stage", () => ({
  RehearsalVideoStage: () => <p>Existing video room</p>,
}));
import { RehearsalLobby } from "@/features/rehearsal/rehearsal-lobby";

const ID = "e0000000-0000-4000-8000-000000000001";
const persona: QRehearsalPersonaDto = {
  counterpart: { kind: "INVESTOR_ORGANISATION", id: ID, name: "Fund One" },
  summary: "Practice",
  style: "Calm",
  priorities: [],
  grounding: "SOME",
  stance: { leads: "THEM", forwardness: "TYPICAL", why: null },
  traits: [],
  sources: [],
  refreshedAt: "2026-10-13T00:00:00.000Z",
};
const catalogue: RehearsalInterviewersDto = {
  videoAvailable: true,
  maxSeconds: 180,
  interviewers: [
    { id: "partner-steve", name: "Steve", style: "Calm", available: true },
  ],
};

beforeEach(() => {
  actions.persona.mockResolvedValue({ ok: true, value: persona });
  actions.interviewers.mockResolvedValue({ ok: true, value: catalogue });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("video lobby admission and durable navigation", () => {
  it("keeps voice selected by default and hides video when canonical admission is absent", async () => {
    actions.interviewers.mockResolvedValue({
      ok: true,
      value: {
        ...catalogue,
        videoAvailable: false,
        interviewers: catalogue.interviewers.map((item) => ({
          ...item,
          available: false,
        })),
      },
    });
    render(<RehearsalLobby kind="INVESTOR_ORGANISATION" counterpartId={ID} />);
    await screen.findByText(/Ready to rehearse/u);
    expect(screen.queryByRole("radio", { name: /Video, up to/u })).toBeNull();
    expect(actions.video).not.toHaveBeenCalled();
  });

  it("preserves the same canonical id in a durable voice URL after confirmed video fallback", async () => {
    vi.spyOn(window.history, "replaceState").mockImplementation(
      () => undefined,
    );
    actions.start.mockResolvedValue({ ok: true, value: { id: ID } });
    actions.video.mockResolvedValue({
      ok: true,
      value: { mode: "VOICE_FALLBACK", reason: "PROVIDER_UNAVAILABLE" },
    });
    render(<RehearsalLobby kind="INVESTOR_ORGANISATION" counterpartId={ID} />);
    await screen.findByText(/Ready to rehearse/u);
    fireEvent.click(
      await screen.findByRole("radio", { name: /Video, up to/u }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Join now/u }));
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        `/rehearsals/live/${ID}?video=0`,
      ),
    );
    expect(actions.start).toHaveBeenCalledTimes(1);
    expect(actions.video).toHaveBeenCalledTimes(1);
  });

  it("persists the canonical room id before provider allocation and uses the same stable route on success", async () => {
    const history = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation(() => undefined);
    actions.start.mockResolvedValue({ ok: true, value: { id: ID } });
    actions.video.mockImplementation(() => {
      expect(history).toHaveBeenCalledWith(
        null,
        "",
        `/rehearsals/live/${ID}?video=1`,
      );
      return Promise.resolve({
        ok: true,
        value: { mode: "VIDEO", session: {} },
      });
    });
    render(<RehearsalLobby kind="INVESTOR_ORGANISATION" counterpartId={ID} />);
    await screen.findByText(/Ready to rehearse/u);
    const voice = await screen.findByRole("radio", { name: "Voice room" });
    expect((voice as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Video, up to/u }));
    fireEvent.click(screen.getByRole("button", { name: /Join now/u }));
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        `/rehearsals/live/${ID}?video=1`,
      ),
    );
    expect(actions.start).toHaveBeenCalledTimes(1);
    expect(actions.video).toHaveBeenCalledWith(ID, "partner-steve");
  });
});
