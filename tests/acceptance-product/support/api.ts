import { randomUUID } from "node:crypto";

/**
 * The API-level driver: the same public HTTP surfaces the web app calls,
 * under a real synthetic person's own bearer token. No service credential
 * is used anywhere: sign-up goes through the public auth endpoint with
 * the publishable key, exactly as the sign-up form does.
 *
 *   CQ_ACCEPT_SUPABASE_URL  (default http://127.0.0.1:54321)
 *   CQ_ACCEPT_API_URL       (default http://127.0.0.1:3511)
 *   CQ_ACCEPT_Q_API_URL     (default http://127.0.0.1:3502)
 */

const SUPABASE =
  process.env["CQ_ACCEPT_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const API = process.env["CQ_ACCEPT_API_URL"] ?? "http://127.0.0.1:3511";
const QAPI = process.env["CQ_ACCEPT_Q_API_URL"] ?? "http://127.0.0.1:3502";
const PUBLISHABLE =
  process.env["CQ_ACCEPT_SUPABASE_PUBLISHABLE_KEY"] ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

for (const url of [SUPABASE, API, QAPI]) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error(
      `acceptance-product runs against a local stack only: ${url}`,
    );
  }
}

export const PASSWORD = "acceptance-product-passphrase-1";

export function uniqueEmail(label: string): string {
  return `acc-prod-${label}-${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}@capitalq.local`;
}

export type Person = {
  readonly email: string;
  readonly token: string;
  readonly name: string;
};

async function json(response: Response, what: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${what}: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  return text.length === 0 ? null : (JSON.parse(text) as unknown);
}

