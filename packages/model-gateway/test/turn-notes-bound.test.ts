import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  QAccountDigestSchema,
  type QAccountDigest,
} from "@capital-q/contracts";
import {
  CompanyAnalystV4VariablesSchema,
  createDefaultPromptRegistry,
} from "@capital-q/q-core";
import type {
  QAnswerRequest,
  QConversationMessage,
  QOfferedTool,
  QRuntimeRepositories,
  QToolPort,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import {
  createModelGatewayQAnswer,
  environmentNoteParts,
  fittedTurnNotes,
  NOTES_SHORTENED_NOTE,
  situationWithAccount,
} from "../src/q/index.js";
import {
  fittedVariables,
  SHORTENED_MARKER,
} from "../src/q/prompt-variables-fit.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * D16 (live 15 Nov 2026, run f1f8cf19): "How solid is Kazikit's revenue?
 * Can you get their accounts?" failed INTERNAL_ERROR with PromptRenderError
 * "variables for company-analyst/v35 are invalid". Since 1af6e1954 the
 * account digest (up to 3,000 characters) rides beside the situation in the
 * turn's notes; with an investor's full tool list, the two-part note and
 * the named-company note added after environmentNoteParts, turnNotes went
 * past its 9,400 bound. Fake model; no provider, no network.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const KAZIKIT = "0989a281-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-15T03:14:00.000Z");
const ID = (n: number) =>
  `5c1d7a10-0b0e-4e7a-9a0c-${String(n).padStart(12, "0")}`;
const TURN_NOTES_MAX = 9_400;

/** An investor's account at the live size: the block near its bound. */
function liveDigest(): QAccountDigest {
  return QAccountDigestSchema.parse({
    side: "INVESTOR",
    relationships: Array.from({ length: 12 }, (_, i) => ({
      relationshipId: ID(600 + i),
      counterpart: {
        kind: "COMPANY" as const,
        id: ID(700 + i),
        name: `A company with a rather long name number ${String(i)}`,
      },
      stage: "INTEREST_EXPRESSED" as const,
      stageSince: "2026-11-01T09:00:00.000Z",
      nextStep: "DECIDE_NEXT_STEP" as const,
      owed: "YOU_OWE_REPLY" as const,
      lastMessageAt: "2026-11-13T15:00:00.000Z",
    })),
    relationshipsTotal: 15,
    byStage: { INTEREST_EXPRESSED: 15 },
    relationshipCounterpartIds: [],
    waiting: Array.from({ length: 10 }, (_, i) => ({
      key: `approval:${ID(200 + i)}`,
      source: "APPROVAL" as const,
      title: `Message Ajopot about the follow-up on their figures, number ${String(i)}`,
      entity: { kind: "APPROVAL" as const, id: ID(200 + i) },
      since: "2026-11-14T08:00:00.000Z",
      decidable: true,
    })),
    waitingTotal: 21,
    meetings: Array.from({ length: 4 }, (_, i) => ({
      id: ID(300 + i),
      relationshipId: ID(600 + i),
      purpose: "Proposed call about the figures and the next step",
      startsAt: "2026-11-19T09:00:00.000Z",
      timeZone: "Africa/Lagos",
      with: ["Amara Diallo-Benson", "Grace Achieng"],
      hasBrief: false,
    })),
    work: Array.from({ length: 4 }, (_, i) => ({
      id: ID(400 + i),
      kind: "INVESTOR_OUTREACH",
      status: "ACTIVE",
      goal: `Follow up on the diligence asks with the companies, round ${String(i)}`,
      open: 2,
      updatedAt: "2026-11-14T07:00:00.000Z",
    })),
    requests: Array.from({ length: 4 }, (_, i) => ({
      relationshipId: ID(800 + i),
      counterpart: `Counterpart ${String(i)}`,
      direction: "FROM_YOU" as const,
      open: ["Evidence that settles whether the active users are recurring"],
      openCount: 1,
      answeredCount: 3,
    })),
    gateq: {
      applications: [],
      applicationsTotal: 0,
      inbox: {
        gatewayName: "Savanna Seed",
        unread: 4,
        fits: 2,
        partial: 1,
        notAFit: 1,
        needsJudgement: 2,
        top: [
          {
            applicationId: ID(501),
            companyName: "Maji Loop",
            fit: "FITS",
            daysLeft: 2,
          },
        ],
      },
    },
    recent: Array.from({ length: 6 }, (_, i) => ({
      at: "2026-11-14T15:00:00.000Z",
      text: `Something happened in the account that is worth a line, number ${String(i)}`,
      relationshipId: ID(900 + i),
    })),
    unread: [],
    readAt: NOW.toISOString(),
  });
}

