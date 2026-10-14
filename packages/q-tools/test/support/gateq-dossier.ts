import { GateqInboxDetailDtoSchema } from "@capital-q/contracts";

export const GATEWAY = "10000000-0000-4000-8000-000000000001";
export const APPLICATION = "10000000-0000-4000-8000-000000000002";
export const OTHER_APPLICATION = "10000000-0000-4000-8000-000000000003";
export function detailFixture(applicationId = APPLICATION, long = false) {
  const submittedAt = "2026-10-14T08:00:00.000Z";
  const reference = `application-${applicationId.slice(-4)}`;
  return GateqInboxDetailDtoSchema.parse({
    item: {
      applicationId,
      reference,
      companyName:
        applicationId === APPLICATION
          ? "Synthetic Waterworks"
          : "Synthetic Materials",
      oneLiner: "Founder-declared solar water equipment.",
      stage: "seed",
      sector: "water",
      country: "NG",
      raise: null,
      fit: "STRONG",
      rules: { met: 1, total: 1, unknown: 0 },
      starred: false,
      unread: true,
      labels: [],
      assignee: null,
      folder: "INBOX",
      replyBy: null,
      replyState: "DUE",
      daysLeft: 2,
      submittedAt,
    },
    rules: [
      {
        label: "Seed stage",
        dimension: "stage",
        required: true,
        standing: "MEETS",
      },
    ],
    answers: [
      {
        label: "Description",
        value:
          "Founder-declared solar water equipment for communal distribution.",
      },
    ],
    note: null,
    contact: { name: null, email: null },
    shared: [],
    notes: [],
    activity: [],
    messages: [],
    transcript: [],
    dossier: {
      schemaVersion: "gateq-dossier.v1",
      generatedAt: submittedAt,
      application: { reference, submittedAt },
      company: {
        name:
          applicationId === APPLICATION
            ? "Synthetic Waterworks"
            : "Synthetic Materials",
        description: "Solar water equipment.",
        website: null,
        country: "NG",
        stage: "seed",
        sectorPhrases: ["water"],
        note: null,
      },
      contact: null,
      qualification: {
        outcome: "QUALIFIED",
        access: "MAY_APPLY",
        criteria: [],
      },
      dimensions: [
        {
          group: "TRACTION",
          label: "Traction",
          facts: Array.from({ length: long ? 20 : 1 }, (_, index) => ({
            dimension: "company.traction",
            label: "Traction",
            summary: long
              ? `${index}: ${"reported customer usage ".repeat(80)}`.slice(
                  0,
                  2000,
                )
              : "Founder reports 500 paying customers and intends to spend the raise on production tooling. These are applicant claims.",
            provenance: "APPLICANT_PROVIDED",
            sourceFactId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            sourceTurnSeq: 7,
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
          })),
        },
      ],
      unknowns: [
        {
          dimension: "company.margin",
          group: "TRACTION",
          label: "Gross margin",
        },
      ],
      declined: [],
      missing: [],
      contradictions: [],
      documents: [],
      diligenceQuestions: [],
      transcript: { turnCount: 2 },
      synthesis: null,
    },
  });
}
