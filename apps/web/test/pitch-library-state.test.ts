import { describe, expect, it } from "vitest";

import type { MediaAssetDto } from "@capital-q/contracts";

import { toPitchVersionRows } from "../src/features/pitch/pitch-library-state";

function version(overrides: Partial<MediaAssetDto>): MediaAssetDto {
  return {
    mediaAssetId: "f0000000-0000-4000-8000-000000000001",
    purpose: "FOUNDER_PITCH",
    status: "READY",
    durationSeconds: 87,
    aspectRatio: "9:16",
    playbackPolicy: "AUTHORISED",
    captionState: "AVAILABLE",
    transcriptState: "AVAILABLE",
    moderationStatus: "ALLOWED",
    title: null,
    audience: "INVESTORS",
    downloadable: false,
    live: true,
    replacesMediaAssetId: null,
    createdAt: "2026-09-20T09:00:00.000Z",
    readyAt: "2026-09-20T09:05:00.000Z",
    version: 4,
    ...overrides,
  };
}

const OLD = "f0000000-0000-4000-8000-000000000001";
const MID = "f0000000-0000-4000-8000-000000000002";
const NEW = "f0000000-0000-4000-8000-000000000003";

describe("toPitchVersionRows", () => {
  it("orders newest first and derives current and published from the record alone", () => {
    const rows = toPitchVersionRows([
      version({ mediaAssetId: OLD }),
      version({
        mediaAssetId: NEW,
        replacesMediaAssetId: OLD,
        createdAt: "2026-09-24T09:00:00.000Z",
      }),
    ]);
    expect(rows.map((row) => row.pitch.mediaAssetId)).toEqual([NEW, OLD]);
    expect(rows[0]).toMatchObject({
      isCurrent: true,
      isPublished: true,
      phaseLabel: "Ready",
      duration: "1m 27s",
      captions: "Captions available",
      uploadedOn: "24 Sept 2026",
    });
    expect(rows[1]).toMatchObject({
      isCurrent: false,
      isPublished: false,
      standing: "Replaced. Investors no longer see it.",
    });
  });

  it("never calls a private, unreviewed or unready current pitch published", () => {
    const [privateRow] = toPitchVersionRows([
      version({ playbackPolicy: "PRIVATE" }),
    ]);
    const [unreviewed] = toPitchVersionRows([
      version({ moderationStatus: "PENDING" }),
    ]);
    const [processing] = toPitchVersionRows([
      version({ status: "PROCESSING", readyAt: null, durationSeconds: null }),
    ]);
    expect(privateRow?.isPublished).toBe(false);
    expect(privateRow?.standing).toContain("Private");
    expect(unreviewed?.isPublished).toBe(false);
    expect(unreviewed?.standing).toContain("review");
    expect(processing).toMatchObject({
      isPublished: false,
      previewable: false,
      duration: null,
      phaseLabel: "Processing",
    });
  });

  it("reads failures and withdrawals as such, and a withdrawn successor leaves its predecessor replaced", () => {
    const rows = toPitchVersionRows([
      version({ mediaAssetId: OLD }),
      version({
        mediaAssetId: MID,
        replacesMediaAssetId: OLD,
        status: "DELETED",
        createdAt: "2026-09-22T09:00:00.000Z",
      }),
      version({
        mediaAssetId: NEW,
        status: "UPLOAD_FAILED",
        replacesMediaAssetId: null,
        captionState: "NOT_REQUESTED",
        createdAt: "2026-09-24T09:00:00.000Z",
      }),
    ]);
    const byId = new Map(rows.map((row) => [row.pitch.mediaAssetId, row]));
    expect(byId.get(NEW)).toMatchObject({
      phase: "FAILED",
      isCurrent: true,
      withdrawable: true,
      captions: "No captions yet",
    });
    expect(byId.get(MID)).toMatchObject({
      phase: "WITHDRAWN",
      isCurrent: false,
      withdrawable: false,
      previewable: false,
    });
    expect(byId.get(OLD)?.isCurrent).toBe(false);
  });

  it("says a replaced version's unfinished upload will not complete", () => {
    const rows = toPitchVersionRows([
      version({ mediaAssetId: OLD, status: "UPLOAD_PENDING", readyAt: null }),
      version({
        mediaAssetId: NEW,
        status: "UPLOAD_PENDING",
        readyAt: null,
        replacesMediaAssetId: OLD,
        createdAt: "2026-09-24T09:00:00.000Z",
      }),
    ]);
    expect(rows.map((row) => row.phaseLabel)).toEqual([
      "Uploading",
      "Upload not completed",
    ]);
  });
});