/** Capital Q's model tool names (q-tools providerName), as offered live. */
const TOOL_NAMES =
  `accept_recommendation answer_q_work apply_my_brand approve_pending_proposal audit_my_document brief_public_entity coach_my_deck company_assumptions confirm_and_finish confirm_as_stated continue_onboarding control_document control_screen correct_answer decline_pending_proposal discover_companies discover_investors discovery_slate dismiss_reminder edit_my_document explore_pitches_like extract_public_web fill_profile_gaps find_meeting_times find_prospective_investors find_public_entity fit_compare fit_profile fit_top_candidates get_brand_kit get_capital_objective get_company get_disclosure_state get_investor_mandate get_my_plan get_my_results get_my_results_report get_onboarding_state get_pitch_moment get_q_card get_q_daily get_relationship illustrate_my_document list_incoming_interest list_messages list_my_documents list_my_inbound_emails list_my_relationships list_pending_approvals list_q_work list_schedule list_uploaded_documents lookup_public_profile make_spreadsheet my_board note_preference open_company_document open_page open_website operate_screen propose_chat_message propose_connection_request propose_connection_request_answer propose_email propose_errand propose_express_interest propose_human_review propose_interest_answer propose_meeting propose_meeting_change propose_profile_answer_change propose_q_job propose_q_outreach propose_reminder propose_stand_in propose_standing_instruction read_attached_document read_company_data_room read_company_deck read_company_document read_company_figures read_company_pitches read_document_pages read_meeting read_my read_my_document read_my_inbound_email read_my_record read_relationship_email reassess_marketplace_readiness recall_my_setup recommend recommendation_explanation record_answers reload_page request_q_daily research_public_web resolve_page_target revise_my_document search_companies search_network set_aside set_away set_discover_filters set_layout set_notification_settings set_onboarding_reminders set_preference_learning set_q_daily_preferences set_q_language set_q_motion set_q_personality set_theme set_voice show sign_out stop_q_work suggest_brand_kit thesis_reading`.split(
    " ",
  );

