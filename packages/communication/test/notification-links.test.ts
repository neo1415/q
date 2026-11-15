import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  isNotificationLinkPath,
  NOTIFICATION_LINK_PATH_PATTERN,
} from "@capital-q/contracts";
import { describe, expect, it } from "vitest";

import {
  COUNTERPART_NOTICE_TARGETS,
  counterpartNoticeLinkPath,
} from "../src/counterpart-notices.js";

/**
 * Live audit 2026-11-15 D1: data-room and document-request notices were
 * never written. Their links carried `?`, `&` or `#`, the database's
 * notifications_link_path_check refused the insert, and the caller
 * swallowed the refusal. Every link a producer builds now goes through the
 * same rule the database applies, here, so a bad link fails in a test.
 */

/** The database's own check, copied verbatim from the migration. */
const MIGRATION = readFileSync(
  resolve(
    import.meta.dirname,
    "../../../supabase/migrations/20261019090000_communication_meetings_reminders.sql",
  ),
  "utf8",
);
const DATABASE_RULE = (() => {
  const found = /link_path ~ '([^']+)'/u.exec(MIGRATION);
  if (found?.[1] === undefined) throw new Error("link_path check not found");
  return new RegExp(found[1], "u");
})();

const COMPANY = "11111111-1111-4111-8111-111111111111";
const INVESTOR = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";

describe("the notification link rule", () => {
  it("is the database's check, plus never a scheme-relative `//`", () => {
    expect(DATABASE_RULE.source).toBe("^\\/[A-Za-z0-9/_-]{0,200}$");
    for (const ok of ["/", "/documents/requested", `/company/${COMPANY}`]) {
      expect(isNotificationLinkPath(ok)).toBe(true);
      expect(DATABASE_RULE.test(ok)).toBe(true);
    }
    for (const bad of [
      "/documents?tab=requested",
      `/company/${COMPANY}#data-room`,
      "https://elsewhere.example/x",
      "//elsewhere",
      "documents",
      "/a b",
      `/${"x".repeat(201)}`,
    ]) {
      expect(isNotificationLinkPath(bad), bad).toBe(false);
    }
    // Everything the shared rule accepts, the database accepts.
    expect(NOTIFICATION_LINK_PATH_PATTERN.test("//x")).toBe(false);
    expect(DATABASE_RULE.test("//x")).toBe(true);
  });
});

describe("counterpart notice links (every target, both sides)", () => {
  it("are plain in-app paths the database accepts", () => {
    const seen: string[] = [];
    for (const target of COUNTERPART_NOTICE_TARGETS) {
      for (const actingSide of ["INVESTOR", "COMPANY"] as const) {
        const link = counterpartNoticeLinkPath({
          target,
          actingSide,
          key: REQUEST,
          companyId: COMPANY,
          investorOrganisationId: INVESTOR,
        });
        expect(isNotificationLinkPath(link), `${target}/${actingSide}`).toBe(
          true,
        );
        expect(DATABASE_RULE.test(link), `${target}/${actingSide}`).toBe(true);
        seen.push(`${target}:${actingSide}:${link}`);
      }
    }
    expect(seen).toEqual([
      "INBOX:INVESTOR:/company/interest",
      "INBOX:COMPANY:/investors",
      `CHAT:INVESTOR:/relationships/investor/${INVESTOR}/messages`,
      `CHAT:COMPANY:/relationships/company/${COMPANY}/messages`,
      `RELATIONSHIP:INVESTOR:/relationships/investor/${INVESTOR}`,
      `RELATIONSHIP:COMPANY:/relationships/company/${COMPANY}`,
      `DILIGENCE:INVESTOR:/relationships/investor/${INVESTOR}/diligence`,
      `DILIGENCE:COMPANY:/relationships/company/${COMPANY}/diligence`,
      "CAPITAL:INVESTOR:/capital",
      "CAPITAL:COMPANY:/capital",
      // The founder's Requested tab at this request (web redirect).
      `DOCUMENTS:INVESTOR:/documents/requested/${REQUEST}`,
      `DOCUMENTS:COMPANY:/documents/requested/${REQUEST}`,
      // The investor's Data room tab of the company (web redirect).
      `COMPANY_PROFILE:INVESTOR:/company/${COMPANY}/data-room`,
      `COMPANY_PROFILE:COMPANY:/company/${COMPANY}/data-room`,
    ]);
  });

  it("a key that cannot stand as a path segment opens the Requested tab itself", () => {
    for (const key of ["a?b", "a#b", "a/b", "", "../x", "x".repeat(121)]) {
      expect(
        counterpartNoticeLinkPath({
          target: "DOCUMENTS",
          actingSide: "INVESTOR",
          key,
          companyId: COMPANY,
          investorOrganisationId: INVESTOR,
        }),
      ).toBe("/documents/requested");
    }
  });

  it("refuses an id that would break the rule, before any insert", () => {
    expect(() =>
      counterpartNoticeLinkPath({
        target: "COMPANY_PROFILE",
        actingSide: "INVESTOR",
        key: REQUEST,
        companyId: "x?y",
        investorOrganisationId: INVESTOR,
      }),
    ).toThrow(/notification link rule/u);
  });
});

