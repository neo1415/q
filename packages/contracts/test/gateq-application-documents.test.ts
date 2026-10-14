import { describe, expect, it } from "vitest";
import {
  CreateApplicationDocumentRequestSchema,
  SelectApplicationDocumentsRequestSchema,
} from "../src/http/gateq-application-documents.js";

const document = {
  documentId: "00000000-0000-4000-8000-000000000001",
  versionId: "00000000-0000-4000-8000-000000000002",
  sha256: "a".repeat(64),
};
describe("application-owned document wire boundary", () => {
  it("accepts upload hints and refuses client-supplied ownership or processing state", () => {
    const input = {
      fileName: "Revenue.pdf",
      mimeType: "application/pdf",
      byteSize: 1024,
      clientRequestId: "upload-0001",
    };
    expect(
      CreateApplicationDocumentRequestSchema.safeParse(input).success,
    ).toBe(true);
    for (const field of [
      "tenantId",
      "applicationId",
      "sessionId",
      "ownerOrganisationId",
      "storageBucket",
      "storageKey",
      "malwareStatus",
    ]) {
      expect(
        CreateApplicationDocumentRequestSchema.safeParse({
          ...input,
          [field]: "forged",
        }).success,
      ).toBe(false);
    }
  });
  it("requires exact version/hash references and refuses duplicate selection", () => {
    expect(
      SelectApplicationDocumentsRequestSchema.safeParse({
        documents: [document],
      }).success,
    ).toBe(true);
    expect(
      SelectApplicationDocumentsRequestSchema.safeParse({
        documents: [{ documentId: document.documentId }],
      }).success,
    ).toBe(false);
    expect(
      SelectApplicationDocumentsRequestSchema.safeParse({
        documents: [document, document],
      }).success,
    ).toBe(false);
    expect(
      SelectApplicationDocumentsRequestSchema.safeParse({ documents: [] })
        .success,
    ).toBe(true);
  });
});
