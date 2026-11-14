import {
  Q_ACCOUNT_DIGEST_PATH,
  QAccountDigestSchema,
  type QAccountDigest,
} from "@capital-q/contracts";

/**
 * Owner 14 Nov 2026: the person's account digest -- the same one every Q
 * turn reads (q-api `GET /v1/q/account-digest`) -- for the resume opening
 * and any surface that wants to say what is waiting. The session is the
 * caller's (server-side); nothing here reads cookies, so the module stays
 * safe to import from client components. Null when it could not be read;
 * never an empty digest standing in for a failure.
 */
export type AccountDigestReader = () => Promise<QAccountDigest | null>;

export function createQApiAccountDigestReader(
  session: { readonly baseUrl: string; readonly accessToken: string } | null,
  fetchImpl: typeof fetch = fetch,
): AccountDigestReader {
  return async () => {
    if (session === null) return null;
    try {
      const url = new URL(Q_ACCOUNT_DIGEST_PATH, session.baseUrl);
      const response = await fetchImpl(url, {
        headers: { authorization: `Bearer ${session.accessToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) return null;
      const read = QAccountDigestSchema.safeParse(await response.json());
      return read.success ? read.data : null;
    } catch {
      return null;
    }
  };
}

const WAITING_NAMES_MAX = 3;

/**
 * What a resume opening can say is waiting, from the digest, in plain
 * words: replies they owe (by name), approvals and other items waiting on
 * them, and the next call. Null when nothing is waiting and nothing is
 * booked. Never claims "nothing" for a section the digest could not read.
 */
export function accountDigestWaitingLine(
  digest: QAccountDigest,
): string | null {
  const owed = digest.relationships
    .filter((row) => row.owed === "YOU_OWE_REPLY")
    .map((row) => row.counterpart.name);
  const parts: string[] = [];
  if (owed.length > 0) {
    const named = owed.slice(0, WAITING_NAMES_MAX);
    const more = owed.length - named.length;
    parts.push(
      `${named.join(", ")}${more > 0 ? ` and ${String(more)} more` : ""} ${owed.length === 1 ? "is" : "are"} waiting for your reply`,
    );
  }
  const approvals = digest.waiting.filter(
    (item) => item.source === "APPROVAL",
  ).length;
  if (approvals > 0) {
    parts.push(
      `${String(approvals)} approval${approvals === 1 ? "" : "s"} ${approvals === 1 ? "is" : "are"} waiting on you`,
    );
  }
  const others =
    digest.waitingTotal -
    approvals -
    digest.waiting.filter((item) => item.source === "UNANSWERED_MESSAGE")
      .length;
  if (others > 0) {
    parts.push(
      `${String(others)} other thing${others === 1 ? "" : "s"} need${others === 1 ? "s" : ""} you`,
    );
  }
  const next = digest.meetings[0];
  if (next !== undefined) {
    parts.push(
      `your next call is ${next.purpose}${next.with.length === 0 ? "" : ` with ${next.with.join(", ")}`}`,
    );
  }
  if (parts.length === 0) return null;
  const line = parts.join("; ");
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}
