import {
  materialUploadCompleteAction,
  materialUploadTargetAction,
} from "@/features/onboarding-kit/material-actions";

/**
 * An image for a site page (decision 107), through the one upload path
 * every Capital Q file takes: ask Evidence for a signed target, put the
 * bytes straight to private storage, let the server verify what landed.
 * The file then waits for its malware scan; the page can publish it only
 * once the scan is clean (the API checks, not this). Returns the document
 * id, or null when the upload was refused.
 */
export async function uploadSiteImage(file: File): Promise<string | null> {
  if (file.type !== "image/png" && file.type !== "image/jpeg") return null;
  const key = crypto.randomUUID();
  const target = await materialUploadTargetAction({
    documentType: "OTHER",
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    idempotencyKey: key,
  });
  if (!target.ok) return null;
  const put = await fetch(target.value.url, {
    method: target.value.method,
    headers: target.value.headers,
    body: file,
  }).catch(() => null);
  if (put === null || !put.ok) return null;
  const done = await materialUploadCompleteAction(
    target.value.uploadSessionId,
    crypto.randomUUID(),
  );
  return done.ok ? done.value.documentId : null;
}
