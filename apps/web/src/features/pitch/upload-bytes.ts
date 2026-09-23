/**
 * The bytes, browser → provider (CQ-WEB-023; doc 20 §4, §10).
 *
 * This is the one place a pitch's bytes move, and they move from the
 * founder's browser straight to the one-time target the server reserved.
 * They never touch Next.js and never touch the API: there is no Capital Q
 * URL in this file. XMLHttpRequest rather than fetch because it is still
 * the only way a browser reports upload progress.
 *
 * The target is the provider's, and it takes a multipart form with one
 * `file` part — the shape Cloudflare's direct creator upload documents.
 * That is a fact about the provider, not about Capital Q, and it is the
 * only such fact this file knows.
 */

export type UploadOutcome =
  | { readonly kind: "DONE" }
  | { readonly kind: "REJECTED"; readonly status: number }
  | { readonly kind: "NETWORK" }
  | { readonly kind: "ABORTED" };

export function uploadBytes(input: {
  readonly uploadUrl: string;
  readonly file: Blob;
  readonly onProgress: (fraction: number) => void;
  readonly signal?: AbortSignal | undefined;
}): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", input.file);

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        input.onProgress(event.loaded / event.total);
      }
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        input.onProgress(1);
        resolve({ kind: "DONE" });
      } else {
        resolve({ kind: "REJECTED", status: request.status });
      }
    });
    request.addEventListener("error", () => resolve({ kind: "NETWORK" }));
    request.addEventListener("abort", () => resolve({ kind: "ABORTED" }));
    input.signal?.addEventListener("abort", () => request.abort());

    request.open("POST", input.uploadUrl);
    request.send(form);
  });
}