/** Sign up the way the sign-up form does, then let the profile learn the name. */
export async function signUp(input: {
  name: string;
  organisation?: string;
  label: string;
}): Promise<Person> {
  const email = uniqueEmail(input.label);
  const body = (await json(
    await fetch(`${SUPABASE}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: PUBLISHABLE, "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        data: {
          display_name: input.name,
          ...(input.organisation === undefined
            ? {}
            : { organisation_name: input.organisation }),
        },
      }),
    }),
    "sign up",
  )) as { access_token?: string; session?: { access_token?: string } };
  const token = body.access_token ?? body.session?.access_token;
  if (token === undefined) throw new Error("sign up returned no session");
  // What the first authenticated page does: copy the sign-up name across.
  await fetch(`${API}/v1/me`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ displayName: input.name }),
  });
  return { email, token, name: input.name };
}

/** A fresh access token for a person (tokens are short-lived). */
export async function signIn(person: Person): Promise<Person> {
  const body = (await json(
    await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: PUBLISHABLE, "content-type": "application/json" },
      body: JSON.stringify({ email: person.email, password: PASSWORD }),
    }),
    "sign in",
  )) as { access_token: string };
  return { ...person, token: body.access_token };
}

function headers(person: Person, idempotent = false): Record<string, string> {
  return {
    authorization: `Bearer ${person.token}`,
    "content-type": "application/json",
    accept: "application/json",
    ...(idempotent ? { "idempotency-key": randomUUID() } : {}),
  };
}

// ---------------------------------------------------------------------------
// The onboarding interview, one turn at a time (POST .../say)
// ---------------------------------------------------------------------------

type SessionView = {
  session: { id: string; version: number; status: string };
  currentStep?: { stepKey?: string } | null;
};

export type InterviewTurn = {
  readonly said: string;
  readonly reply: string | null;
  /** The journey's step cursor after the turn (NOT what Q asked). */
  readonly stepAfter: string | null;
  readonly status: string;
  /** The steps Q's reply actually asks about, in order (CQ-QX-008). */
  readonly askingAbout: readonly string[];
  /** Q's recommendations waiting on the person's decision. */
  readonly pendingRecommendations: readonly {
    stepKey: string;
    value: string;
  }[];
  /** What the runtime says it recorded this turn (never read from prose). */
  readonly recorded: readonly string[];
};

type QTurnResponse = {
  reply: string;
  recorded?: string[];
  askingAbout?: string[];
  pending?: { recommendations?: { stepKey: string; value: string }[] };
};

export class Interview {
  private readonly recent: { role: "person" | "q"; text: string }[] = [];
  readonly turns: InterviewTurn[] = [];

  private person: Person;
  readonly sessionId: string;
  readonly journey: "investor" | "founder";

  private constructor(
    person: Person,
    sessionId: string,
    journey: "investor" | "founder",
  ) {
    this.person = person;
    this.sessionId = sessionId;
    this.journey = journey;
  }

  static async start(
    person: Person,
    journey: "investor" | "founder",
  ): Promise<Interview> {
    const view = (await json(
      await fetch(`${API}/v1/onboarding/sessions`, {
        method: "POST",
        headers: headers(person, true),
        body: JSON.stringify({ journeyType: journey }),
      }),
      "start onboarding",
    )) as SessionView;
    const interview = new Interview(person, view.session.id, journey);
    // Q opens: an empty turn is the opening question, nothing recorded.
    await interview.say("");
    return interview;
  }

  /**
   * One turn.
   *
   * It goes to the q-api interview turn route, under the person's own
   * bearer, which is exactly the call the api's `/say` makes on the web's
   * behalf. `/say` adds only a session-version check and a session read, and
   * it DROPS `askingAbout` and `pending` (baseline finding, 2026-09-25: the
   * public say response does not carry them, so the web cannot follow Q
   * either). The session is read here afterwards, as `/say` does.
   */
  async say(text: string): Promise<InterviewTurn> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${QAPI}/v1/q/interview/turn`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.person.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          onboardingSessionId: this.sessionId,
          journeyType: this.journey,
          utterance: text,
          channel: "text",
          recentTurns: this.recent.slice(-16),
        }),
      });
      if (response.status === 401) {
        this.person = await signIn(this.person);
        continue;
      }
      const body = (await json(
        response,
        `say "${text.slice(0, 40)}"`,
      )) as QTurnResponse;
      const view = await this.view();
      if (text.length > 0) this.recent.push({ role: "person", text });
      if (body.reply.length > 0)
        this.recent.push({ role: "q", text: body.reply });
      const turn: InterviewTurn = {
        said: text,
        reply: body.reply,
        stepAfter: view.currentStep?.stepKey ?? null,
        status: view.session.status,
        askingAbout: body.askingAbout ?? [],
        pendingRecommendations: body.pending?.recommendations ?? [],
        recorded: body.recorded ?? [],
      };
      this.turns.push(turn);
      return turn;
    }
    throw new Error(`say "${text.slice(0, 40)}": could not authenticate`);
  }

  private async view(): Promise<SessionView> {
    return (await json(
      await fetch(`${API}/v1/onboarding/sessions/${this.sessionId}`, {
        headers: headers(this.person),
      }),
      "read session",
    )) as SessionView;
  }

  get lastReply(): string {
    return this.turns.at(-1)?.reply ?? "";
  }

  get who(): Person {
    return this.person;
  }
}

// ---------------------------------------------------------------------------
// Home Q: a run, answered, in a conversation
// ---------------------------------------------------------------------------

export type QAnswer = {
  readonly runId: string;
  readonly conversationId: string | null;
  readonly status: string;
  readonly text: string;
  readonly blocks: unknown[];
};

type RunSummary = {
  runId?: string;
  id?: string;
  status: string;
  conversationId?: string | null;
};
const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"]);

export class HomeQ {
  conversationId: string | null = null;
  private readonly person: Person;

  constructor(person: Person) {
    this.person = person;
  }

