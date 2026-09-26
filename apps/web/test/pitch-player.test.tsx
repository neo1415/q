// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DiscoveredCompanyDto,
  PlaybackAuthorizationDto,
} from "@capital-q/contracts";

import type { FeedPreloadPolicy } from "../src/features/discover/feed/feed-state";
import {
  isPlaybackUsable,
  playbackIntentFor,
} from "../src/features/discover/player/pitch-playback";
import {
  PitchPlayer,
  pitchFrame,
} from "../src/features/discover/player/pitch-player";

/**
 * The pitch player (CQ-WEB-021).
 *
 * No real pitch exists to play: Cloudflare Stream is not subscribed on the
 * account (design/C-VIDEO-BLOCKER.md), so there is no live HLS manifest
 * and no poster. These tests therefore assert what the wrapper does with
 * the URL it is given -- which element state each controller tier
 * produces, what reduced motion changes, when audio is allowed on, and
 * when an authorization is re-requested. jsdom implements no media
 * pipeline, so `play()` is stubbed. Nothing here claims a video played.
 */

const MEDIA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
/** The pitch `company(1)` carries. */
const FIRST_PITCH_ID = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function company(n: number, withPitch = true): DiscoveredCompanyDto {
  return {
    companyId: `0000000${n}-0000-4000-8000-000000000000`,
    canonicalName: `Company ${n}`,
    websiteUrl: null,
    headquartersCountry: null,
    currentStageCode: null,
    shortDescription: null,
    reasons: [],
    reasonCodes: [],
    pitch: withPitch
      ? {
          mediaAssetId: `aaaaaaa${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
          aspectRatio: "9 / 16",
          durationSeconds: 60,
          captionState: "AVAILABLE",
        }
      : null,
  };
}

function authorization(
  overrides: Partial<PlaybackAuthorizationDto> = {},
): PlaybackAuthorizationDto {
  return {
    mediaAssetId: MEDIA_ID,
    // A local sample, never a real pitch: there is no Stream allocation.
    playbackUrl: "https://cdn.test/sample.mp4",
    posterUrl: "https://cdn.test/sample.jpg",
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    ...overrides,
  };
}

function videoIn(container: HTMLElement): HTMLVideoElement {
  const video = container.querySelector("video");
  if (video === null) throw new Error("no video element rendered");
  return video;
}

let play: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // jsdom has no media pipeline; `play()` is not implemented at all.
  play = vi.fn(() => Promise.resolve());
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
  Object.defineProperty(HTMLMediaElement.prototype, "load", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

describe("policy to element state", () => {
  it("attaches nothing and asks for nothing when the card is cold", () => {
    const intent = playbackIntentFor("NONE", { reducedMotion: false });

    expect(intent).toEqual({
      authorize: false,
      attach: false,
      preload: null,
      autoplay: false,
      requiresExplicitPlay: false,
    });
  });

  it("takes a poster without attaching a media source", () => {
    const intent = playbackIntentFor("POSTER", { reducedMotion: false });

    expect(intent.authorize).toBe(true);
    expect(intent.attach).toBe(false);
    expect(intent.preload).toBeNull();
    expect(intent.autoplay).toBe(false);
  });

  it("buffers a start without buffering a whole video", () => {
    const intent = playbackIntentFor("STARTUP_BUFFER", {
      reducedMotion: false,
    });

    expect(intent.attach).toBe(true);
    expect(intent.preload).toBe("metadata");
    expect(intent.autoplay).toBe(false);
  });

  it("plays only the active card", () => {
    const intent = playbackIntentFor("ACTIVE", { reducedMotion: false });

    expect(intent.autoplay).toBe(true);
    expect(intent.preload).toBe("auto");
    expect(intent.requiresExplicitPlay).toBe(false);
  });

  it("keeps the video under reduced motion but never starts it", () => {
    const intent = playbackIntentFor("ACTIVE", { reducedMotion: true });

    // Access is not withdrawn (ADR-001) -- the source is still attached.
    expect(intent.attach).toBe(true);
    expect(intent.autoplay).toBe(false);
    expect(intent.requiresExplicitPlay).toBe(true);
    expect(intent.preload).toBe("metadata");
  });
});

describe("playback authorization freshness", () => {
  const nowMs = Date.parse("2026-09-23T12:00:00.000Z");

  it("treats a missing authorization as unusable", () => {
    expect(isPlaybackUsable(null, nowMs)).toBe(false);
  });

  it("accepts one with time left beyond the safety margin", () => {
    const fresh = authorization({
      expiresAt: new Date(nowMs + 5 * 60_000).toISOString(),
    });
    expect(isPlaybackUsable(fresh, nowMs)).toBe(true);
  });

  it("rejects one that expires inside the margin, before it fails mid-play", () => {
    const nearlyDone = authorization({
      expiresAt: new Date(nowMs + 10_000).toISOString(),
    });
    expect(isPlaybackUsable(nearlyDone, nowMs)).toBe(false);
  });

  it("rejects an already-expired one", () => {
    const stale = authorization({
      expiresAt: new Date(nowMs - 1_000).toISOString(),
    });
    expect(isPlaybackUsable(stale, nowMs)).toBe(false);
  });
});

describe("the frame a pitch is shown in (UX2 P1)", () => {
  it("reads the ratio media stores (W:H) as a CSS ratio", () => {
    // "4:3" is what media persists and the API serves; handed to CSS as
    // it was, the browser dropped it and the frame took the video's own
    // height, pushing Save / Pass / Ask Q below a laptop's fold.
    expect(pitchFrame("4:3").aspectRatio).toBe("4 / 3");
    expect(pitchFrame("16:9").aspectRatio).toBe("16 / 9");
    expect(pitchFrame("9:16").aspectRatio).toBe("9 / 16");
  });

  it("still reads the CSS spelling", () => {
    expect(pitchFrame("9 / 16").aspectRatio).toBe("9 / 16");
  });

  it("falls back to portrait, never to no frame, when the ratio is unknown or unusable", () => {
    for (const value of [null, undefined, "", "wide", "0:9", "16:0"]) {
      expect(pitchFrame(value).aspectRatio).toBe("9 / 16");
    }
  });

  it("bounds the height by narrowing the frame, so the ratio is kept rather than cropped", () => {
    expect(pitchFrame("4:3").maxWidth).toBe(
      "min(100%, calc(var(--cq-pitch-max-height) * 4 / 3))",
    );
    expect(pitchFrame("9:16").maxWidth).toBe(
      "min(100%, calc(var(--cq-pitch-max-height) * 9 / 16))",
    );
  });

  it("puts the bounded frame on the element", () => {
    const { container } = render(
      <PitchPlayer
        company={{
          ...company(1),
          pitch: {
            mediaAssetId: MEDIA_ID,
            aspectRatio: "4:3",
            durationSeconds: 60,
            captionState: "AVAILABLE",
          },
        }}
        policy="NONE"
        authorize={vi.fn(() => Promise.resolve(authorization()))}
        reducedMotion={false}
      />,
    );
    const frame = container.querySelector<HTMLElement>("[data-pitch-frame]");
    expect(frame?.style.maxWidth).toBe(
      "min(100%, calc(var(--cq-pitch-max-height) * 4 / 3))",
    );
    expect(frame?.closest(".cq-pitch")).not.toBeNull();
  });
});

describe("the player element", () => {
  it("is muted and inline, and carries the controller's preload", async () => {
    const authorize = vi.fn(() => Promise.resolve(authorization()));
    const { container } = render(
      <PitchPlayer
        company={company(1)}
        policy="ACTIVE"
        authorize={authorize}
        reducedMotion={false}
      />,
    );

    await waitFor(() => expect(videoIn(container).poster).not.toBe(""));
    const video = videoIn(container);

    expect(video.muted).toBe(true);
    expect(video.getAttribute("playsinline")).not.toBeNull();
    expect(video.getAttribute("preload")).toBe("auto");
    expect(video.poster).toBe("https://cdn.test/sample.jpg");
  });

  it("still attaches the pitch when its effects run twice (CQ-ACCEPT-001, C7)", async () => {
    // React's development double-run cancels the first request. The
    // cancelled one used to keep the in-flight slot, so the second run
    // never asked and the card stayed an empty grey box forever.
    const authorize = vi.fn(() => Promise.resolve(authorization()));
    const { container } = render(
      <StrictMode>
        <PitchPlayer
          company={company(1)}
          policy="ACTIVE"
          authorize={authorize}
          reducedMotion={false}
        />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(videoIn(container).getAttribute("src")).toBe(
        "https://cdn.test/sample.mp4",
      ),
    );
    expect(videoIn(container).poster).toBe("https://cdn.test/sample.jpg");
  });

  it("attaches no source and requests nothing for a cold card", () => {
    const authorize = vi.fn(() => Promise.resolve(authorization()));
    const { container } = render(
      <PitchPlayer
        company={company(1)}
        policy="NONE"
        authorize={authorize}
        reducedMotion={false}
      />,
    );

    expect(authorize).not.toHaveBeenCalled();
    expect(videoIn(container).getAttribute("preload")).toBeNull();
    expect(videoIn(container).getAttribute("src")).toBeNull();
  });

  it("takes a poster for a warm card without attaching media", async () => {
    const authorize = vi.fn(() => Promise.resolve(authorization()));
    const { container } = render(
      <PitchPlayer
        company={company(1)}
        policy="POSTER"
        authorize={authorize}
        reducedMotion={false}
      />,
    );

    await waitFor(() => expect(authorize).toHaveBeenCalledTimes(1));
    const video = videoIn(container);

    expect(video.poster).toBe("https://cdn.test/sample.jpg");
    // The billable part is what must not happen.
    expect(video.getAttribute("src")).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it("puts a server-obtained poster in the server HTML without asking again", () => {
    const authorize = vi.fn(() => Promise.resolve(authorization()));
    const seed = authorization({
      mediaAssetId: FIRST_PITCH_ID,
    });
    const html = renderToString(
      <PitchPlayer
        company={company(1)}
        policy="ACTIVE"
        authorize={authorize}
        reducedMotion={false}
        variant="stage"
        initialAuthorization={seed}
      />,
    );

    // The poster is the feed's LCP, so it has to be in the first bytes.
    expect(html).toContain('poster="https://cdn.test/sample.jpg"');
    // Only the element attaches media, after hydration, never the HTML.
    expect(html).not.toContain("sample.mp4");
    expect(authorize).not.toHaveBeenCalled();
  });

  it("ignores a server authorization for a different pitch", async () => {
    const authorize = vi.fn(() =>
      Promise.resolve(authorization({ mediaAssetId: FIRST_PITCH_ID })),
    );
    render(
      <PitchPlayer
        company={company(1)}
        policy="POSTER"
        authorize={authorize}
        reducedMotion={false}
        initialAuthorization={authorization({ mediaAssetId: MEDIA_ID })}
      />,
    );

    // Someone else's URL is never shown for this company; it asks for its own.
    await waitFor(() => expect(authorize).toHaveBeenCalledTimes(1));
  });

  it("renders nothing at all for a company with no pitch", () => {
    const { container } = render(
      <PitchPlayer
        company={company(1, false)}
        policy="ACTIVE"
        authorize={vi.fn(() => Promise.resolve(authorization()))}
        reducedMotion={false}
      />,
    );

    expect(container.querySelector("video")).toBeNull();
  });

  it("says so when the authorization is refused", async () => {
    const authorize = vi.fn(() => Promise.reject(new Error("forbidden")));
    render(
      <PitchPlayer
        company={company(1)}
        policy="ACTIVE"
        authorize={authorize}
        reducedMotion={false}
      />,
    );

    expect(await screen.findByText(/could not be loaded/i)).toBeTruthy();
    expect(play).not.toHaveBeenCalled();
  });
});

describe("one active player", () => {
  it("plays exactly one card among three, whatever the others are warmed to", async () => {
    const authorize = vi.fn(() => Promise.resolve(authorization()));
    const policies: readonly FeedPreloadPolicy[] = [
      "POSTER",
      "ACTIVE",
      "STARTUP_BUFFER",
    ];

    const { container } = render(
      <>
        {policies.map((policy, index) => (
          <PitchPlayer
            key={policy}
            company={company(index + 1)}
            policy={policy}
            authorize={authorize}
            reducedMotion={false}
          />
        ))}
      </>,
    );

    await waitFor(() => expect(play).toHaveBeenCalled());

    const videos = [...container.querySelectorAll("video")];
    expect(videos).toHaveLength(3);
    // Only the ACTIVE card ever called play(), across all three.
    expect(play).toHaveBeenCalledTimes(1);
    expect(
      videos.filter((video) => video.dataset["policy"] === "ACTIVE"),
    ).toHaveLength(1);
  });
});

describe("reduced motion", () => {
  it("does not autoplay, and offers an explicit Play instead", async () => {
    const authorize = vi.fn(() => Promise.resolve(authorization()));
    render(
      <PitchPlayer
        company={company(1)}
        policy="ACTIVE"
        authorize={authorize}
        reducedMotion={true}
      />,
    );

    const playButton = await screen.findByRole("button", { name: "Play" });
    expect(play).not.toHaveBeenCalled();

    await userEvent.click(playButton);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("keeps audio off until it is explicitly enabled", async () => {
    const authorize = vi.fn(() => Promise.resolve(authorization()));
    const { container } = render(
      <PitchPlayer
        company={company(1)}
        policy="ACTIVE"
        authorize={authorize}
        reducedMotion={true}
      />,
    );

    const unmute = await screen.findByRole("button", { name: "Unmute" });
    expect(videoIn(container).muted).toBe(true);
    expect(unmute.getAttribute("aria-pressed")).toBe("false");

    await userEvent.click(unmute);

    await waitFor(() => expect(videoIn(container).muted).toBe(false));
    expect(
      screen.getByRole("button", { name: "Mute" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("authorization lifetime", () => {
  it("re-authorises for a different card rather than reusing a URL", async () => {
    const authorize = vi.fn((mediaAssetId: string) =>
      Promise.resolve(authorization({ mediaAssetId })),
    );

    const { rerender } = render(
      <PitchPlayer
        company={company(1)}
        policy="ACTIVE"
        authorize={authorize}
        reducedMotion={false}
      />,
    );
    await waitFor(() => expect(authorize).toHaveBeenCalledTimes(1));

    rerender(
      <PitchPlayer
        company={company(2)}
        policy="ACTIVE"
        authorize={authorize}
        reducedMotion={false}
      />,
    );

    await waitFor(() => expect(authorize).toHaveBeenCalledTimes(2));
    expect(authorize.mock.calls[0]?.[0]).not.toBe(authorize.mock.calls[1]?.[0]);
  });

  it("asks again when the one it holds has expired", async () => {
    const authorize = vi
      .fn<(mediaAssetId: string) => Promise<PlaybackAuthorizationDto>>()
      .mockResolvedValueOnce(
        // Already past the safety margin when it arrives.
        authorization({
          expiresAt: new Date(Date.now() + 1_000).toISOString(),
        }),
      )
      .mockResolvedValue(authorization());

    render(
      <PitchPlayer
        company={company(1)}
        policy="ACTIVE"
        authorize={authorize}
        reducedMotion={false}
      />,
    );

    await waitFor(() => expect(authorize.mock.calls.length).toBeGreaterThan(1));
  });
});
