/**
 * The private-document storage boundary (doc 15 §24–25, doc 22 §64).
 *
 * Product code names a bucket and a key and asks for a scoped, short-lived
 * authorization; it never learns how the provider mints one. Provider SDKs,
 * URLs and credentials stay inside the adapter, and the privileged
 * credential never leaves the server.
 *
 *   scoped upload authorization ≠ download URL
 *   object exists ≠ object is safe
 */

/** One object's identity. Chosen by the server, never by a client. */
export type StoredObjectRef = {
  readonly bucket: string;
  readonly key: string;
};

/**
 * What the browser needs to transfer bytes directly to private storage, and
 * nothing else. It authorises exactly one object, refuses to overwrite, and
 * expires. It is handed over once and never persisted.
 */
export type DirectUploadAuthorization = {
  readonly method: "PUT";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /**
   * When the provider's own authorization lapses. The application session
   * may close earlier; finalization always fails closed after that.
   */
  readonly providerExpiresAt: string;
};

export type StoredObjectMetadata = {
  readonly sizeBytes: number;
  /** What the uploader declared to the provider. Never trusted as identity. */
  readonly declaredContentType: string | null;
};

/** A bounded, streaming read of stored bytes. */
export type StoredObjectStream = {
  readonly body: AsyncIterable<Uint8Array>;
};

export type PrivateDocumentStorageProvider = {
  readonly createUploadAuthorization: (input: {
    readonly object: StoredObjectRef;
    readonly contentType: string;
    readonly maxBytes: number;
  }) => Promise<DirectUploadAuthorization>;
  /** `null` when no object exists at that identity. */
  readonly statObject: (
    object: StoredObjectRef,
  ) => Promise<StoredObjectMetadata | null>;
  readonly openObjectStream: (
    object: StoredObjectRef,
  ) => Promise<StoredObjectStream>;
  /** Idempotent: deleting an object that is already gone is success. */
  readonly deleteObject: (object: StoredObjectRef) => Promise<void>;
};