/**
 * Every producer in the repository: each `insert into
 * communication.notifications` in service code. The literal links in the
 * statement (SQL '...' and JS "..."/`...` that start with "/") must pass
 * the rule, with `${...}` read as an id. A new producer with a query or a
 * fragment in its link fails here.
 */
describe("every notification producer's literal links", () => {
  const ROOT = resolve(import.meta.dirname, "../../..");
  const sources = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name === "test") {
        continue;
      }
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...sources(full));
      else if (/\.(?:ts|mjs)$/u.test(name) && !/\.test\./u.test(name)) {
        out.push(full);
      }
    }
    return out;
  };
  const producers = ["packages", "apps"]
    .flatMap((top) =>
      readdirSync(join(ROOT, top)).map((name) => join(ROOT, top, name, "src")),
    )
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    })
    .flatMap(sources)
    .filter((file) =>
      readFileSync(file, "utf8").includes(
        "insert into communication.notifications",
      ),
    );

  it("finds the producers", () => {
    expect(producers.length).toBeGreaterThan(15);
  });

  it("writes only links the database accepts", () => {
    const bad: string[] = [];
    for (const file of producers) {
      const text = readFileSync(file, "utf8");
      let from = text.indexOf("insert into communication.notifications");
      while (from !== -1) {
        const end = text.indexOf("on conflict", from);
        const block = text.slice(from, end === -1 ? from + 4_000 : end);
        const literals = [
          ...block.matchAll(/'(\/[^']*)'/gu),
          ...block.matchAll(/"(\/[^"]*)"/gu),
          ...block.matchAll(/`(\/[^`]*)`/gu),
        ].map((match) => match[1] ?? "");
        for (const literal of literals) {
          const path = literal.replace(/\$\{[^}]*\}/gu, COMPANY);
          // A literal that is only the start of a concatenated path
          // ('/relationships/company/' || id) is checked with an id after.
          const whole = path.endsWith("/") ? `${path}${COMPANY}` : path;
          if (!isNotificationLinkPath(whole)) {
            bad.push(`${relative(ROOT, file)}: ${literal}`);
          }
        }
        // A query or fragment concatenated on ('/company/' || id ||
        // '#data-room', the D1 shape).
        for (const match of block.matchAll(/'([?#][^']*)'/gu)) {
          bad.push(`${relative(ROOT, file)}: ${match[1] ?? ""}`);
        }
        from = text.indexOf(
          "insert into communication.notifications",
          from + 1,
        );
      }
    }
    expect(bad).toEqual([]);
  });
});
