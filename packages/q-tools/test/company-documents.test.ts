import { describe, expect, it } from "vitest";

import {
  createOpenCompanyDocumentTool,
  createReadCompanyDocumentTool,
  matchDocument,
  type MaterialDocument,
  type ProfileMaterialPort,
} from "../src/index.js";
import {
  actorA,
  COMPANY_A,
  COMPANY_B_NETWORK,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * R0 (Zino live 2026-10-06): "open the certificate of incorporation" for a
 * company in his Discover failed, Q said it was on his screen, and could
 * not read it. Found by meaning among what the Data room shows him, opened
 * only with a UI intent, read only where he may open it.
 */

const CERT = "00000000-0000-4000-8000-00000000c001";
const DECK = "00000000-0000-4000-8000-00000000c002";
const TAX = "00000000-0000-4000-8000-00000000c003";
const IP = "00000000-0000-4000-8000-00000000c004";

const doc = (
  documentId: string,
  title: string,
  folder: string,
  documentType: string | null,
  access: MaterialDocument["access"],
  opening: string | null = null,
): MaterialDocument => ({
  documentId,
  title,
  folder,
  documentType,
  access,
  pageCount: 1,
  updatedAt: "2026-09-01T00:00:00.000Z",
  opening,
});

const ROOM: readonly MaterialDocument[] = [
  doc(
    CERT,
    "Certificate of Incorporation",
    "Corporate",
    "CERTIFICATE_OF_INCORPORATION",
    "OPEN",
    "Companies House (Scotland) Certificate of Incorporation. This is to certify that Halyard Security Ltd",
  ),
  doc(DECK, "Seed deck, October 2026", "Pitch", "PITCH_DECK", "OPEN"),
  doc(TAX, "Tax assurance letter", "Tax", "TAX", "REQUESTABLE"),
  doc(IP, "IP assignment deeds", "Legal", "IP_ASSIGNMENT", "REQUESTABLE"),
];

const reads: string[] = [];
const material: ProfileMaterialPort = {
  dataRoom: () => Promise.resolve(null),
  deck: () => Promise.resolve(null),
  ownCompanyId: () => Promise.resolve(null),
  documents: (_actor, companyId) =>
    Promise.resolve(companyId === COMPANY_B_NETWORK ? ROOM : null),
  documentText: (_actor, _companyId, documentId) => {
    reads.push(documentId);
    return Promise.resolve(
      documentId === CERT
        ? { text: "This is to certify that Halyard Security Ltd is incorporated.", truncated: false }
        : null,
    );
  },
};

const plan = planFor(actorA, "COUNTERPARTY_COMPANY_QUESTION", [
  { kind: "COMPANY_PROFILE", companyId: COMPANY_B_NETWORK, sensitivity: "CONFIDENTIAL" },
]);

describe("finding a company's document by meaning", () => {
  it("one clear match for what people call it", () => {
    for (const said of [
      "the incorporation document",
      "certificate of incorporation",
      "CAC certificate",
      "their company registration",
    ]) {
      const match = matchDocument(said, ROOM);
      expect(match.kind, said).toBe("ONE");
      if (match.kind === "ONE") expect(match.document.documentId).toBe(CERT);
    }
  });

  it("several likely ones when it is unclear, none when nothing fits", () => {
    expect(matchDocument("the legal documents and tax", ROOM).kind).toBe(
      "SEVERAL",
    );
    expect(matchDocument("their insurance policy schedule", ROOM).kind).toBe(
      "NONE",
    );
  });
});

describe("open_company_document", () => {
  const tool = createOpenCompanyDocumentTool(fakePorts(), material);

  it("opens the one it means with a UI intent naming the company", async () => {
    const decision = await tool.authorize(
      { company: "Beacon Analytics", document: "Beacon's incorporation document" },
      contextFor(actorA, plan),
    );
    expect(decision.outcome).toBe("ALLOW");
    if (decision.outcome !== "ALLOW") return;
    expect(decision.grant).toEqual({
      status: "SCREEN_WILL_DO_IT",
      clientAction: {
        kind: "OPEN_RECORD_PAGE",
        page: "DATA_ROOM_DOCUMENT",
        id: CERT,
        companyId: COMPANY_B_NETWORK,
        title: "Certificate of Incorporation",
      },
    });
  });

  it("never opens an on-request document, and says so without an intent", async () => {
    const decision = await tool.authorize(
      { companyId: COMPANY_B_NETWORK, document: "tax assurance letter" },
      contextFor(actorA, plan),
    );
    expect(decision.outcome).toBe("ALLOW");
    if (decision.outcome !== "ALLOW") return;
    expect(decision.grant).toMatchObject({ status: "ON_REQUEST" });
    expect(JSON.stringify(decision.grant)).not.toContain("SCREEN_WILL_DO_IT");
  });

  it("is refused for a company the plan does not admit", async () => {
    const other = planFor(actorA, "COUNTERPARTY_COMPANY_QUESTION", [
      { kind: "COMPANY_PROFILE", companyId: COMPANY_A, sensitivity: "CONFIDENTIAL" },
    ]);
    const decision = await tool.authorize(
      { companyId: COMPANY_B_NETWORK, document: "incorporation" },
      contextFor(actorA, other),
    );
    expect(decision.outcome).toBe("DENY");
  });
});

describe("read_company_document", () => {
  const tool = createReadCompanyDocumentTool(fakePorts(), material);

  it("reads the text of a document they may open, as the company's own material", async () => {
    const decision = await tool.authorize(
      { companyId: COMPANY_B_NETWORK, document: "certificate of incorporation" },
      contextFor(actorA, plan),
    );
    expect(decision.outcome).toBe("ALLOW");
    if (decision.outcome !== "ALLOW") return;
    expect(decision.grant).toMatchObject({
      status: "READ",
      documentId: CERT,
      truthClass: "USER_CLAIM",
      evidenceStatus: "DOCUMENT_SUPPORTED",
    });
  });

  it("never reads an on-request document", async () => {
    reads.length = 0;
    const decision = await tool.authorize(
      { companyId: COMPANY_B_NETWORK, documentId: TAX },
      contextFor(actorA, plan),
    );
    expect(decision.outcome).toBe("ALLOW");
    if (decision.outcome !== "ALLOW") return;
    expect(decision.grant).toMatchObject({ status: "ON_REQUEST" });
    expect(reads).toEqual([]);
  });
});
