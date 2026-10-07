// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { QResultBlock } from "@capital-q/contracts";

import { performClientAction } from "../src/features/q/client-actions";
import type { QTurn } from "../src/features/q/conversation";
import {
  answerToOffer,
  citedLines,
  documentActsOf,
  documentShouldClose,
  documentToReopen,
  offerLine,
  pageAfter,
  pdfOfferOf,
  sentenceSaid,
  sentencesOf,
} from "../src/features/q/room/document-room";
import { currentScreen, setMaterialDocument } from "../src/features/q/screen";

/**
 * Q room W3 (R3, R6): the document open in the Q room, worked by asking;
 * closing as the conversation moves on and reopening at the same page;
 * and the PDF offer after a long web answer. Code only, never a model.
 */

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CERT = id(51);
const LEDGERLINE = id(1);

const person = (n: number, text: string): QTurn => ({
  kind: "PERSON",
  id: `p${String(n)}`,
  text,
  unconfirmed: false,
});
const q = (
  n: number,
  text: string,
  blocks: readonly QResultBlock[] = [],
  extra: Partial<Extract<QTurn, { kind: "Q" }>> = {},
): QTurn => ({
  kind: "Q",
  id: `q${String(n)}`,
  text,
  streaming: false,
  sourceCount: 0,
  publicSources: [],
  findings: [],
  uncertainties: [],
  blocks: [...blocks],
  ...extra,
});
const act = (intent: Record<string, unknown>): QResultBlock =>
  ({
    kind: "UI_INTENT",
    intent: { kind: "DOCUMENT_ACT", ...intent },
  }) as QResultBlock;
const opens: QResultBlock = {
  kind: "UI_INTENT",
  intent: {
    kind: "OPEN_RECORD_PAGE",
    page: "DATA_ROOM_DOCUMENT",
    id: CERT,
    companyId: LEDGERLINE,
    title: "Certificate of Incorporation",
  },
};
const TITLE = "Certificate of Incorporation";

describe("paging by asking", () => {
  it("next, previous and go to page N stay inside the document", () => {
    const at = { page: 2, pageCount: 3 };
    expect(pageAfter(at, { kind: "DOCUMENT_ACT", act: "NEXT_PAGE" })).toBe(3);
    expect(
      pageAfter(
        { page: 3, pageCount: 3 },
        { kind: "DOCUMENT_ACT", act: "NEXT_PAGE" },
      ),
    ).toBe(3);
    expect(
      pageAfter(
        { page: 1, pageCount: 3 },
        { kind: "DOCUMENT_ACT", act: "PREVIOUS_PAGE" },
      ),
    ).toBe(1);
    expect(
      pageAfter(at, { kind: "DOCUMENT_ACT", act: "GO_TO_PAGE", page: 40 }),
    ).toBe(3);
    expect(
      pageAfter(at, { kind: "DOCUMENT_ACT", act: "READ_ALOUD", page: 1 }),
    ).toBe(1);
    expect(
      pageAfter(at, { kind: "DOCUMENT_ACT", act: "SUMMARISE" }),
    ).toBeNull();
  });

  it("reads acts from the answer, validated again, and the client action itself does nothing else", () => {
    const turn = q(1, "Page 2.", [
      act({ act: "NEXT_PAGE" }),
      act({ act: "GO_TO_PAGE" }),
      act({ act: "RUN_CODE" }),
    ]);
    expect(documentActsOf(turn)).toEqual([
      { kind: "DOCUMENT_ACT", act: "NEXT_PAGE" },
    ]);
    expect(
      performClientAction({ kind: "DOCUMENT_ACT", act: "NEXT_PAGE" }),
    ).toBe(true);
    expect(
      performClientAction({ kind: "DOCUMENT_ACT", act: "GO_TO_PAGE" }),
    ).toBe(false);
  });

  it("tells Q which page is open as a number only", () => {
    setMaterialDocument({ companyId: LEDGERLINE, documentId: CERT }, 2);
    expect(currentScreen("/home")).toMatchObject({
      documentId: CERT,
      documentPage: 2,
    });
    setMaterialDocument({ companyId: LEDGERLINE, documentId: CERT }, 0);
    expect(currentScreen("/home")).not.toHaveProperty("documentPage");
    setMaterialDocument(null);
  });
});

