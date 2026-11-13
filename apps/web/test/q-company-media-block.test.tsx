// @vitest-environment jsdom
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Q_BLOCK_SURFACES, type QResultBlock } from "@capital-q/contracts";

/**
 * A8 (owner directive 13 Nov 2026): the company Q is talking about, with
 * its own Capital Q picture and, when they asked to watch it, its pitch --
 * in the answer and on Q's stage. The block grants nothing: the picture is
 * the gated photo route, and the pitch asks for a signed, per-reader
 * playback authorization (poster first, explicit Play).
 */

configure({ asyncUtilTimeout: 8000 });

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const authorised: { companyId: string; mediaAssetId: string }[] = [];
vi.mock("../src/features/discover/feed/action-feed-transport", () => ({
  actionPlaybackSource: (companyId: string) => (mediaAssetId: string) => {
    authorised.push({ companyId, mediaAssetId });
    return Promise.resolve({
      mediaAssetId,
      // A local sample, never a real pitch.
      playbackUrl: "https://cdn.test/sample.mp4",
      posterUrl: "https://cdn.test/poster.jpg",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
  },
}));

const { QResultBlocks } = await import("../src/features/q/q-result-blocks");
const { shownItems, stageOf } = await import("../src/features/q/shown");

const CLINICREST = "22222222-2222-4222-8222-222222222222";
const ASSET = "9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a";

type Media = Extract<QResultBlock, { kind: "COMPANY_MEDIA" }>;
const PICTURE_ONLY: Media = {
  kind: "COMPANY_MEDIA",
  companyId: CLINICREST,
  name: "Clinicrest",
  image: true,
  pitch: null,
};
const WITH_PITCH: Media = {
  ...PICTURE_ONLY,
  pitch: {
    mediaAssetId: ASSET,
    aspectRatio: "9 / 16",
    durationSeconds: 94,
    captionState: "AVAILABLE",
    title: "Clinicrest in 90 seconds",
    downloadAllowed: false,
    captionsInPicture: false,
  },
};

let play = vi.fn<() => Promise<void>>();
let reduceMotion = false;

beforeEach(() => {
  reduceMotion = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("reduce") && reduceMotion,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  authorised.length = 0;
  window.localStorage.removeItem("cq.discover.captions");
  play = vi.fn<() => Promise<void>>(() => Promise.resolve());
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: play,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
});

describe("a company's own media in Q's answer", () => {
  it("draws its picture from the gated photo route, by id, with its name as alt", () => {
    const { container } = render(<QResultBlocks blocks={[PICTURE_ONLY]} />);
    const image = container.querySelector("[data-q-company-picture]");
    expect(image?.getAttribute("src")).toBe(`/api/company-photo/${CLINICREST}`);
    expect(image?.getAttribute("alt")).toBe("Clinicrest");
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(screen.getByText("From their Capital Q profile")).toBeTruthy();
    // No player for an unasked pitch, and nothing authorised.
    expect(container.querySelector("video")).toBeNull();
    expect(authorised).toEqual([]);
  });

  it("leaves the picture out when the route says there is none (1x1)", () => {
    const { container } = render(<QResultBlocks blocks={[PICTURE_ONLY]} />);
    const image = container.querySelector("[data-q-company-picture]");
    if (image === null) throw new Error("no picture drawn");
    Object.defineProperty(image, "naturalWidth", { value: 1 });
    Object.defineProperty(image, "naturalHeight", { value: 1 });
    fireEvent.load(image);
    expect(container.querySelector("[data-q-company-picture]")).toBeNull();
  });

  it("plays the pitch through the reader's own playback authorization: poster, explicit Play, captions", async () => {
    const { container } = render(<QResultBlocks blocks={[WITH_PITCH]} />);
    const video = container.querySelector("video");
    if (video === null) throw new Error("no player drawn");
    expect(video.getAttribute("aria-label")).toBe("Pitch from Clinicrest");
    // The poster comes from a per-reader authorization, asked by company
    // and asset -- never from anything carried on the block.
    await waitFor(() =>
      expect(video.getAttribute("poster")).toBe("https://cdn.test/poster.jpg"),
    );
    expect(authorised).toContainEqual({
      companyId: CLINICREST,
      mediaAssetId: ASSET,
    });
    // Poster first: no media bytes until Play.
    expect(video.getAttribute("src")).toBeNull();
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(
      screen.getByRole("region", { name: "Clinicrest: pitch" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Clinicrest in 90 seconds · 1:34 · Captions available/u),
    ).toBeTruthy();
  });

  it("with reduced motion, still a poster and an explicit Play, never autoplay", async () => {
    reduceMotion = true;
    const { container } = render(<QResultBlocks blocks={[WITH_PITCH]} />);
    const video = container.querySelector("video");
    if (video === null) throw new Error("no player drawn");
    await waitFor(() =>
      expect(video.getAttribute("poster")).toBe("https://cdn.test/poster.jpg"),
    );
    expect(play).not.toHaveBeenCalled();
    expect(video.hasAttribute("autoplay")).toBe(false);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("is drawn in the thread and is the stage's object, titled by the company", () => {
    expect(Q_BLOCK_SURFACES.COMPANY_MEDIA).toEqual({
      thread: "OBJECT",
      stage: "OBJECT",
      drawn: true,
    });
    const message = "123e4567-e89b-12d3-a456-426614174000";
    const turns = [
      {
        kind: "PERSON",
        id: "p1",
        text: "Can I watch Clinicrest's pitch?",
        unconfirmed: false,
      },
      {
        kind: "Q",
        id: message,
        runId: `run-${message}`,
        text: "Here is Clinicrest's pitch.",
        streaming: false,
        sourceCount: 0,
        publicSources: [],
        findings: [],
        uncertainties: [],
        blocks: [WITH_PITCH],
      },
    ] as const;
    const shown = stageOf(shownItems(turns), turns).item;
    expect(shown?.id).toBe(message);
    expect(shown?.title).toBe("Clinicrest");
  });
});
