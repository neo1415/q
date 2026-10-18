import type { DatabaseExecutor } from "@capital-q/database";
import {
  nameKeyOf,
  pronunciationHintLines,
  PRONUNCIATION_HINTS_MAX,
  type NamePronunciation,
  type PronunciationKind,
} from "@capital-q/q-core/names";
import type { ActorContext } from "@capital-q/security";

/**
 * W3: how names are said, kept per (name entity, user or organisation)
 * (20261222091000_q_name_pronunciations.sql) and offered to GPT-Live as a
 * hint list in its session context. A user's correction is stored as
 * theirs, never as verified; nothing here derives a pronunciation from a
 * spelling. Every statement filters by the actor's tenant, and by the
 * user or organisation that owns the row.
 */

export type PronunciationStore = {
  /** "It's pronounced X" / "the name is spelled Y", as the person said it. */
  readonly recordCorrection: (input: {
    readonly actor: ActorContext;
    readonly name: string;
    readonly kind: PronunciationKind;
    readonly value: string;
    /** Share with the whole organisation instead of only this person. */
    readonly forOrganisation?: boolean | undefined;
  }) => Promise<boolean>;
  /** A sourced guide (never from an inferred spelling). */
  readonly recordVerified: (input: {
    readonly actor: ActorContext;
    readonly name: string;
    readonly kind: PronunciationKind;
    readonly value: string;
    readonly source: "VERIFIED_GUIDE" | "PERSON_STATED";
    readonly sourceRef: string;
    readonly forOrganisation?: boolean | undefined;
  }) => Promise<boolean>;
  /** Latest per (name, kind) visible to this actor: theirs, then their org's. */
  readonly forActor: (
    actor: ActorContext,
  ) => Promise<readonly NamePronunciation[]>;
  /** The hint lines for the Live session context. */
  readonly hintsFor: (actor: ActorContext) => Promise<readonly string[]>;
};

type Row = {
  readonly name_key: string;
  readonly display_name: string;
  readonly kind: PronunciationKind;
  readonly value: string;
  readonly source: NamePronunciation["source"];
  readonly source_ref: string | null;
};

const clean = (text: string, max: number): string =>
  text.replace(/\s+/gu, " ").trim().slice(0, max);

export function createPostgresPronunciationStore(dependencies: {
  readonly sql: DatabaseExecutor;
}): PronunciationStore {
  const { sql } = dependencies;

  const insert = async (input: {
    readonly actor: ActorContext;
    readonly name: string;
    readonly kind: PronunciationKind;
    readonly value: string;
    readonly source: NamePronunciation["source"];
    readonly sourceRef: string | null;
    readonly forOrganisation?: boolean | undefined;
  }): Promise<boolean> => {
    const displayName = clean(input.name, 120);
    const value = clean(input.value, 120);
    const key = nameKeyOf(displayName);
    if (displayName.length === 0 || value.length === 0 || key.length === 0) {
      return false;
    }
    const organisational =
      input.forOrganisation === true &&
      input.actor.organisationId !== undefined;
    await sql`
      insert into q_runtime.name_pronunciations
        (tenant_id, scope, user_id, organisation_id, name_key, display_name,
         kind, value, source, source_ref, created_by)
      values (${input.actor.tenantId},
              ${organisational ? "organisation" : "user"},
              ${organisational ? null : input.actor.userId},
              ${organisational ? (input.actor.organisationId ?? null) : null},
              ${key}, ${displayName}, ${input.kind}, ${value},
              ${input.source}, ${input.sourceRef}, ${input.actor.userId})`;
    return true;
  };

  const forActor: PronunciationStore["forActor"] = async (actor) => {
    const organisationId = actor.organisationId ?? null;
    // Latest row per (name, kind, scope); the person's own beats the
    // organisation's for the same name and kind.
    const rows = await sql<Row[]>`
      select distinct on (name_key, kind, scope)
             name_key, display_name, kind, value, source, source_ref, scope
        from q_runtime.name_pronunciations
       where tenant_id = ${actor.tenantId}
         and ((scope = 'user' and user_id = ${actor.userId})
           or (scope = 'organisation' and organisation_id = ${organisationId}))
       order by name_key, kind, scope desc, created_at desc
       limit 200`;
    const best = new Map<string, Row>();
    for (const row of rows) {
      const id = `${row.name_key}|${row.kind}`;
      // `scope desc` put 'user' before 'organisation': the first wins.
      if (!best.has(id)) best.set(id, row);
    }
    return [...best.values()].map((row) => ({
      nameKey: row.name_key,
      displayName: row.display_name,
      kind: row.kind,
      value: row.value,
      source: row.source,
      sourceRef: row.source_ref,
    }));
  };

  return {
    recordCorrection: (input) =>
      insert({ ...input, source: "USER_CORRECTION", sourceRef: null }),
    recordVerified: (input) => insert({ ...input, sourceRef: input.sourceRef }),
    forActor,
    hintsFor: async (actor) =>
      pronunciationHintLines(await forActor(actor)).slice(
        0,
        PRONUNCIATION_HINTS_MAX,
      ),
  };
}