/** An investor's offered tools, by their real names. */
const TOOLS: readonly QOfferedTool[] = TOOL_NAMES.map((name, i) => ({
  toolName: `tool.number_${String(i)}`,
  toolVersion: 1,
  classification: "READ_ONLY" as const,
  definition: {
    name,
    description: "A tool.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "REVIEWING_COMPANY" as const,
}));

function build() {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "JSON" as const,
        value: {
          answer:
            "Kazikit's revenue is reported, not yet supported by accounts.",
          responseShape: "CONCISE",
          insufficientEvidence: false,
          recommendation: null,
        },
      },
    ],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(
      testCatalog((s) => ({
        ...s,
        models: s.models.map((m) => ({ ...m, supportsTools: true })),
      })),
    ),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const messages: QConversationMessage[] = [
    {
      id: randomUUID() as QConversationMessage["id"],
      tenantId: TENANT as QConversationMessage["tenantId"],
      conversationId: CONVERSATION as QConversationMessage["conversationId"],
      runId: RUN as QConversationMessage["runId"],
      role: "USER",
      content: "How solid is Kazikit's revenue? Can you get their accounts?",
      contentType: "TEXT",
      createdAt: NOW.toISOString(),
    },
  ];
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, input: { role: "Q"; content: string }) => {
        const message = {
          ...messages[0],
          id: randomUUID(),
          role: input.role,
          content: input.content,
        } as QConversationMessage;
        messages.push(message);
        return Promise.resolve(message);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: { append: () => Promise.resolve({}) },
  } as unknown as QRuntimeRepositories;
  const tools: QToolPort = {
    offer: () => Promise.resolve(TOOLS),
    // Kazikit's declared profile, read ahead of the model.
    execute: (proposal) =>
      Promise.resolve({
        callId: proposal.callId,
        toolName: "company.get",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "PUBLIC",
        result: {
          ok: true,
          data: {
            companyId: KAZIKIT,
            canonicalName: "Kazikit",
            legalName: null,
            websiteUrl: null,
            foundedDate: null,
            headquartersCountry: "KE",
            headquartersCity: "Nairobi",
            currentStageCode: "seed",
            shortDescription:
              "Kazikit sells field-service software to East African installers.",
            primaryDescription: null,
            companyStatus: "active",
            relationToYou: "SHARED",
            truthClass: "USER_CLAIM",
          },
        },
        latencyMs: 3,
      }),
  };
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    accountDigestOf: () => Promise.resolve(liveDigest()),
    now: () => NOW,
  });
  const plan = PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: USER },
    purpose: {
      capability: "ANSWER",
      taskClass: "COUNTERPARTY_COMPANY_QUESTION",
    },
    subjects: [],
    scopes: [],
    denied: [],
    maxSensitivity: "PUBLIC",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: NOW.toISOString(),
    revalidateAfter: new Date(NOW.getTime() + 60_000).toISOString(),
    revalidateOnResume: true,
  });
  const request = {
    runId: RUN,
    tenantId: TENANT,
    actorUserId: USER,
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${RUN}`,
    capability: "ANSWER",
    subjects: [{ kind: "COMPANY", companyId: KAZIKIT }],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan,
    answerKind: "ADVICE",
    aboutNamedOther: true,
    askParts: [
      { ask: "How solid is Kazikit's revenue?", kind: "ADVICE" },
      { ask: "Can you get their accounts?", kind: "ACTION" },
    ],
  } as unknown as QAnswerRequest;
  const sent = () =>
    alpha.calls.map((call) =>
      call.request.messages.map((m) => m.content).join("\n"),
    );
  return { seam, request, sent };
}

describe("a turn whose assembled notes pass a prompt variable's bound (D16)", () => {
  it("answers the live two-part Kazikit question instead of failing to render", async () => {
    const { seam, request, sent } = build();
    const result = await seam.answer(request);
    expect(result.kind).toBe("ANSWERED");
    const [prompt] = sent();
    expect(prompt).toBeDefined();
    // Both asked parts reach the model, whole.
    expect(prompt).toContain("This turn asks 2 separate things.");
    expect(prompt).toContain(JSON.stringify("Can you get their accounts?"));
  });

  it("never composes a turn's part past its bound, and says when it shortened", () => {
    const situation = situationWithAccount({
      header: "SITUATION (Capital Q, by code, this turn): x".padEnd(1_500, "x"),
      digest: liveDigest(),
      now: NOW,
      timeZone: "Africa/Lagos",
    });
    const subjects = [{ kind: "COMPANY" as const, companyId: KAZIKIT }];
    const base = environmentNoteParts([], TOOLS, subjects, { situation });
    expect(base.turn.length).toBeLessThanOrEqual(TURN_NOTES_MAX);
    expect(base.standing.length).toBeLessThanOrEqual(TURN_NOTES_MAX);
    // The turn adds its own notes after; they are kept whole.
    const lead = "THE NAMED COMPANY NOTE. ".repeat(130);
    const final = { ...base, turn: `${lead}${base.turn}` };
    const fitted = fittedTurnNotes(final, base, (turnBudget) =>
      environmentNoteParts([], TOOLS, subjects, { situation, turnBudget }),
    );
    expect(fitted.turn.length).toBeLessThanOrEqual(TURN_NOTES_MAX);
    expect(fitted.turn.startsWith(lead)).toBe(true);
    expect(fitted.turn).toContain(NOTES_SHORTENED_NOTE);
    // The situation's header is kept: only the digest beside it shrank.
    expect(fitted.turn).toContain("SITUATION (Capital Q, by code, this turn)");
    expect(fitted.turn).toContain("ACCOUNT (Capital Q, by code");
  });

  it("leaves notes that fit exactly as they were", () => {
    const base = environmentNoteParts([], [], [], { situation: "S." });
    expect(fittedTurnNotes(base, base, () => base)).toBe(base);
    expect(base.turn).not.toContain(NOTES_SHORTENED_NOTE);
  });
});

describe("the render's second layer: any variable over its bound (D16)", () => {
  const schema =
    createDefaultPromptRegistry().getActive("COMPANY_ANALYST").definition
      .variables.schema;

  it("shortens a too-long text and a too-long fact list, saying so", () => {
    const facts = Array.from({ length: 130 }, (_, i) => ({
      scope: "COMPANY_PROFILE",
      statement: `Fact ${String(i)}.`,
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
    }));
    const { variables, shortened } = fittedVariables(schema, {
      capability: "ANSWER",
      userMessage: "How solid is Kazikit's revenue?",
      conversation: [],
      authorisedFacts: facts,
      subjectDescription: "Kazikit",
      institutionalNotes: "Nothing.",
      memory: "Nothing.",
      turnNotes: "A note. ".repeat(2_000),
    });
    expect(shortened).toEqual(
      expect.arrayContaining(["turnNotes", "authorisedFacts"]),
    );
    const turnNotes = String(variables.turnNotes);
    expect(turnNotes.length).toBeLessThanOrEqual(TURN_NOTES_MAX);
    expect(turnNotes.endsWith(SHORTENED_MARKER)).toBe(true);
    const kept = variables.authorisedFacts as { statement: string }[];
    expect(kept).toHaveLength(120);
    expect(kept.at(-1)?.statement).toMatch(/^11 more authorised facts exist/u);
    expect(
      CompanyAnalystV4VariablesSchema.omit({
        operatingMode: true,
        communicationProfile: true,
        communicationGuidance: true,
        environmentNotes: true,
      }).safeParse(variables).success,
    ).toBe(true);
  });
});
