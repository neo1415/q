// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CompanyDtoSchema, type MediaAssetDto } from "@capital-q/contracts";

import * as actions from "../src/features/pitch/pitch-actions";
import { PitchUpload } from "../src/features/pitch/pitch-upload";
import {
  awaitingReview,
  type PitchFlowState,
} from "../src/features/pitch/pitch-state";

/**
 * CQ-MLV-003: the founder's first "Let investors play this pitch" after an
 * upload reached READY was refused with "The pitch changed since this page
 * was opened". The platform's review lands just after READY and moves the
 * record's version; the page had stopped reading at READY, so it decided
 * against a stale version. Verified live on the local stack against
 * Cloudflare Stream before the fix.
 */

vi.mock("../src/features/pitch/pitch-actions", () => ({
  loadPitchOverviewAction: vi.fn(),
  createPitchAction: vi.fn(),
  createUploadSessionAction: vi.fn(),
  cancelUploadAction: vi.fn(),
  syncPitchAction: vi.fn(),
  authorisePitchPlaybackAction: vi.fn(),
  setPitchPlaybackPolicyAction: vi.fn(),
}));

const COMPANY = "44444444-0000-4000-8000-000000000001";
const ASSET = "f0000000-0000-4000-8000-000000000001";
const NOW = "2026-09-25T06:00:00.000Z";

const company = CompanyDtoSchema.parse({
  id: COMPANY,
  canonicalName: "Acme",
  legalName: null,
  slug: "acme",
  websiteUrl: null,
  foundedDate: null,
  headquartersCountry: null,
  headquartersCity: null,
  currentStageCode: null,
  primaryDescription: null,
  shortDescription: null,
  companyStatus: "active",
  marketplaceVisibility: "network_visible",
  marketplaceReadinessState: "not_assessed",
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
});

function pitch(overrides: Partial<MediaAssetDto> = {}): MediaAssetDto {
  return {
    mediaAssetId: ASSET,
    purpose: "FOUNDER_PITCH",
    status: "READY",
    durationSeconds: 45,
    aspectRatio: "9:16",
    playbackPolicy: "PRIVATE",
    captionState: "NOT_REQUESTED",
    transcriptState: "NOT_REQUESTED",
    moderationStatus: "NOT_REVIEWED",
    replacesMediaAssetId: null,
    createdAt: NOW,
    readyAt: NOW,
    version: 8,
    ...overrides,
  };
}

describe("awaitingReview", () => {
  it.each<[string, PitchFlowState, boolean]>([
    [
      "a READY pitch nobody has reviewed",
      { kind: "READY", pitch: pitch() },
      true,
    ],
    [
      "a READY pitch already allowed",
      { kind: "READY", pitch: pitch({ moderationStatus: "ALLOWED" }) },
      false,
    ],
    [
      "a READY pitch held for review",
      { kind: "READY", pitch: pitch({ moderationStatus: "PENDING" }) },
      false,
    ],
    ["no pitch at all", { kind: "EMPTY" }, false],
  ])("%s", (_label, state, expected) => {
    expect(awaitingReview(state) !== null).toBe(expected);
  });
});

describe("the founder decides against the record the platform just reviewed", () => {
  beforeEach(() => {
    // jsdom has no media queries; the screen only asks about reduced motion.
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.mocked(actions.authorisePitchPlaybackAction).mockResolvedValue({
      ok: false,
      message: "Preview is not available in this test.",
    });
    // The first read sees READY before review; every later read sees the
    // review the worker applied, one version on.
    vi.mocked(actions.loadPitchOverviewAction)
      .mockResolvedValueOnce({ ok: true, value: { company, pitch: pitch() } })
      .mockResolvedValue({
        ok: true,
        value: {
          company,
          pitch: pitch({ moderationStatus: "ALLOWED", version: 9 }),
        },
      });
    vi.mocked(actions.setPitchPlaybackPolicyAction).mockResolvedValue({
      ok: true,
      value: pitch({
        moderationStatus: "ALLOWED",
        playbackPolicy: "AUTHORISED",
        version: 10,
      }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("re-reads after READY until review lands, then publishes against that version", async () => {
    const user = userEvent.setup();
    render(<PitchUpload companyId={COMPANY} />);

    await screen.findByRole("button", {
      name: "Let investors play this pitch",
    });
    await waitFor(
      () => {
        // Mount, the preview's company read, then the review re-read.
        expect(
          vi.mocked(actions.loadPitchOverviewAction).mock.calls.length,
        ).toBeGreaterThanOrEqual(3);
      },
      { timeout: 5_000 },
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Let investors play this pitch" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    await user.click(
      screen.getByRole("button", { name: "Let investors play this pitch" }),
    );

    await waitFor(() =>
      expect(actions.setPitchPlaybackPolicyAction).toHaveBeenCalledWith(
        COMPANY,
        ASSET,
        "AUTHORISED",
        9,
      ),
    );
    await screen.findByText("Investors may play this pitch");
  });
});
