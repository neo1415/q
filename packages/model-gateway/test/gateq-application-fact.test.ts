import { describe, expect, it } from "vitest";

import {
  createGateqLabelGuard,
  gateqCitation,
  gateqReadingHeld,
  NO_GATEQ_READING_LINE,
  readNamedGateqApplications,
  withoutUnsourcedGateqLabels,
} from "../src/q/gateq-application-fact.js";

/**
 * Live scenario F, defect 5 (16 Nov 2026, runs 11daded9 and b6b09a05):
 * Thames Arc asked about Halyard in the general chat; Q had no GateQ read
 * and still said "entered GateQ at seed stage" and "GateQ diligence".
 */
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HALYARD = id(7);
const TOOLS = new Set(["read_my", "gateq_inbox_summarise"]);

const reading = (applicationId: string) => ({
  v: 1,
  subject: {
    kind: "GATEQ_SUBMISSION",
    gatewayId: id(100),
    applicationId,
    reference: "ga_halyard",
    submittedAt: "2026-11-16T14:03:00.000Z",
    dossierSchemaVersion: "gateq-dossier.v2",
  },
  text: "Halyard Security: maritime cyber.\nStage: Seed (Given in the form); earlier, corrected: Pre-seed.\nUnresolved: none.",
  sources: [],
});

type Call = { name: string; args: Readonly<Record<string, unknown>> };

/**
 * The tool port as the gateway sees it: what the inbox service returns to
 * THIS actor. `inbox` is what their own gateway's inbox lists (submitted
 * applications only); `summarise` answers one id, or null when refused.
 */
function port(
  inbox: readonly { id: string; title: string }[] | null,
  summarise: (applicationId: string) => unknown,
) {
  const calls: Call[] = [];
  return {
    calls,
    execute: (name: string, args: Readonly<Record<string, unknown>>) => {
      calls.push({ name, args });
      if (name === "read_my")
        return Promise.resolve({
          kind: "gateq",
          available: inbox !== null,
          items: (inbox ?? []).map((item) => ({
            id: item.id,
            title: item.title,
            status: "unread; awaiting reply",
            at: "2026-11-16T14:03:00.000Z",
            facts: {},
          })),
        });
      return Promise.resolve(summarise(String(args["applicationId"])));
    },
  };
}

const done = (applicationId: string) => ({
  status: "DONE",
  says: "Halyard Security. Applicant claims are not independently verified.",
  reading: reading(applicationId),
});

describe("reading a named company's submitted GateQ application", () => {
  it("the owning investor's turn reads the submitted dossier, cited as their GateQ application (submitted <date>)", async () => {
    const tools = port([{ id: HALYARD, title: "Halyard Security" }], (app) =>
      app === HALYARD ? done(app) : null,
    );
    const facts = await readNamedGateqApplications({
      side: "INVESTOR",
      available: TOOLS,
      latest:
        "What stage did Halyard give, and are any of their GateQ answers still unresolved?",
      earlier: [],
      execute: tools.execute,
    });
    expect(tools.calls).toEqual([
      { name: "read_my", args: { kind: "gateq" } },
      { name: "gateq_inbox_summarise", args: { applicationId: HALYARD } },
    ]);
    expect(facts).toHaveLength(1);
    const [fact] = facts;
    expect(fact?.source).toBe(
      "Their GateQ application (submitted 16 Nov 2026)",
    );
    expect(fact?.statement).toContain(
      'Cite it as "their GateQ application (submitted 16 Nov 2026)"',
    );
    expect(fact?.statement).toContain("Stage: Seed (Given in the form)");
    expect(fact?.statement).toContain("diligence");
    expect(fact?.truthClass).toBe("USER_CLAIM");
    expect(gateqCitation("2026-11-16T14:03:00.000Z")).toBe(
      "their GateQ application (submitted 16 Nov 2026)",
    );
  });

  it("follows the conversation's company on a pointer turn ('they')", async () => {
    const tools = port([{ id: HALYARD, title: "Halyard Security" }], done);
    const facts = await readNamedGateqApplications({
      side: "INVESTOR",
      available: TOOLS,
      latest: "What stage did they give in it?",
      earlier: ["Where has Halyard Security got to with its application?"],
      execute: tools.execute,
    });
    expect(facts).toHaveLength(1);
  });

  it("another investor: the company is not in their inbox, so nothing is read", async () => {
    // Their own gateway lists other applications; Halyard applied elsewhere.
    const tools = port([{ id: id(9), title: "Watchly" }], done);
    const facts = await readNamedGateqApplications({
      side: "INVESTOR",
      available: TOOLS,
      latest: "Has Halyard Security applied through GateQ?",
      earlier: [],
      execute: tools.execute,
    });
    expect(facts).toEqual([]);
    expect(tools.calls.map((c) => c.name)).toEqual(["read_my"]);
  });

  it("a refused or different-application summarise is never used", async () => {
    for (const answer of [
      null,
      { status: "NOT_DONE", says: "That isn’t in your GateQ inbox." },
      done(id(8)),
    ]) {
      const tools = port(
        [{ id: HALYARD, title: "Halyard Security" }],
        () => answer,
      );
      const facts = await readNamedGateqApplications({
        side: "INVESTOR",
        available: TOOLS,
        latest: "Summarise Halyard Security",
        earlier: [],
        execute: tools.execute,
      });
      expect(facts).toEqual([]);
    }
  });

  it("an in-progress draft is not listed by the inbox, so it is never read", async () => {
    // The inbox service lists application_submissions only: a draft
    // (application 0490be41, IN_PROGRESS) is simply absent.
    const tools = port([], done);
    const facts = await readNamedGateqApplications({
      side: "INVESTOR",
      available: TOOLS,
      latest: "Where has Halyard Security got to with its GateQ application?",
      earlier: [],
      execute: tools.execute,
    });
    expect(facts).toEqual([]);
    expect(tools.calls.some((c) => c.name === "gateq_inbox_summarise")).toBe(
      false,
    );
  });

  it("a founder's turn reads nothing here, and their GateQ wording is untouched", async () => {
    const tools = port([{ id: HALYARD, title: "Halyard Security" }], done);
    const facts = await readNamedGateqApplications({
      side: "FOUNDER",
      available: TOOLS,
      latest: "How is Halyard Security's GateQ application to Thames Arc?",
      earlier: [],
      execute: tools.execute,
    });
    expect(facts).toEqual([]);
    expect(tools.calls).toEqual([]);
    const said = "Your GateQ application to Thames Arc is still in progress.";
    expect(withoutUnsourcedGateqLabels(said, false, false).text).toBe(said);
    expect(createGateqLabelGuard(false, () => false).sentence(said)).toBe(said);
  });

  it("without the tools in this run, nothing is read", async () => {
    const tools = port([{ id: HALYARD, title: "Halyard Security" }], done);
    expect(
      await readNamedGateqApplications({
        side: "INVESTOR",
        available: new Set(["read_my"]),
        latest: "Halyard Security",
        earlier: [],
        execute: tools.execute,
      }),
    ).toEqual([]);
    expect(tools.calls).toEqual([]);
  });
});

