import { describe, expect, it } from "vitest";

import {
  existingRequestFor,
  openResolutionOf,
  requestStateLine,
  resolutionTitleOf,
  sameItem,
} from "../src/q/uncertainty.js";

/**
 * D15b and D15 (live 15 Nov 2026): request 4c9a2968 was headed "Evidence
 * that settles: Whether Ajopot's 18,700 active users represent recurring,
 * financially relevant usage is unresolved." -- naming no document; and
 * after Ajopot answered it, the same item was offered again.
 */

const LIVE_ABOUT =
  "Whether Ajopot's 18,700 active users represent recurring, financially relevant usage is unresolved.";

describe("a request's title is document-like; what it is about stays beside it (D15b)", () => {
  it("names what the item is about, not the uncertainty sentence", () => {
    const title = resolutionTitleOf(LIVE_ABOUT, "Ajopot");
    expect(title).toBe("Supporting evidence for Ajopot's 18,700 active users");
    expect(title).not.toMatch(/settles|unresolved|Whether/u);
  });

  it("a document the answer suggested is the title", () => {
    expect(
      resolutionTitleOf(
        LIVE_ABOUT,
        "Ajopot",
        "a reconciled six-month cohort table.",
      ),
    ).toBe("A reconciled six-month cohort table");
  });

  it("is short, and falls back to the company when the sentence has no subject", () => {
    expect(
      resolutionTitleOf(
        'Ajopot has not defined "active" or the period behind 18,700 users.',
        "Ajopot",
      ),
    ).toBe("Supporting evidence for Ajopot");
    expect(
      resolutionTitleOf("x ".repeat(300), null).length,
    ).toBeLessThanOrEqual(80);
  });

  it("the open item keeps `about` separate from the title", () => {
    const item = openResolutionOf("run", {
      action: "diligence_documents",
      about: { statement: LIVE_ABOUT, standing: "REPORTED" },
      counterparty: { kind: "COMPANY", id: "c1", name: "Ajopot" },
    });
    expect(item?.about.statement).toBe(LIVE_ABOUT);
    expect(item?.title).toBe(
      "Supporting evidence for Ajopot's 18,700 active users",
    );
  });
});

describe("a request already made for the same item (D15)", () => {
  const followUp = (status: "OPEN" | "FULFILLED" | "DECLINED") => ({
    title: "Evidence that settles: whether active users are recurring",
    about: { statement: LIVE_ABOUT, standing: "REPORTED" },
    status,
    requestedAt: "2026-11-15T03:10:32.000Z",
    fulfilledAt: status === "FULFILLED" ? "2026-11-15T03:12:01.000Z" : null,
    document:
      status === "FULFILLED"
        ? { title: "Ajopot company overview", summary: null }
        : null,
    answers: [],
    declineNote: null,
  });

  it("is found for the same item reworded, not for a different one", () => {
    const reworded =
      "It is unresolved whether Ajopot's 18,700 active users represent recurring, financially relevant usage.";
    expect(sameItem(LIVE_ABOUT, reworded)).toBe(true);
    expect(
      sameItem(
        LIVE_ABOUT,
        "The cap table after the bridge round has not been shared.",
      ),
    ).toBe(false);
    expect(existingRequestFor(reworded, [followUp("FULFILLED")])?.status).toBe(
      "FULFILLED",
    );
    expect(existingRequestFor(reworded, [followUp("DECLINED")])).toBeNull();
  });

  it("says where the request stands from the request, never an approval card", () => {
    expect(requestStateLine("Ajopot", followUp("FULFILLED"))).toBe(
      'You asked Ajopot for "Evidence that settles: whether active users are recurring" on 2026-11-15; they answered on 2026-11-15 with "Ajopot company overview", so I haven\'t asked again.',
    );
    expect(requestStateLine("Ajopot", followUp("OPEN"))).toContain(
      "it's still outstanding",
    );
  });
});
