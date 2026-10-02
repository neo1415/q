import { describe, expect, it } from "vitest";

import type {
  MediaAssetDto,
  MediaUploadSessionDto,
} from "@capital-q/contracts";

import {
  describeNetworkStanding,
  INITIAL_PITCH_FLOW,
  judgeFile,
  PENDING_AFTER_UPLOAD_MAX_ATTEMPTS,
  pitchFlowReducer,
  replaceablePitch,
  syncDelayMs,
  type PitchFlowEvent,
  type PitchFlowState,
} from "../src/features/pitch/pitch-state";

/**
 * The founder's upload as a machine (CQ-WEB-023). The server's record is
 * the truth; these prove the screen derives the same state from it
 * whether the bytes were sent here or elsewhere, that progress and
 * failures land where they should, and that nothing is claimed early.
 */

const ASSET = "f0000000-0000-4000-8000-000000000001";

function pitch(overrides: Partial<MediaAssetDto> = {}): MediaAssetDto {
  return {
    mediaAssetId: ASSET,
    purpose: "FOUNDER_PITCH",
    status: "CREATED",
    durationSeconds: null,
    aspectRatio: null,
    playbackPolicy: "PRIVATE",
    captionState: "NOT_REQUESTED",
    transcriptState: "NOT_REQUESTED",
    moderationStatus: "NOT_REVIEWED",
    title: null,
    audience: "INVESTORS",
    live: true,
    replacesMediaAssetId: null,
    createdAt: "2026-09-23T09:00:00.000Z",
    readyAt: null,
    version: 1,
    ...overrides,
  };
}

const SESSION: MediaUploadSessionDto = {
  mediaAssetId: ASSET,
  uploadMode: "DIRECT",
  uploadUrl: "https://upload.provider.example/one-time",
  expiresAt: "2026-09-23T09:30:00.000Z",
  maxDurationSeconds: 180,
  pitch: pitch({ status: "UPLOAD_PENDING", version: 3 }),
};

const FILE = { name: "pitch.webm", sizeBytes: 33_832, mimeType: "video/webm" };

function run(events: readonly PitchFlowEvent[], from = INITIAL_PITCH_FLOW) {
  return events.reduce(pitchFlowReducer, from);
}

