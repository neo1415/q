import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import {
  QArtifactIdSchema,
  QRunIdSchema,
  type QArtifactDetail,
  type QMessage,
} from "@capital-q/contracts";
import type { ArtifactService } from "@capital-q/q-artifacts";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";
import { createSpreadsheetPort } from "../src/composition/spreadsheets.js";

/**
 * XLSX-001: a SPREADSHEET artifact downloads as a real .xlsx (and CSV)
 * through the same export route as every other document, and the port
 * behind make_spreadsheet reads Q's earlier answers as the run's owner and
 * files the workbook as their own private document.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const CONTEXT: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const ARTIFACT = QArtifactIdSchema.parse(
  "11111111-0000-4000-8000-000000000002",
);
const RUN = QRunIdSchema.parse("22222222-0000-4000-8000-000000000002");
const NOW = "2026-10-28T10:00:00.000Z";

function detail(): QArtifactDetail {
  return {
    artifact: {
      artifactId: ARTIFACT,
      type: "SPREADSHEET",
      status: "READY",
      title: "Pipeline",
      summary: "Your pipeline.",
      currentVersion: 1,
      createdAt: NOW,
      updatedAt: NOW,
    },
    current: {
      artifactId: ARTIFACT,
      version: 1,
      title: "Pipeline",
      summary: "Your pipeline.",
      composedByRunId: RUN,
      createdAt: NOW,
      content: {
        sections: [
          {
            heading: "What is in this spreadsheet",
            body: "Pipeline.",
            findings: [],
          },
        ],
        gaps: [],
        workbook: {
          sheets: [
            {
              name: "Pipeline",
              columns: [
                { key: "counterparty", label: "Counterparty", type: "text" },
                { key: "since", label: "Since", type: "date" },
              ],
              rows: [["Zino Aviation Capital", "2026-10-01"]],
              totals: [],
            },
          ],
          sources: [
            {
              sheet: "Pipeline",
              columns: ["Counterparty", "Since"],
              from: "Your Capital Q relationship history",
              truthClass: "VERIFIED",
              refs: [],
            },
          ],
          provenance:
            "Prepared by Q from your Capital Q records on 2026-10-28.",
        },
      },
    },
    history: [{ version: 1, title: "Pipeline", createdAt: NOW }],
  };
}

function buildApp() {
  const artifacts = {
    read: () => Promise.resolve(detail()),
    readVersion: () => Promise.resolve(detail()),
  } as unknown as ArtifactService;
  const security: QApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(PRINCIPAL) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
  };
  return createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    artifacts,
  }).app;
}

describe("a spreadsheet's files", () => {
  it("downloads as an .xlsx Excel opens, named from its title", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/v1/q/artifacts/${ARTIFACT}/export/xlsx`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="Pipeline.xlsx"',
    );
    // A real OOXML package (read back cell by cell in deck-render's tests).
    expect(response.rawPayload.subarray(0, 4)).toEqual(
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    );
    expect(response.rawPayload.includes(Buffer.from("xl/workbook.xml"))).toBe(
      true,
    );
    await app.close();
  });

  it("downloads as CSV, and says plainly that it is not a PDF", async () => {
    const app = buildApp();
    const csv = await app.inject({
      method: "GET",
      url: `/v1/q/artifacts/${ARTIFACT}/export/csv`,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(csv.body).toContain("Zino Aviation Capital,2026-10-01");
    const pdf = await app.inject({
      method: "GET",
      url: `/v1/q/artifacts/${ARTIFACT}/export/pdf`,
    });
    expect(pdf.statusCode).toBe(409);
    expect(pdf.json()).toMatchObject({
      code: "FORMAT_NOT_AVAILABLE",
      detail: "A spreadsheet downloads as Excel or CSV.",
    });
    await app.close();
  });
});

describe("the make_spreadsheet port", () => {
  const answer = (id: string, blocks: unknown[]): QMessage =>
    ({
      messageId: id,
      runId: RUN,
      role: "Q",
      blocks,
      createdAt: NOW,
    }) as QMessage;

  it("reads Q's answers in the run's conversation newest first, and files as their own document", async () => {
    const asked: string[] = [];
    const filed: unknown[] = [];
    const port = createSpreadsheetPort({
      conversationOf: (actor, runId) => {
        asked.push(`${actor.userId}:${runId}`);
        return Promise.resolve("33333333-0000-4000-8000-000000000003");
      },
      conversationMessages: () =>
        Promise.resolve([
          answer("44444444-0000-4000-8000-000000000001", [
            { kind: "TEXT", text: "older" },
          ]),
          {
            messageId: "44444444-0000-4000-8000-000000000002",
            role: "USER",
            text: "put that in Excel",
            createdAt: NOW,
          } as QMessage,
          answer("44444444-0000-4000-8000-000000000003", [
            { kind: "TEXT", text: "newer" },
          ]),
        ]),
      nameOf: (_actor, subject) =>
        Promise.resolve(subject.kind === "COMPANY" ? "Ledgerfold" : null),
      artifacts: {
        fileOwnAnswer: (input) => {
          filed.push(input);
          return Promise.resolve(detail());
        },
      },
    });
    const shown = await port.shownAnswers(CONTEXT, RUN);
    expect(shown.map((one) => one.messageId)).toEqual([
      "44444444-0000-4000-8000-000000000003",
      "44444444-0000-4000-8000-000000000001",
    ]);
    expect(asked).toEqual([`${CONTEXT.userId}:${RUN}`]);
    const names = await port.subjectNames?.(CONTEXT, [
      { kind: "COMPANY", companyId: "55555555-0000-4000-8000-000000000005" },
    ]);
    expect(names?.get("55555555-0000-4000-8000-000000000005")).toBe(
      "Ledgerfold",
    );
    const current = detail().current;
    if (current === undefined) throw new Error("no version");
    const card = await port.file({
      actor: CONTEXT,
      runId: RUN,
      title: "Pipeline",
      summary: "Your pipeline.",
      content: current.content,
    });
    expect(card).toMatchObject({ type: "SPREADSHEET", status: "READY" });
    expect(filed[0]).toMatchObject({
      actorContext: CONTEXT,
      qRunId: RUN,
      artifactType: "SPREADSHEET",
    });
  });
});