  /** The investor organisation or company Home binds Q to, as the web does. */
  async ownSubject(): Promise<unknown[] | undefined> {
    const investor = await fetch(`${API}/v1/investors/current`, {
      headers: headers(this.person),
    });
    if (investor.ok) {
      const body = (await investor.json()) as {
        id?: string;
        investorOrganisationId?: string;
      };
      const id = body.investorOrganisationId ?? body.id;
      if (id !== undefined) {
        return [{ kind: "INVESTOR_ORGANISATION", investorOrganisationId: id }];
      }
    }
    return undefined;
  }

  async ask(
    text: string,
    options: { subjects?: unknown[] | undefined; timeoutMs?: number } = {},
  ): Promise<QAnswer> {
    const started = (await json(
      await fetch(`${QAPI}/v1/q/runs`, {
        method: "POST",
        headers: headers(this.person, true),
        body: JSON.stringify({
          capability: "ANSWER",
          message: { text },
          modality: "TEXT",
          ...(options.subjects === undefined
            ? {}
            : { subjects: options.subjects }),
          ...(this.conversationId === null
            ? {}
            : { conversationId: this.conversationId }),
        }),
      }),
      `ask "${text.slice(0, 40)}"`,
    )) as RunSummary;
    const runId = started.runId ?? started.id ?? "";
    if (started.conversationId) this.conversationId = started.conversationId;
    const deadline = Date.now() + (options.timeoutMs ?? 300_000);
    let run: RunSummary = started;
    while (!TERMINAL.has(run.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      run = (await json(
        await fetch(`${QAPI}/v1/q/runs/${runId}`, {
          headers: headers(this.person),
        }),
        "read run",
      )) as RunSummary;
      if (run.conversationId) this.conversationId = run.conversationId;
    }
    const answer = await this.answerOf(runId);
    return {
      runId,
      conversationId: this.conversationId,
      status: run.status,
      ...answer,
    };
  }

  async cancel(runId: string): Promise<string> {
    const run = (await json(
      // No body, so no JSON content type: Fastify answers 400 to an empty
      // application/json body.
      await fetch(`${QAPI}/v1/q/runs/${runId}/cancel`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.person.token}`,
          accept: "application/json",
        },
      }),
      "cancel run",
    )) as RunSummary;
    return run.status;
  }

  /** Start a run and return at once (for interruption). */
  async start(text: string): Promise<string> {
    const started = (await json(
      await fetch(`${QAPI}/v1/q/runs`, {
        method: "POST",
        headers: headers(this.person, true),
        body: JSON.stringify({
          capability: "ANSWER",
          message: { text },
          modality: "TEXT",
          ...(this.conversationId === null
            ? {}
            : { conversationId: this.conversationId }),
        }),
      }),
      "start run",
    )) as RunSummary;
    if (started.conversationId) this.conversationId = started.conversationId;
    return started.runId ?? started.id ?? "";
  }

  private async answerOf(
    runId: string,
  ): Promise<{ text: string; blocks: unknown[] }> {
    const run = (await json(
      await fetch(`${QAPI}/v1/q/runs/${runId}`, {
        headers: headers(this.person),
      }),
      "read run",
    )) as {
      messages?: { role: string; text?: string; blocks?: unknown[] }[];
      results?: unknown[];
    };
    const replies = (run.messages ?? []).filter((m) => m.role === "Q");
    return {
      text: replies
        .map((m) => m.text ?? "")
        .join("\n")
        .trim(),
      blocks: [
        ...replies.flatMap((m) => m.blocks ?? []),
        ...(run.results ?? []),
      ],
    };
  }
  /** Fetch an artifact's rendered PDF through the Q API; returns the first bytes. */
  async artifactPdfHead(artifactId: string): Promise<string> {
    const response = await fetch(
      `${QAPI}/v1/q/artifacts/${artifactId}/export/pdf`,
      { headers: { authorization: `Bearer ${this.person.token}` } },
    );
    if (!response.ok) return `HTTP ${response.status}`;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return Buffer.from(bytes.subarray(0, 4)).toString("latin1");
  }
}
