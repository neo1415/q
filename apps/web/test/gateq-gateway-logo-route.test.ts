import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/g/[publicId]/logo/route";

/**
 * `/g/:publicId/logo` (brand from website): the web re-checks what the API
 * serves and keeps the sandboxing headers; an SVG is served only in the
 * sanitiser's form and only as an image.
 */

vi.mock("@capital-q/config/web", () => ({
  loadWebServerConfig: () => ({ apiBaseUrl: "https://api.example" }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const SANITISED =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>';

async function serve(body: string | Uint8Array, contentType: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      // A fresh ArrayBuffer-backed copy is a BodyInit; a view over any buffer is not.
      new Response(typeof body === "string" ? body : body.slice(), {
        status: 200,
        headers: { "content-type": contentType },
      }),
    ),
  );
  return GET(new Request("https://web.example/g/gw_abcd/logo"), {
    params: Promise.resolve({ publicId: "gw_abcd" }),
  });
}

describe("gateway logo route", () => {
  it("serves a sanitised SVG as image/svg+xml with nosniff and the sandboxing policy", async () => {
    const response = await serve(SANITISED, "image/svg+xml");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(await response.text()).toBe(SANITISED);
  });

  it("refuses an SVG with script, a handler, or not labelled as SVG", async () => {
    for (const [body, type] of [
      [
        SANITISED.replace("<path", "<script>x()</script><path"),
        "image/svg+xml",
      ],
      [SANITISED.replace("<path", '<path onclick="x()"'), "image/svg+xml"],
      ['<svg onload="x()"><path d="M0 0z"/></svg>', "image/svg+xml"],
      [SANITISED, "text/html"],
    ] as const) {
      expect((await serve(body, type)).status).toBe(404);
    }
  });

  it("still serves a PNG as image/png", async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const response = await serve(png, "image/png");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
  });
});