describe("pitchFlowReducer", () => {
  it("walks the happy path: empty â†’ preparing â†’ uploading â†’ processing â†’ ready", () => {
    let state: PitchFlowState = run([{ type: "LOADED", pitch: null }]);
    expect(state).toEqual({ kind: "EMPTY" });

    state = pitchFlowReducer(state, { type: "FILE_CHOSEN", file: FILE });
    expect(state).toEqual({ kind: "PREPARING", file: FILE, pitch: null });

    state = pitchFlowReducer(state, { type: "CREATED", pitch: pitch() });
    expect(state.kind).toBe("PREPARING");

    state = pitchFlowReducer(state, {
      type: "RESERVED",
      pitch: SESSION.pitch,
      session: SESSION,
    });
    expect(state).toMatchObject({ kind: "UPLOADING", progress: 0 });

    state = pitchFlowReducer(state, { type: "UPLOAD_PROGRESS", progress: 0.4 });
    expect(state).toMatchObject({ kind: "UPLOADING", progress: 0.4 });
    state = pitchFlowReducer(state, { type: "UPLOAD_PROGRESS", progress: 7 });
    expect(state).toMatchObject({ kind: "UPLOADING", progress: 1 });

    state = pitchFlowReducer(state, { type: "UPLOADED" });
    expect(state).toEqual({
      kind: "PROCESSING",
      pitch: SESSION.pitch,
      attempt: 0,
      uploadedHere: true,
    });

    state = pitchFlowReducer(state, {
      type: "SYNCED",
      pitch: pitch({ status: "PROCESSING", version: 5 }),
    });
    expect(state).toMatchObject({ kind: "PROCESSING", attempt: 1 });

    const ready = pitch({
      status: "READY",
      version: 6,
      readyAt: "2026-09-23T09:05:00.000Z",
    });
    state = pitchFlowReducer(state, { type: "SYNCED", pitch: ready });
    expect(state).toEqual({ kind: "READY", pitch: ready });
  });

  it("reads a loaded record into the state the server's lifecycle means", () => {
    const load = (status: MediaAssetDto["status"]) =>
      run([{ type: "LOADED", pitch: pitch({ status }) }]);
    expect(load("CREATED")).toMatchObject({ kind: "CREATED" });
    expect(load("UPLOADING")).toMatchObject({
      kind: "PROCESSING",
      uploadedHere: false,
    });
    expect(load("PROCESSING")).toMatchObject({
      kind: "PROCESSING",
      attempt: 0,
    });
    expect(load("READY")).toMatchObject({ kind: "READY" });
    expect(load("UPLOAD_FAILED")).toMatchObject({
      kind: "FAILED",
      failure: "UPLOAD_FAILED",
    });
    expect(load("PROCESSING_FAILED")).toMatchObject({
      kind: "FAILED",
      failure: "PROCESSING_FAILED",
    });
    expect(load("EXPIRED")).toMatchObject({
      kind: "FAILED",
      failure: "EXPIRED",
    });
    expect(load("DELETED")).toEqual({ kind: "EMPTY" });
  });

  it("calls a target reserved in another session lost, never resumable", () => {
    const state = run([
      { type: "LOADED", pitch: pitch({ status: "UPLOAD_PENDING" }) },
    ]);
    expect(state).toMatchObject({ kind: "FAILED", failure: "TARGET_LOST" });
    expect(replaceablePitch(state)?.mediaAssetId).toBe(ASSET);
  });

  it("tolerates UPLOAD_PENDING briefly after this session's upload, then calls it failed", () => {
    let state: PitchFlowState = {
      kind: "PROCESSING",
      pitch: SESSION.pitch,
      attempt: 0,
      uploadedHere: true,
    };
    for (let i = 0; i < PENDING_AFTER_UPLOAD_MAX_ATTEMPTS - 1; i += 1) {
      state = pitchFlowReducer(state, { type: "SYNCED", pitch: SESSION.pitch });
      expect(state.kind).toBe("PROCESSING");
    }
    state = pitchFlowReducer(state, { type: "SYNCED", pitch: SESSION.pitch });
    expect(state).toMatchObject({ kind: "FAILED", failure: "UPLOAD_FAILED" });
  });

  it("never claims READY from anything but the server saying so", () => {
    const uploading: PitchFlowState = {
      kind: "UPLOADING",
      file: FILE,
      pitch: SESSION.pitch,
      session: SESSION,
      progress: 1,
      reconnecting: false,
    };
    expect(pitchFlowReducer(uploading, { type: "UPLOADED" }).kind).toBe(
      "PROCESSING",
    );
    expect(
      pitchFlowReducer(uploading, {
        type: "SYNCED",
        pitch: pitch({ status: "READY" }),
      }),
    ).toBe(uploading);
  });

  it("ignores a file chosen while work is in flight", () => {
    const preparing: PitchFlowState = {
      kind: "PREPARING",
      file: FILE,
      pitch: null,
    };
    expect(
      pitchFlowReducer(preparing, { type: "FILE_CHOSEN", file: FILE }),
    ).toBe(preparing);
    expect(
      pitchFlowReducer(INITIAL_PITCH_FLOW, { type: "FILE_CHOSEN", file: FILE }),
    ).toBe(INITIAL_PITCH_FLOW);
  });

  it("reuses a CREATED record and replaces a READY or FAILED one", () => {
    const created = run([{ type: "LOADED", pitch: pitch() }]);
    expect(
      pitchFlowReducer(created, { type: "FILE_CHOSEN", file: FILE }),
    ).toMatchObject({
      kind: "PREPARING",
      pitch: { mediaAssetId: ASSET },
    });
    const ready = run([{ type: "LOADED", pitch: pitch({ status: "READY" }) }]);
    expect(replaceablePitch(ready)?.mediaAssetId).toBe(ASSET);
    expect(
      pitchFlowReducer(ready, { type: "FILE_CHOSEN", file: FILE }),
    ).toMatchObject({
      kind: "PREPARING",
      pitch: null,
    });
  });

  it("carries a request failure with the record it belongs to, and a plain sentence", () => {
    const state = pitchFlowReducer(
      {
        kind: "PROCESSING",
        pitch: SESSION.pitch,
        attempt: 2,
        uploadedHere: true,
      },
      {
        type: "REQUEST_FAILED",
        message: "Capital Q couldn't complete that right now.",
      },
    );
    expect(state).toMatchObject({
      kind: "FAILED",
      failure: "REQUEST_FAILED",
      pitch: { mediaAssetId: ASSET },
      message: "Capital Q couldn't complete that right now.",
    });
    const rejected = pitchFlowReducer(
      {
        kind: "UPLOADING",
        file: FILE,
        pitch: SESSION.pitch,
        session: SESSION,
        progress: 0.3,
        reconnecting: false,
      },
      { type: "REQUEST_FAILED", message: "ignored", failure: "UPLOAD_FAILED" },
    );
    expect(rejected).toMatchObject({
      kind: "FAILED",
      failure: "UPLOAD_FAILED",
    });
    expect((rejected as { message: string }).message).toContain(
      "replace this pitch",
    );
  });
});

