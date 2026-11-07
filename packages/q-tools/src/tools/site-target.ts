import { z } from "zod";

import { Q_TASK_CLASSES, UuidSchema } from "@capital-q/contracts";
import type { QToolExecutionContext } from "@capital-q/q-runtime";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { QToolPorts } from "../ports.js";
import {
  findRecordByName,
  matchCounterpart,
  ownDocumentId,
} from "./client-actions.js";
import { matchDocument, words } from "./company-documents.js";
import { planAdmits, type ProfileMaterialPort } from "./profile-material.js";

/**
 * Q Workspace W2.3: the instances behind a place in the site map, for the
 * person asking -- "Tamarind Pay's thread" -> their relationship and its
 * messages page; "Brightwell's deck" -> the deck's document and version;
 * "the cap table" -> the data-room document; "the memo you made" -> their
 * own artifact. The site map names the kinds of place; this names the one.
 *
 * Every lookup reads only what the person may already reach by hand, as
 * them, through the owning service's own authorised read:
 *   - a thread: only their own relationships (their side's list);
 *   - a deck or data-room document: only a company this run's plan admits
 *     (the Context Firewall decides before any service is asked), then only
 *     what that company's data room shows this person;
 *   - their documents: only their own list (the artifact service, as them).
 * A name that matches nothing they may see is NONE: never "it exists but
 * you can't", so a name can never reveal a record. It navigates nothing
 * and reads no content: ids, titles and the page path only.
 */

export const RESOLVE_PAGE_TARGET = "site.target.resolve" as const;

export const Q_PAGE_TARGET_KINDS = [
  "RELATIONSHIP_THREAD",
  "DECK",
  "DATA_ROOM_DOCUMENT",
  "OWN_DOCUMENT",
] as const;

export const ResolvePageTargetInputSchema = z
  .object({
    target: z
      .enum(Q_PAGE_TARGET_KINDS)
      .describe(
        "RELATIONSHIP_THREAD (the message thread with a company or investor they have a relationship with), DECK (a company's pitch deck), DATA_ROOM_DOCUMENT (one document in a company's data room), OWN_DOCUMENT (a document Q made for them).",
      ),
    counterpart: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "The company or investor as they said it (misheard names included). RELATIONSHIP_THREAD, DECK, DATA_ROOM_DOCUMENT. Leave out for the company on their screen, the one this conversation is about, or their own.",
      ),
    counterpartId: UuidSchema.optional().describe(
      "Instead of counterpart: the company's or investor organisation's id, exactly as a tool or the screen gave it.",
    ),
    document: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "DATA_ROOM_DOCUMENT or OWN_DOCUMENT: what they called it ('the cap table', 'the incorporation certificate', 'the IC memo').",
      ),
    documentId: UuidSchema.optional().describe(
      "Instead of document: its id, exactly as this tool returned it (after they picked one).",
    ),
  })
  .strict();
export type ResolvePageTargetInput = z.infer<
  typeof ResolvePageTargetInputSchema
>;

const FoundSchema = z
  .object({
    status: z.literal("FOUND"),
    target: z.enum(Q_PAGE_TARGET_KINDS),
    /** The site map's route of the page it lives on. */
    route: z.string().max(120),
    /** The page itself, for this person (no tab or section added). */
    path: z.string().max(240),
    title: z.string().max(200),
    relationshipId: UuidSchema.optional(),
    companyId: UuidSchema.optional(),
    investorOrganisationId: UuidSchema.optional(),
    documentId: UuidSchema.optional(),
    versionNumber: z.number().int().min(1).optional(),
    artifactId: UuidSchema.optional(),
  })
  .strict();

const NotOneSchema = z
  .object({
    status: z.enum(["WHICH_ONE", "NONE"]),
    target: z.enum(Q_PAGE_TARGET_KINDS),
    candidates: z
      .array(z.object({ id: UuidSchema, title: z.string().max(200) }).strict())
      .max(3),
    say: z.string().max(400),
  })
  .strict();

export const ResolvePageTargetOutputSchema = z.union([
  FoundSchema,
  NotOneSchema,
]);
export type ResolvePageTargetOutput = z.infer<
  typeof ResolvePageTargetOutputSchema
>;

type Ports = Pick<
  QToolPorts,
  | "companies"
  | "relationships"
  | "disclosure"
  | "discovery"
  | "investorFeed"
  | "documents"
>;

const NONE_LINE =
  "Nothing they can see matches. Say so plainly and stay where you are; never guess an id.";

function none(target: ResolvePageTargetInput["target"]) {
  return { status: "NONE" as const, target, candidates: [], say: NONE_LINE };
}

const id = (value: string) => value.toLowerCase();
const seg = (value: string) => encodeURIComponent(id(value));

