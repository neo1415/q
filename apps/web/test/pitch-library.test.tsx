// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaAssetDto } from "@capital-q/contracts";

import * as actions from "../src/features/pitch/pitch-actions";
import { PitchLibrary } from "../src/features/pitch/pitch-library";

/**
 * The version history on "Pitch & media" (VID): it shows what the server
 * says, withdraws only after an explicit confirmation, and reports the
 * server's refusal instead of pretending the version is gone.
 */

vi.mock("../src/features/pitch/pitch-actions", () => ({
  listPitchMediaAction: vi.fn(),
  deletePitchMediaAction: vi.fn(),
  authorisePitchPlaybackAction: vi.fn(),
}));

const COMPANY = "44444444-0000-4000-8000-000000000001";
const OLD = "f0000000-0000-4000-8000-000000000001";
const NEW = "f0000000-0000-4000-8000-000000000002";

function version(overrides: Partial<MediaAssetDto>): MediaAssetDto {
  return {
    mediaAssetId: OLD,
    purpose: "FOUNDER_PITCH",
    status: "READY",
    durationSeconds: 45,
    aspectRatio: "9:16",
    playbackPolicy: "AUTHORISED",
    captionState: "AVAILABLE",
    transcriptState: "AVAILABLE",
    moderationStatus: "ALLOWED",
    replacesMediaAssetId: null,
    createdAt: "2026-09-20T09:00:00.000Z",
    readyAt: "2026-09-20T09:05:00.000Z",
    version: 5,
    ...overrides,
  };
}

const HISTORY = [
  version({
    mediaAssetId: NEW,
    replacesMediaAssetId: OLD,
    createdAt: "2026-09-24T09:00:00.000Z",
  }),
  version({ mediaAssetId: OLD }),
];

beforeEach(() => {
  vi.mocked(actions.listPitchMediaAction).mockResolvedValue({
    ok: true,
    value: HISTORY,
  });
  vi.mocked(actions.authorisePitchPlaybackAction).mockResolvedValue({
    ok: true,
    value: {
      mediaAssetId: NEW,
      playbackUrl: "https://video.example/signed/manifest.m3u8",
      posterUrl: "https://video.example/signed/poster.jpg",
      expiresAt: "2026-09-26T10:00:00.000Z",
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function rowOf(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(
    `[data-pitch-version="${id}"]`,
  );
  if (row === null) throw new Error(`no row ${id}`);
  return row;
}

describe("PitchLibrary", () => {
  it("lists every version with its standing, and says which one is published", async () => {
    render(
      <PitchLibrary
        companyId={COMPANY}
        company={null}
        refreshKey={0}
        onCurrentChanged={() => {}}
      />,
    );
    await screen.findByText("Current pitch");
    expect(within(rowOf(NEW)).getByText(/^Published\./)).toBeTruthy();
    expect(
      within(rowOf(OLD)).getByText("Replaced. Investors no longer see it."),
    ).toBeTruthy();
    expect(within(rowOf(NEW)).getByText(/Captions available/)).toBeTruthy();
    // Posters come from the owner's signed grant, one per playable version.
    await waitFor(() =>
      expect(actions.authorisePitchPlaybackAction).toHaveBeenCalledTimes(2),
    );
  });

  it("withdraws only after confirmation, then tells the page the current pitch changed", async () => {
    const onCurrentChanged = vi.fn();
    vi.mocked(actions.deletePitchMediaAction).mockResolvedValue({
      ok: true,
      value: version({ mediaAssetId: NEW, status: "DELETED" }),
    });
    render(
      <PitchLibrary
        companyId={COMPANY}
        company={null}
        refreshKey={0}
        onCurrentChanged={onCurrentChanged}
      />,
    );
    await screen.findByText("Current pitch");
    const user = userEvent.setup();
    await user.click(
      within(rowOf(NEW)).getByRole("button", { name: "Withdraw" }),
    );
    expect(actions.deletePitchMediaAction).not.toHaveBeenCalled();
    const confirm = within(rowOf(NEW)).getByRole("group", {
      name: "Confirm withdrawal",
    });
    await user.click(within(confirm).getByRole("button", { name: "Withdraw" }));
    expect(actions.deletePitchMediaAction).toHaveBeenCalledWith(COMPANY, NEW);
    await waitFor(() => expect(onCurrentChanged).toHaveBeenCalledTimes(1));
    // And the history is read again from the server.
    await waitFor(() =>
      expect(actions.listPitchMediaAction).toHaveBeenCalledTimes(2),
    );
  });

  it("reports the server's refusal and keeps the version", async () => {
    const onCurrentChanged = vi.fn();
    vi.mocked(actions.deletePitchMediaAction).mockResolvedValue({
      ok: false,
      status: 403,
      message:
        "Only someone who can edit the company profile can change its pitch.",
    });
    render(
      <PitchLibrary
        companyId={COMPANY}
        company={null}
        refreshKey={0}
        onCurrentChanged={onCurrentChanged}
      />,
    );
    await screen.findByText("Current pitch");
    const user = userEvent.setup();
    await user.click(
      within(rowOf(OLD)).getByRole("button", { name: "Withdraw" }),
    );
    const confirm = within(rowOf(OLD)).getByRole("group", {
      name: "Confirm withdrawal",
    });
    await user.click(within(confirm).getByRole("button", { name: "Withdraw" }));
    await screen.findByText(
      "Only an administrator of your organisation can withdraw a pitch.",
    );
    expect(onCurrentChanged).not.toHaveBeenCalled();
    expect(rowOf(OLD).dataset["phase"]).toBe("READY");
  });
});
