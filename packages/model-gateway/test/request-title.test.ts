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
    const now = new Date("2026-11-20T10:00:00.000Z");
    expect(requestStateLine("Ajopot", followUp("FULFILLED"), { now })).toBe(
      'You asked Ajopot for "Evidence that settles: whether active users are recurring" on 15 Nov; they answered on 15 Nov with "Ajopot company overview", so I haven\'t asked again.',
    );
    expect(requestStateLine("Ajopot", followUp("OPEN"), { now })).toContain(
      "it's still outstanding",
    );
  });

  describe("D19 (live 5c9344fd): a whole title and days as a person says them", () => {
    // The live request 4c9a2968: made before D15b, so its title is the
    // uncertainty sentence with the old prefix (well over 80 characters).
    const live = {
      ...followUp("FULFILLED"),
      title: `Evidence that settles: ${LIVE_ABOUT}`,
    };

    it("an older request is named by what it is about, cut at a word with an ellipsis", () => {
      const line = requestStateLine("Ajopot", live, {
        now: new Date("2026-11-15T06:25:48.000Z"),
      });
      expect(line).not.toMatch(/unresolve"/u);
      expect(line).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
      expect(line).toBe(
        `You asked Ajopot for "${LIVE_ABOUT}" today; they answered today with "Ajopot company overview", so I haven't asked again.`,
      );
      const statement = `${LIVE_ABOUT} It also depends on the definition of active, on the cohort period and on the reconciliation with revenue.`;
      const long = requestStateLine(
        "Ajopot",
        { ...live, about: { statement, standing: "REPORTED" } },
        { now: new Date("2026-11-15T06:25:48.000Z") },
      );
      const quotedTitle = /for "([^"]+)"/u.exec(long)?.[1] ?? "";
      expect(quotedTitle.endsWith("…")).toBe(true);
      expect(quotedTitle.length).toBeLessThanOrEqual(120);
      // Cut between words: what precedes the ellipsis is the statement's
      // own opening, ending where a word ends.
      const before = quotedTitle.slice(0, -1);
      expect(statement.startsWith(before)).toBe(true);
      expect(statement.charAt(before.length)).toMatch(/[\s,.]/u);
    });

    it("a request made since D15b keeps its own short title", () => {
      const line = requestStateLine(
        "Ajopot",
        {
          ...live,
          title: "Supporting evidence for Ajopot's 18,700 active users",
        },
        { now: new Date("2026-11-16T09:00:00.000Z") },
      );
      expect(line).toBe(
        'You asked Ajopot for "Supporting evidence for Ajopot\'s 18,700 active users" yesterday; they answered yesterday with "Ajopot company overview", so I haven\'t asked again.',
      );
    });

    it("the day is the person's calendar day when their zone is known", () => {
      const line = requestStateLine(
        "Ajopot",
        { ...live, requestedAt: "2026-11-12T23:30:00.000Z", status: "OPEN" },
        { now: new Date("2026-11-15T06:00:00.000Z"), timeZone: "Africa/Lagos" },
      );
      expect(line).toContain(" on 13 Nov, and it's still outstanding");
    });
  });
});