describe("the page-cited summary", () => {
  it("keeps only lines that cite a page, each linked to it", () => {
    expect(
      citedLines(
        "Here is the summary.\n- Incorporated 12 March 2023 in England (p. 1)\n- **10,000,000** ordinary shares (pp. 2-3)\nAsk me for more.",
      ),
    ).toEqual([
      { text: "Incorporated 12 March 2023 in England", pages: [1] },
      { text: "10,000,000 ordinary shares", pages: [2, 3] },
    ]);
    expect(citedLines("Nothing cited here.")).toEqual([]);
  });
});

describe("reading aloud", () => {
  it("highlights the sentence being said, and nothing for a loose gist", () => {
    const page = sentencesOf(
      "This is to certify that Ledgerline Technologies Ltd is incorporated. The company is limited by shares. Given at Cardiff.",
    );
    expect(page).toHaveLength(3);
    expect(sentenceSaid(page, "The company is limited by shares.")).toBe(1);
    expect(sentenceSaid(page, "Anything else I can help with?")).toBeNull();
  });
});

describe("closing as the conversation moves on (founder, 6 October)", () => {
  it("stays while the talk is on the document", () => {
    const turns = [
      q(1, "Here it is.", [opens]),
      person(2, "Next page"),
      q(2, "Page 2.", [act({ act: "NEXT_PAGE" })]),
      person(3, "What does the certificate say about shares?"),
      q(3, "Ten million ordinary shares (p. 2)."),
    ];
    expect(documentShouldClose(turns, CERT, TITLE)).toBe(false);
  });

  it("closes on a new subject, on 'close it', or when Q puts something else up", () => {
    expect(
      documentShouldClose(
        [
          q(1, "Here it is.", [opens]),
          person(2, "How did Clearwater do last month?"),
          q(2, "Clearwater made £41k in September."),
        ],
        CERT,
        TITLE,
      ),
    ).toBe(true);
    expect(
      documentShouldClose(
        [q(1, "Here it is.", [opens]), person(2, "Close it")],
        CERT,
        TITLE,
      ),
    ).toBe(true);
    expect(
      documentShouldClose(
        [
          q(1, "Here it is.", [opens]),
          q(2, "Closed.", [act({ act: "CLOSE" })]),
        ],
        CERT,
        TITLE,
      ),
    ).toBe(true);
  });

  it("reopens when the subject comes back, the newest by name", () => {
    const closed = [
      { documentId: id(60), title: "Cap table" },
      { documentId: CERT, title: TITLE },
    ];
    expect(
      documentToReopen("Back to the incorporation certificate", closed)
        ?.documentId,
    ).toBe(CERT);
    expect(documentToReopen("How is Clearwater doing?", closed)).toBeNull();
    expect(documentToReopen("close the certificate", closed)).toBeNull();
  });
});

describe("a long web answer is offered as a PDF (R6)", () => {
  const long = Array.from({ length: 1_100 }, () => "word").join(" ");
  const source = {
    url: "https://example.com/a",
    domain: "example.com",
    title: "A",
    publishedOn: null,
  } as unknown as Extract<QTurn, { kind: "Q" }>["publicSources"][number];

  it("offers it only for a long answer that read the web", () => {
    expect(
      pdfOfferOf([q(1, long, [], { runId: id(9), publicSources: [source] })]),
    ).toEqual({ answerId: "q1", runId: id(9), words: 1_100 });
    expect(pdfOfferOf([q(1, long, [], { runId: id(9) })])).toBeNull();
    expect(
      pdfOfferOf([
        q(1, "Short.", [], { runId: id(9), publicSources: [source] }),
      ]),
    ).toBeNull();
    expect(offerLine(1_100)).toBe(
      "That's about 1,100 words. Want it as a PDF?",
    );
  });

  it("reads a plain yes or no, and nothing else", () => {
    expect(answerToOffer("Yes please")).toBe("YES");
    expect(answerToOffer("sure.")).toBe("YES");
    expect(answerToOffer("No thanks")).toBe("NO");
    expect(answerToOffer("Yes, but first tell me about Clearwater")).toBeNull();
  });
});