describe("GateQ is said only about a GateQ reading", () => {
  // Run b6b09a05's answer, verbatim.
  const LIVE =
    "Halyard Security entered GateQ at seed stage. The latest record shows its GateQ diligence is now in progress: it has shared the August–October 2026 business account statement and the capitalisation table and ownership document, and no diligence requests remain open. The substantive ownership details still need assessment, and the record does not include the actual GateQ application answers or establish that every answer has been resolved.";

  it("the live answer: the GateQ claim goes, diligence is diligence, the absence stays", () => {
    const out = withoutUnsourcedGateqLabels(LIVE, true, false);
    expect(out.text).not.toContain("entered GateQ");
    expect(out.text).not.toContain("GateQ diligence");
    expect(out.text).toContain(NO_GATEQ_READING_LINE);
    expect(out.text).toContain(
      "The latest record shows its diligence is now in progress",
    );
    expect(out.text).toContain(
      "the record does not include the actual GateQ application answers",
    );
    expect(out.changed).toBe(2);
  });

  it("streamed sentences get the same treatment, the absence line once", () => {
    const guard = createGateqLabelGuard(true, () => false);
    expect(
      guard.sentence("Halyard Security entered GateQ at seed stage."),
    ).toBe(NO_GATEQ_READING_LINE);
    expect(guard.sentence("Its GateQ answers were all resolved.")).toBeNull();
    expect(guard.sentence("Its GateQ diligence is in progress.")).toBe(
      "Its diligence is in progress.",
    );
    expect(guard.sentence("Open your GateQ inbox to see applications.")).toBe(
      "Open your GateQ inbox to see applications.",
    );
    expect(guard.sentence("Their deck says seed.")).toBe(
      "Their deck says seed.",
    );
  });

  it("with the application read this run, the answer stands as written", () => {
    const facts = [
      {
        statement:
          "THEIR GATEQ APPLICATION: Halyard Security, GateQ application (submitted 16 Nov 2026) ...",
      },
    ];
    const held = gateqReadingHeld({ facts, toolResults: [] });
    expect(held).toBe(true);
    const said =
      "In their GateQ application (submitted 16 Nov 2026), Halyard gave seed as its stage.";
    expect(withoutUnsourcedGateqLabels(said, true, held).text).toBe(said);
    expect(createGateqLabelGuard(true, () => held).sentence(said)).toBe(said);
  });

  it("counts the model's own DONE summarise and the selected dossier, never a refusal or their words", () => {
    const body = (data: unknown) => JSON.stringify({ ok: true, data });
    const tool = (content: string) => ({
      role: "TOOL",
      name: "gateq_inbox_summarise",
      content,
    });
    expect(
      gateqReadingHeld({ facts: [], toolResults: [tool(body(done(HALYARD)))] }),
    ).toBe(true);
    expect(
      gateqReadingHeld({
        facts: [{ statement: "SELECTED SUBMITTED GATEQ APPLICATION ga_x ..." }],
        toolResults: [],
      }),
    ).toBe(true);
    expect(
      gateqReadingHeld({
        facts: [],
        toolResults: [
          tool(body({ status: "NOT_DONE", says: "That isn’t in your inbox." })),
          tool(JSON.stringify({ ok: false, error: { code: "NOT_AVAILABLE" } })),
          {
            role: "USER",
            content: `${body(done(HALYARD))} THEIR GATEQ APPLICATION`,
          },
        ],
      }),
    ).toBe(false);
  });
});
