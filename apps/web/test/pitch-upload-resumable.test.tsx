// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CompanyDtoSchema,
  type MediaAssetDto,
  type MediaUploadSessionDto,
} from "@capital-q/contracts";

import * as actions from "../src/features/pitch/pitch-actions";
import { PitchUpload } from "../src/features/pitch/pitch-upload";

/**
 * The founder's resumable upload, end to end in the browser (CQ-MEDIA-011).
 *
 * Every server step is a mocked server action; the provider is a mocked
 * tus endpoint behind a fake XMLHttpRequest, so the real client, the real
 * XHR transport and the real component run against it. What is proven: a
 * dropped chunk is retried without resending acknowledged bytes; retries
 * that run out pause the upload and Resume carries on with the same
 * idempotency key; cancel stops the bytes and shows what the server
 * recorded; and after a reload the same file resumes into the same pitch.
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

// The real client with waits short enough for a test.
vi.mock("../src/features/pitch/resumable-upload", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("../src/features/pitch/resumable-upload")
    >();
  return {
    ...real,
    uploadResumable: (
      input: Parameters<typeof real.uploadResumable>[0],
    ): ReturnType<typeof real.uploadResumable> =>
      real.uploadResumable({ ...input, retryDelaysMs: [5, 5] }),
  };
});

const COMPANY = "44444444-0000-4000-8000-000000000001";
const ASSET = "f0000000-0000-4000-8000-000000000001";
const NOW = "2026-09-24T09:00:00.000Z";
const TUS_URL = "https://upload.provider.example/tus/resource";
const LENGTH = 10;

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
  marketplaceVisibility: "organisation_private",
  marketplaceReadinessState: "not_assessed",
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
});

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
    downloadable: false,
    live: true,
    replacesMediaAssetId: null,
    createdAt: NOW,
    readyAt: null,
    version: 1,
    ...overrides,
  };
}

const SESSION: MediaUploadSessionDto = {
  mediaAssetId: ASSET,
  uploadMode: "RESUMABLE",
  uploadUrl: TUS_URL,
  expiresAt: "2026-09-24T11:00:00.000Z",
  maxDurationSeconds: 180,
  chunkSizeBytes: 4,
  pitch: pitch({ status: "UPLOAD_PENDING", version: 3 }),
};

function videoFile(name = "pitch.webm"): File {
  const bytes = new Uint8Array(LENGTH);
  for (let i = 0; i < LENGTH; i += 1) bytes[i] = 100 + i;
  return new File([bytes], name, {
    type: "video/webm",
    lastModified: 1_700_000_000_000,
  });
}

// ---------------------------------------------------------------------------
// The mocked tus endpoint, reached through a fake XMLHttpRequest.
// ---------------------------------------------------------------------------

type Fault = "DROP" | "HANG" | null;

const endpoint = {
  offset: 0,
  received: new Uint8Array(LENGTH),
  requests: [] as string[],
  faults: [] as Fault[],
  aborted: 0,
  reset(offset = 0) {
    this.offset = offset;
    this.received = new Uint8Array(LENGTH);
    this.requests = [];
    this.faults = [];
    this.aborted = 0;
  },
};

class FakeXhr {
  status = 0;
  readonly upload = new EventTarget();
  private readonly events = new EventTarget();
  private method = "";
  private url = "";
  private readonly requestHeaders: Record<string, string> = {};
  private responseHeaders: Record<string, string> = {};

  addEventListener(type: string, listener: EventListener) {
    this.events.addEventListener(type, listener);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name.toLowerCase()] = value;
  }
  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }
  abort() {
    endpoint.aborted += 1;
    this.events.dispatchEvent(new Event("abort"));
  }
  send(body: Blob | null) {
    void this.handle(body);
  }

  private async handle(body: Blob | null) {
    const bytes =
      body === null
        ? new Uint8Array(0)
        : new Uint8Array(await body.arrayBuffer());
    expect(this.url).toBe(TUS_URL);
    const offset = this.requestHeaders["upload-offset"];
    endpoint.requests.push(
      `${this.method}${offset === undefined ? "" : `@${offset}`}`,
    );
    const fault = endpoint.faults.shift() ?? null;
    if (fault === "HANG") return;
    if (fault === "DROP") {
      this.events.dispatchEvent(new Event("error"));
      return;
    }
    if (this.method === "HEAD") {
      this.status = 200;
      this.responseHeaders = {
        "upload-offset": String(endpoint.offset),
        "upload-length": String(LENGTH),
      };
    } else if (Number(offset) !== endpoint.offset) {
      this.status = 409;
    } else {
      endpoint.received.set(bytes, endpoint.offset);
      endpoint.offset += bytes.length;
      this.upload.dispatchEvent(
        Object.assign(new Event("progress"), { loaded: bytes.length }),
      );
      this.status = 204;
      this.responseHeaders = { "upload-offset": String(endpoint.offset) };
    }
    this.events.dispatchEvent(new Event("load"));
  }
}

const expectedBytes = () =>
  new Uint8Array(videoFile().size).map((_, i) => 100 + i);

const chooser = () => screen.getByLabelText("Choose a pitch video");

beforeEach(() => {
  endpoint.reset();
  window.localStorage.clear();
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  // jsdom has no media queries; the screen only asks about reduced motion.
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.mocked(actions.syncPitchAction).mockResolvedValue({
    ok: true,
    value: pitch({ status: "PROCESSING", version: 5 }),
  });
  vi.mocked(actions.createPitchAction).mockResolvedValue({
    ok: true,
    value: {
      pitch: pitch(),
      replacedMediaAssetId: null,
      guidance: {
        targetMinSeconds: 30,
        targetMaxSeconds: 120,
        hardMaxSeconds: 180,
        preferredAspectRatio: "9:16",
      },
    },
  });
  vi.mocked(actions.createUploadSessionAction).mockResolvedValue({
    ok: true,
    value: SESSION,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function loads(current: MediaAssetDto | null) {
  vi.mocked(actions.loadPitchOverviewAction).mockResolvedValue({
    ok: true,
    value: { company, pitch: current },
  });
}

describe("PitchUpload, resumable", () => {
  it("retries a dropped chunk from the provider's offset and never resends acknowledged bytes", async () => {
    loads(null);
    endpoint.faults.push(null, null, "DROP");
    const user = userEvent.setup();
    render(<PitchUpload companyId={COMPANY} />);
    await user.upload(
      await screen.findByLabelText("Choose a pitch video"),
      videoFile(),
    );

    await screen.findByText("Processing");
    expect(endpoint.requests).toEqual([
      "HEAD",
      "PATCH@0",
      "PATCH@4",
      "HEAD",
      "PATCH@4",
      "PATCH@8",
    ]);
    expect(endpoint.received).toEqual(expectedBytes());
    expect(actions.createUploadSessionAction).toHaveBeenCalledWith(
      COMPANY,
      ASSET,
      1,
      {
        uploadLengthBytes: LENGTH,
        idempotencyKey: expect.stringMatching(/^pitch-upload-/) as unknown,
      },
    );
    // Finished: nothing left to resume.
    expect(window.localStorage.getItem(`cq.pitch-upload.${ASSET}`)).toBeNull();
  });

  it("pauses when retries run out, and Resume carries on with the same key from where it stopped", async () => {
    loads(null);
    endpoint.faults.push(null, null, "DROP", "DROP", "DROP");
    const user = userEvent.setup();
    render(<PitchUpload companyId={COMPANY} />);
    await user.upload(
      await screen.findByLabelText("Choose a pitch video"),
      videoFile(),
    );

    await screen.findByText("Upload paused", { selector: "p" });
    expect(endpoint.offset).toBe(4);
    const firstKey = (
      vi.mocked(actions.createUploadSessionAction).mock.calls[0]?.[3] as {
        idempotencyKey: string;
      }
    ).idempotencyKey;

    await user.click(screen.getByRole("button", { name: /Resume upload/ }));
    await screen.findByText("Processing");

    const calls = vi.mocked(actions.createUploadSessionAction).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[3]).toEqual({
      uploadLengthBytes: LENGTH,
      idempotencyKey: firstKey,
    });
    // The first chunk went once; the rest carried on from the provider's 4.
    expect(endpoint.requests.filter((r) => r === "PATCH@0")).toHaveLength(1);
    expect(endpoint.requests.slice(-3)).toEqual(["HEAD", "PATCH@4", "PATCH@8"]);
    expect(endpoint.received).toEqual(expectedBytes());
  });

  it("cancel stops the bytes, tells the server, and shows what it recorded", async () => {
    loads(null);
    endpoint.faults.push(null, "HANG");
    vi.mocked(actions.cancelUploadAction).mockResolvedValue({
      ok: true,
      value: pitch({ status: "UPLOAD_FAILED", version: 4 }),
    });
    const user = userEvent.setup();
    render(<PitchUpload companyId={COMPANY} />);
    await user.upload(
      await screen.findByLabelText("Choose a pitch video"),
      videoFile(),
    );

    await waitFor(() => expect(endpoint.requests).toEqual(["HEAD", "PATCH@0"]));
    await user.click(screen.getByRole("button", { name: "Cancel upload" }));

    await screen.findByText("Upload cancelled", { selector: "p" });
    expect(endpoint.aborted).toBe(1);
    expect(actions.cancelUploadAction).toHaveBeenCalledWith(COMPANY, ASSET);
    expect(window.localStorage.getItem(`cq.pitch-upload.${ASSET}`)).toBeNull();
    // Nothing more went to the provider after the cancel.
    expect(endpoint.requests).toEqual(["HEAD", "PATCH@0"]);
  });

  it("after a reload, resumes into the same pitch once the same file is chosen", async () => {
    const pending = pitch({ status: "UPLOAD_PENDING", version: 3 });
    loads(pending);
    endpoint.reset(8);
    endpoint.received.set(expectedBytes().subarray(0, 8), 0);
    const file = videoFile();
    window.localStorage.setItem(
      `cq.pitch-upload.${ASSET}`,
      JSON.stringify({
        v: 1,
        mediaAssetId: ASSET,
        idempotencyKey: "pitch-upload-remembered",
        name: file.name,
        sizeBytes: file.size,
        lastModified: file.lastModified,
        mimeType: file.type,
      }),
    );
    const user = userEvent.setup();
    render(<PitchUpload companyId={COMPANY} />);

    await screen.findByText("Upload paused", { selector: "p" });
    expect(
      screen.getByRole("button", { name: /Choose the same file/ }),
    ).toBeTruthy();

    // A different file is refused, by name, before anything is asked.
    await user.upload(chooser(), videoFile("other.webm"));
    await screen.findByText(/That isn't the file that was uploading/);
    expect(actions.createUploadSessionAction).not.toHaveBeenCalled();

    await user.upload(chooser(), file);
    await screen.findByText("Processing");
    expect(actions.createUploadSessionAction).toHaveBeenCalledWith(
      COMPANY,
      ASSET,
      3,
      { uploadLengthBytes: LENGTH, idempotencyKey: "pitch-upload-remembered" },
    );
    expect(actions.createPitchAction).not.toHaveBeenCalled();
    expect(endpoint.requests).toEqual(["HEAD", "PATCH@8"]);
    expect(endpoint.received).toEqual(expectedBytes());
  });

  it("without a remembered file, a pending upload is lost here and can be cancelled", async () => {
    loads(pitch({ status: "UPLOAD_PENDING", version: 3 }));
    vi.mocked(actions.cancelUploadAction).mockResolvedValue({
      ok: true,
      value: pitch({ status: "UPLOAD_FAILED", version: 4 }),
    });
    const user = userEvent.setup();
    render(<PitchUpload companyId={COMPANY} />);
    await user.click(
      await screen.findByRole("button", { name: "Cancel that upload" }),
    );
    await screen.findByText("Upload cancelled", { selector: "p" });
    expect(actions.cancelUploadAction).toHaveBeenCalledWith(COMPANY, ASSET);
  });
});