/** Their own conversation, as themselves (the scope bound to this person). */
function ownConversation(context: QToolExecutionContext): boolean {
  if (context.actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(context.plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === context.actor.userId;
}

async function thread(
  ports: Ports,
  input: ResolvePageTargetInput,
  context: QToolExecutionContext,
): Promise<ResolvePageTargetOutput | null> {
  const own = await ports.relationships
    ?.ownRelationships?.(context.actor)
    .catch(() => null);
  if (own === null || own === undefined) return null;
  const items = own.items;
  let chosen = items.filter(
    (item) =>
      input.counterpartId !== undefined &&
      id(item.counterpart.id) === id(input.counterpartId),
  );
  if (chosen.length === 0 && input.counterpart !== undefined) {
    const match = matchCounterpart(
      input.counterpart,
      items.map((item) => ({
        id: item.relationshipId,
        name: item.counterpart.name,
      })),
    );
    chosen = items.filter(
      (item) => match !== null && id(item.relationshipId) === id(match),
    );
  }
  if (
    chosen.length === 0 &&
    input.counterpart === undefined &&
    input.counterpartId === undefined
  ) {
    // The one the conversation is about, when it names exactly one of theirs.
    const subjects = new Set(
      context.plan.subjects.flatMap((subject) =>
        subject.kind === "COMPANY"
          ? [id(subject.companyId)]
          : subject.kind === "INVESTOR_ORGANISATION"
            ? [id(subject.investorOrganisationId)]
            : [],
      ),
    );
    chosen = items.filter((item) => subjects.has(id(item.counterpart.id)));
  }
  const one = chosen.length === 1 ? chosen[0] : undefined;
  if (one === undefined) {
    return chosen.length > 1
      ? {
          status: "WHICH_ONE",
          target: "RELATIONSHIP_THREAD",
          candidates: chosen.slice(0, 3).map((item) => ({
            id: id(item.counterpart.id),
            title: item.counterpart.name.slice(0, 200),
          })),
          say: "Several of their relationships could be meant: name them and ask which.",
        }
      : none("RELATIONSHIP_THREAD");
  }
  const company = one.counterpart.kind === "COMPANY";
  return {
    status: "FOUND",
    target: "RELATIONSHIP_THREAD",
    route: company
      ? "/relationships/company/[companyId]/messages"
      : "/relationships/investor/[investorOrganisationId]/messages",
    path: `/relationships/${company ? "company" : "investor"}/${seg(one.counterpart.id)}/messages`,
    title: one.counterpart.name.slice(0, 200),
    relationshipId: id(one.relationshipId),
    ...(company
      ? { companyId: id(one.counterpart.id) }
      : { investorOrganisationId: id(one.counterpart.id) }),
  };
}

/** Which company: the one named, the one in view, or their own. */
async function companyOf(
  ports: Ports,
  material: ProfileMaterialPort,
  input: ResolvePageTargetInput,
  context: QToolExecutionContext,
): Promise<{ readonly id: string; readonly name: string | null } | null> {
  if (input.counterpartId !== undefined) {
    return { id: id(input.counterpartId), name: null };
  }
  if (input.counterpart !== undefined) {
    const found = await findRecordByName(
      ports,
      context.actor,
      "COMPANY",
      input.counterpart,
    );
    return found === null ? null : { id: id(found), name: input.counterpart };
  }
  const subjects = context.plan.subjects.filter(
    (subject) => subject.kind === "COMPANY",
  );
  const only = subjects.length === 1 ? subjects[0] : undefined;
  if (only !== undefined && only.kind === "COMPANY") {
    return { id: id(only.companyId), name: null };
  }
  const own = await material.ownCompanyId(context.actor).catch(() => null);
  return own === null ? null : { id: id(own), name: null };
}

type CompanyAnswer =
  | { readonly kind: "ANSWER"; readonly output: ResolvePageTargetOutput }
  | { readonly kind: "REFUSED" };

async function companyMaterial(
  ports: Ports,
  material: ProfileMaterialPort,
  input: ResolvePageTargetInput,
  context: QToolExecutionContext,
): Promise<CompanyAnswer> {
  const target = input.target;
  const company = await companyOf(ports, material, input, context);
  if (company === null) return { kind: "ANSWER", output: none(target) };
  // The Context Firewall decides first: a company this run's plan does not
  // admit is never asked about, whatever its id or name.
  if (!planAdmits(context, company.id)) return { kind: "REFUSED" };
  const path = `/company/${seg(company.id)}`;
  if (target === "DECK") {
    const view = await material
      .deck(context.actor, company.id)
      .catch(() => null);
    const deck = view?.deck ?? null;
    if (deck === null) return { kind: "ANSWER", output: none(target) };
    return {
      kind: "ANSWER",
      output: {
        status: "FOUND",
        target,
        route: "/company/[companyId]",
        path,
        title: deck.title.slice(0, 200),
        companyId: company.id,
        documentId: id(deck.documentId),
        versionNumber: deck.versionNumber,
      },
    };
  }
  if (material.documents === undefined) {
    return { kind: "ANSWER", output: none(target) };
  }
  const documents = await material
    .documents(context.actor, company.id)
    .catch(() => null);
  if (documents === null) return { kind: "ANSWER", output: none(target) };
  const found = (documentId: string, title: string): CompanyAnswer => ({
    kind: "ANSWER",
    output: {
      status: "FOUND",
      target,
      route: "/company/[companyId]",
      path,
      title: title.slice(0, 200),
      companyId: company.id,
      documentId: id(documentId),
    },
  });
  if (input.documentId !== undefined) {
    const wanted = id(input.documentId);
    const listed = documents.find(
      (document) => id(document.documentId) === wanted,
    );
    return listed === undefined
      ? { kind: "ANSWER", output: none(target) }
      : found(listed.documentId, listed.title);
  }
  if (input.document === undefined) {
    return { kind: "ANSWER", output: none(target) };
  }
  const ignore = new Set(company.name === null ? [] : words(company.name));
  const match = matchDocument(input.document, documents, ignore);
  if (match.kind === "ONE") {
    return found(match.document.documentId, match.document.title);
  }
  if (match.kind === "NONE") return { kind: "ANSWER", output: none(target) };
  return {
    kind: "ANSWER",
    output: {
      status: "WHICH_ONE",
      target,
      candidates: match.likely.map((document) => ({
        id: id(document.documentId),
        title: document.title.slice(0, 200),
      })),
      say: "Several documents could be the one they mean: name them and ask which, then call again with its documentId.",
    },
  };
}

async function ownDocument(
  ports: Ports,
  input: ResolvePageTargetInput,
  context: QToolExecutionContext,
): Promise<ResolvePageTargetOutput> {
  const artifactId = await ownDocumentId(ports, context.actor, {
    id: input.documentId,
    name: input.document,
  });
  if (artifactId === null) return none("OWN_DOCUMENT");
  const listed = await ports.documents
    ?.list(context.actor, 20)
    .catch(() => null);
  const title =
    listed?.find((item) => id(item.artifactId) === artifactId)?.title ??
    "Document";
  return {
    status: "FOUND",
    target: "OWN_DOCUMENT",
    route: "/documents",
    path: `/documents?open=${seg(artifactId)}`,
    title: title.slice(0, 200),
    artifactId,
  };
}

export function createResolvePageTargetTool(
  ports: Ports,
  material: ProfileMaterialPort | undefined,
): AnyQToolDefinition {
  return defineQTool<
    ResolvePageTargetInput,
    ResolvePageTargetOutput,
    ResolvePageTargetOutput
  >({
    id: RESOLVE_PAGE_TARGET,
    version: 1,
    status: "ACTIVE",
    providerName: "resolve_page_target",
    description:
      "Finds the one record behind a place in the app, for this person, before moving there or naming it: the thread with a company or investor (relationship id and its messages page), a company's pitch deck (document id and version), one document in a company's data room (document id), or one of their own documents (artifact id). Returns ids and the page path only; it opens and reads nothing. WHICH_ONE: ask which. NONE: say nothing they can see matches and stay.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: [...Q_TASK_CLASSES],
    // Named by the navigation decision (W4), never offered by area alone.
    offeredWhenNamed: true,
    requiredScopeKinds: [],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: null,
    input: ResolvePageTargetInputSchema,
    output: ResolvePageTargetOutputSchema,
    authorize: async (input, context) => {
      if (context.actor.actorType !== "HUMAN") return deny("NOT_AVAILABLE");
      if (
        input.target === "RELATIONSHIP_THREAD" ||
        input.target === "OWN_DOCUMENT"
      ) {
        // Their own records only, in their own conversation.
        if (!ownConversation(context)) return deny("NOT_AVAILABLE");
        const output =
          input.target === "OWN_DOCUMENT"
            ? await ownDocument(ports, input, context)
            : await thread(ports, input, context);
        return output === null
          ? deny("NOT_AVAILABLE")
          : allow("CONFIDENTIAL", output);
      }
      if (material === undefined) return deny("NOT_AVAILABLE");
      const answer = await companyMaterial(ports, material, input, context);
      return answer.kind === "REFUSED"
        ? deny("NOT_AVAILABLE")
        : allow("CONFIDENTIAL", answer.output);
    },
    execute: (_input, _context, grant) => Promise.resolve(grant),
  });
}
