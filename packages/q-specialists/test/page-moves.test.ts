import { describe, expect, it } from "vitest";

import type { QAnswerRequest } from "@capital-q/q-runtime";

import {
  counterpartNavigationRecords,
  createOpenRecordNavigationResolver,
  recordPageForRoute,
} from "../src/page-moves.js";
import type { QOpenRecordPort } from "../src/references.js";

/**
 * Q Workspace W4.3 in the answer path: names the decision gives are found
 * as the person, through open_page's own authorise step; never an id from
 * the model, never a guess.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const founderRequest = {
  plan: { scopes: [] },
} as unknown as QAnswerRequest;
const investorRequest = {
  plan: {
    scopes: [
      {
        kind: "INVESTOR_MANDATE",
        subject: {
          kind: "INVESTOR_ORGANISATION",
          investorOrganisationId: "22222222-2222-4222-8222-222222222222",
        },
      },
    ],
  },
} as unknown as QAnswerRequest;

function openRecord(found: Record<string, string>) {
  const asked: { page: string; name: string | undefined }[] = [];
  const port: QOpenRecordPort = {
    open: (_request, target) => {
      asked.push({ page: target.page, name: target.name });
      const id = target.name === undefined ? undefined : found[target.name];
      return Promise.resolve(
        id === undefined
          ? null
          : { kind: "OPEN_RECORD_PAGE", page: target.page, id },
      );
    },
  };
  return { asked, port };
}

const ask = (
  over: Partial<
    Parameters<
      ReturnType<ReturnType<typeof createOpenRecordNavigationResolver>>
    >[0]
  >,
) => ({
  kind: "COMPANY" as const,
  name: "Silo Credit",
  document: null,
  route: "/company/[companyId]",
  tab: null,
  ...over,
});

describe("the record page a route shows", () => {
  it("reads it from the site map, a relationship's messages tab as its thread", () => {
    expect(recordPageForRoute("/company/[companyId]", "deck")).toBe("COMPANY");
    expect(
      recordPageForRoute("/relationships/company/[companyId]", "messages"),
    ).toBe("RELATIONSHIP_COMPANY_MESSAGES");
    expect(recordPageForRoute("/work", null)).toBeNull();
  });
});

describe("resolution as the person (open_page)", () => {
  it("finds a named record on the page the route shows", async () => {
    const { asked, port } = openRecord({ "Silo Credit": COMPANY });
    const resolve = createOpenRecordNavigationResolver(port)(founderRequest);
    expect(await resolve(ask({ tab: "deck" }))).toEqual({
      status: "FOUND",
      recordId: COMPANY,
      documentId: null,
    });
    await resolve(
      ask({ route: "/relationships/company/[companyId]", tab: "messages" }),
    );
    expect(asked).toEqual([
      { page: "COMPANY", name: "Silo Credit" },
      { page: "RELATIONSHIP_COMPANY_MESSAGES", name: "Silo Credit" },
    ]);
  });

  it("NONE for a name they cannot see, a document by title, a page with no record, and the Board", async () => {
    const { asked, port } = openRecord({});
    const resolve = createOpenRecordNavigationResolver(port)(founderRequest);
    expect(await resolve(ask({}))).toEqual({ status: "NONE" });
    expect(
      await resolve(ask({ tab: "dataroom", document: "Cap table" })),
    ).toEqual({ status: "NONE" });
    expect(await resolve(ask({ route: "/work" }))).toEqual({ status: "NONE" });
    expect(
      await resolve(
        ask({ kind: "THING", name: "Call Tunde", route: "/board" }),
      ),
    ).toEqual({ status: "NONE" });
    // Only the first was asked: the rest never reach a tool.
    expect(asked).toHaveLength(1);
  });
});

describe("the names the prompt lists", () => {
  it("their counterparts, as companies for an investor and investors for a founder", async () => {
    const names = () => Promise.resolve(["Silo Credit", "Kora Farms"]);
    const records = counterpartNavigationRecords(names);
    expect(
      (await records(investorRequest)).companies.map((c) => c.name),
    ).toEqual(["Silo Credit", "Kora Farms"]);
    expect((await records(founderRequest)).investors).toHaveLength(2);
    expect((await records(founderRequest)).companies).toEqual([]);
  });
});