describe("pitchFlowReducer, resumable (CQ-MEDIA-011)", () => {
  const uploading: PitchFlowState = {
    kind: "UPLOADING",
    file: FILE,
    pitch: SESSION.pitch,
    session: { ...SESSION, uploadMode: "RESUMABLE", chunkSizeBytes: 5_242_880 },
    progress: 0.4,
    reconnecting: false,
  };

  it("says 'reconnecting' while a drop is retried, and drops it when bytes move again", () => {
    const retrying = pitchFlowReducer(uploading, { type: "UPLOAD_RETRYING" });
    expect(retrying).toMatchObject({
      kind: "UPLOADING",
      reconnecting: true,
      progress: 0.4,
    });
    expect(
      pitchFlowReducer(retrying, { type: "UPLOAD_RECOVERED" }),
    ).toMatchObject({ kind: "UPLOADING", reconnecting: false });
  });

  it("pauses, with the record and the file, when retries run out", () => {
    expect(pitchFlowReducer(uploading, { type: "UPLOAD_INTERRUPTED" })).toEqual(
      {
        kind: "INTERRUPTED",
        pitch: SESSION.pitch,
        file: FILE,
        reason: "CONNECTION",
      },
    );
  });

  it("reads UPLOAD_PENDING as resumable only when this browser remembers the file", () => {
    const pending = pitch({ status: "UPLOAD_PENDING", version: 3 });
    expect(run([{ type: "LOADED", pitch: pending, resumable: FILE }])).toEqual({
      kind: "INTERRUPTED",
      pitch: pending,
      file: FILE,
      reason: "RELOADED",
    });
    expect(
      run([{ type: "LOADED", pitch: pending, resumable: null }]),
    ).toMatchObject({ kind: "FAILED", failure: "TARGET_LOST" });
  });

  it("resumes into the same record, never a replacement", () => {
    const paused: PitchFlowState = {
      kind: "INTERRUPTED",
      pitch: SESSION.pitch,
      file: FILE,
      reason: "RELOADED",
    };
    expect(replaceablePitch(paused)).toBeNull();
    expect(
      pitchFlowReducer(paused, { type: "FILE_CHOSEN", file: FILE }),
    ).toEqual({ kind: "PREPARING", file: FILE, pitch: SESSION.pitch });
  });

  it("shows a cancel as what the server recorded", () => {
    const cancelled = pitch({ status: "UPLOAD_FAILED", version: 4 });
    const state = pitchFlowReducer(uploading, {
      type: "CANCELLED",
      pitch: cancelled,
    });
    expect(state).toMatchObject({
      kind: "FAILED",
      failure: "CANCELLED",
      pitch: cancelled,
    });
    // A cancelled pitch is replaced by choosing a file.
    expect(replaceablePitch(state)).toEqual(cancelled);
  });
});

describe("syncDelayMs", () => {
  it("eases off and stays bounded", () => {
    expect([0, 1, 2, 3, 10, 59].map(syncDelayMs)).toEqual([
      1_500, 2_500, 4_000, 6_000, 6_000, 6_000,
    ]);
  });
});

