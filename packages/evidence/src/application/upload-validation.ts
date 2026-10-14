import { detectDocumentContent } from "../domain/content-validation.js";
import { checkClaimedType } from "../domain/upload-policy.js";
import {
  stageObjectForValidation,
  StagedObjectTooLargeError,
} from "../infrastructure/object-staging.js";
import type { DocumentUploadFailureCode } from "../contracts/upload.js";
import type {
  PrivateDocumentStorageProvider,
  StoredObjectRef,
} from "./storage-port.js";

/** Shared hostile-byte boundary for organisation and application custody. */
export async function validateUploadedDocument(input: {
  readonly storage: PrivateDocumentStorageProvider;
  readonly object: StoredObjectRef;
  readonly maxBytes: number;
  readonly filename: string;
  readonly declaredMimeType: string;
  readonly clientSha256?: string | undefined;
  readonly refuse: (code: DocumentUploadFailureCode) => Promise<Error>;
}): Promise<{
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}> {
  const stat = await input.storage.statObject(input.object);
  if (stat === null) throw await input.refuse("OBJECT_MISSING");
  if (stat.sizeBytes === 0) throw await input.refuse("FILE_EMPTY");
  if (stat.sizeBytes > input.maxBytes)
    throw await input.refuse("FILE_TOO_LARGE");
  const stream = await input.storage.openObjectStream(input.object);
  const staged = await stageObjectForValidation({
    body: stream.body,
    maxBytes: input.maxBytes,
  }).catch(async (error: unknown) => {
    if (error instanceof StagedObjectTooLargeError)
      throw await input.refuse("FILE_TOO_LARGE");
    throw error;
  });
  try {
    if (staged.sizeBytes !== stat.sizeBytes)
      throw await input.refuse("SIZE_MISMATCH");
    const detected = await detectDocumentContent({
      sizeBytes: staged.sizeBytes,
      read: staged.read,
    });
    if (!detected.ok) throw await input.refuse(detected.failureCode);
    const agreed = checkClaimedType({
      filename: input.filename,
      declaredMimeType: input.declaredMimeType,
      detected: detected.kind,
    });
    if (!agreed.ok) throw await input.refuse(agreed.failureCode);
    if (
      input.clientSha256 !== undefined &&
      input.clientSha256 !== staged.sha256
    )
      throw await input.refuse("STORAGE_VALIDATION_FAILED");
    return {
      mimeType: agreed.type.mimeType,
      sizeBytes: staged.sizeBytes,
      sha256: staged.sha256,
    };
  } finally {
    await staged.dispose();
  }
}
