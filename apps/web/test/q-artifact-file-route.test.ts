import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The narrow file route between the browser and the Q API (BIZ-001).
 *
 * What a person reads when a download fails comes from here, so each
 * upstream refusal has to become the sentence that fits it. The one 409
 * sentence used to be "That document has no slides", and it was what a
 * founder read after asking for a PDF of their brief.
 */

vi.mock("@capital-q/config/web", () => ({
  loadWebServerConfig: () => ({ qApiBaseUrl: "http://q-api.test" }),
}));
vi.mock("@/auth/session", () => ({
  getSessionAccessToken: () => Promise.resolve("session-token"),
}));

const { GET } =
  await import("../app/api/q-artifact/[artifactId]/[format]/route");

const ARTIFACT = "a0000000-0000-4000-8000-000000000001";

function call(format: string, query = "") {
  return GET(
    new NextRequest(
      `http://web.test/api/q-artifact/${ARTIFACT}/${format}${query}`,
    ),
    { params: Promise.resolve({ artifactId: ARTIFACT, format }) },
  );
}

let upstream: Response;
const asked: { url: string; authorization: string | null }[] = [];

beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      asked.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Promise.resolve(upstream);
    }),
  );
});

function problem(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

async function message(response: Response): Promise<string> {
  const body = (await response.json()) as { readonly message: string };
  return body.message;
}

describe("BIZ-001 · the artifact file route", () => {
  it("passes a PDF through with the file name the Q API gave it, for the version asked for", async () => {
    upstream = new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="Investment-brief.pdf"',
      },
    });
    const response = await call("pdf", "?version=2");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Investment-brief.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(asked).toEqual([
      {
        url: `http://q-api.test/v1/q/artifacts/${ARTIFACT}/export/pdf?version=2`,
        authorization: "Bearer session-token",
      },
    ]);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(bytes).toString("latin1")).toBe("%PDF-");
  });

  it("says a document still being prepared is not ready", async () => {
    upstream = problem(409, { status: 409, code: "ARTIFACT_NOT_READY" });
    const response = await call("pdf");
    expect(response.status).toBe(409);
    expect(await message(response)).toBe(
      "That document isn't ready yet. Q is still preparing it.",
    );
  });

  it("says PowerPoint is for decks, and that the document is a PDF", async () => {
    upstream = problem(409, { status: 409, code: "FORMAT_NOT_AVAILABLE" });
    const response = await call("pptx");
    expect(response.status).toBe(409);
    expect(await message(response)).toBe(
      "PowerPoint is for decks. This document downloads as a PDF.",
    );
  });

  it("says a renderer failure is worth a retry, without the upstream detail", async () => {
    upstream = problem(500, {
      status: 500,
      detail: "TypeError at fonts.ts:42",
    });
    const response = await call("pdf");
    expect(response.status).toBe(502);
    const said = await message(response);
    expect(said).toBe("I couldn't prepare that file. Please try again.");
    expect(said).not.toContain("fonts.ts");
  });

  it("refuses a format nobody offers before opening a socket", async () => {
    const response = await call("keynote");
    expect(response.status).toBe(404);
    expect(asked).toEqual([]);
  });
});