describe("judgeFile", () => {
  const guidance = {
    targetMinSeconds: 30,
    targetMaxSeconds: 120,
    hardMaxSeconds: 180,
    preferredAspectRatio: "9:16",
  };
  it("refuses what the server would certainly refuse, and nothing else", () => {
    expect(judgeFile(FILE, guidance)).toEqual({ ok: true });
    expect(
      judgeFile({ ...FILE, mimeType: "application/pdf" }, guidance).ok,
    ).toBe(false);
    expect(judgeFile({ ...FILE, sizeBytes: 0 }, guidance).ok).toBe(false);
    expect(judgeFile({ ...FILE, sizeBytes: 2 * 1024 ** 3 }, guidance).ok).toBe(
      false,
    );
    // A large but plausible file is the server's call, not the browser's.
    expect(
      judgeFile({ ...FILE, sizeBytes: 900 * 1024 ** 2 }, guidance),
    ).toEqual({ ok: true });
    expect(judgeFile({ ...FILE, mimeType: "video/quicktime" }, null)).toEqual({
      ok: true,
    });
  });
});

describe("describeNetworkStanding", () => {
  const ready = pitch({
    status: "READY",
    moderationStatus: "ALLOWED",
    playbackPolicy: "AUTHORISED",
  });
  const summary = {
    mediaAssetId: ASSET,
    aspectRatio: "9:16",
    durationSeconds: 60,
    captionState: "NOT_REQUESTED" as const,
  };

  it("says investors can see the pitch only when every gate is open", () => {
    expect(
      describeNetworkStanding(
        {
          marketplaceVisibility: "network_visible",
          marketplaceReadinessState: "marketplace_ready",
          pitch: summary,
        },
        ready,
      ),
    ).toEqual({ visible: true, sentence: "Investors can now see your pitch." });
  });

  it("visible but not recommended: says so plainly, names each unmet requirement with where to meet it (live 2026-10-02, Nixo)", () => {
    const outstanding = (requirement: string) => ({
      requirement,
      outcome: "OUTSTANDING",
      description: "x",
    });
    const standing = describeNetworkStanding(
      {
        marketplaceVisibility: "network_visible",
        marketplaceReadinessState: "not_ready",
        pitch: summary,
      },
      ready,
      {
        requirements: [
          {
            requirement: "COMPANY_ACTIVE",
            outcome: "SATISFIED",
            description: "x",
          },
          outstanding("MINIMUM_COMPANY_PROFILE"),
          outstanding("FOUNDER_IDENTITY_VERIFIED"),
          outstanding("ORGANISATION_VERIFIED"),
        ],
      } as never,
    );
    expect(standing.visible).toBe(false);
    expect(standing.sentence).toBe(
      "Your pitch is visible on your profile to investors who look you up. It will appear in investor feeds once your profile has a description, a stage and where you are based, a founder's identity is verified and your company is verified.",
    );
    expect(standing.needs?.map((need) => need.href)).toEqual([
      "/profile",
      "/verification",
      "/verification",
    ]);
  });

  it("never claims feeds without the readiness answer", () => {
    const standing = describeNetworkStanding(
      {
        marketplaceVisibility: "network_visible",
        marketplaceReadinessState: "not_assessed",
        pitch: summary,
      },
      ready,
    );
    expect(standing.visible).toBe(false);
    expect(standing.sentence).toContain("visible on your profile");
    expect(standing.sentence).not.toContain("Investors can now see");
  });

  it("names what is still needed, in order, and never invents a state", () => {
    const standing = describeNetworkStanding(
      {
        marketplaceVisibility: "organisation_private",
        marketplaceReadinessState: "not_assessed",
        pitch: null,
      },
      pitch({ status: "READY" }),
    );
    expect(standing.visible).toBe(false);
    expect(standing.sentence).toBe(
      "Your pitch is ready. Before investors see it, it needs a review of the video, your decision to let investors play it and your company to be visible to the network.",
    );
    expect(
      describeNetworkStanding(
        {
          marketplaceVisibility: "network_visible",
          marketplaceReadinessState: "x",
          pitch: null,
        },
        pitch({ status: "PROCESSING" }),
      ).sentence,
    ).toBe("Investors will see your pitch once it is ready.");
  });
});
