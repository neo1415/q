/** The tour's subject company, as the current viewer may see it. */
export type TourSubject = {
  readonly companyId: string;
  readonly name: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Pure core of `resolveTourSubject`: a configured, well-formed id, read
 * through the viewer's own authorised path. Anything else is no subject.
 */
export async function resolveTourSubjectWith(
  configured: string | undefined,
  readAsViewer: (companyId: string) => Promise<TourSubject | null>,
): Promise<TourSubject | null> {
  const id = configured?.trim() ?? "";
  if (!UUID.test(id)) return null;
  const seen = await readAsViewer(id.toLowerCase()).catch(() => null);
  // The read must answer for the company that was asked about.
  return seen !== null && seen.companyId.toLowerCase() === id.toLowerCase()
    ? seen
    : null;
}

/** How long one viewer's answer is reused: a revoked read lapses this soon. */
export const VIEWER_SUBJECT_TTL_MS = 60_000;
const VIEWER_SUBJECT_MAX = 500;

/**
 * One viewer's authorised answer about one company, reused briefly. The
 * key is the viewer's own id and the company, so an answer is never handed
 * to anyone but the viewer it was read for. A failed read is not kept.
 */
export class ViewerSubjectCache {
  private readonly entries = new Map<
    string,
    { readonly at: number; readonly value: Promise<TourSubject | null> }
  >();

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  read(
    viewerId: string,
    companyId: string,
    load: () => Promise<TourSubject | null>,
  ): Promise<TourSubject | null> {
    const key = `${viewerId}:${companyId}`;
    const at = this.now();
    const kept = this.entries.get(key);
    if (kept !== undefined && at - kept.at < VIEWER_SUBJECT_TTL_MS) {
      return kept.value;
    }
    if (this.entries.size >= VIEWER_SUBJECT_MAX) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    const value = load();
    this.entries.delete(key);
    this.entries.set(key, { at, value });
    // Neither a refusal nor a failure is remembered: the next load asks again.
    void value.then(
      (seen) => {
        if (seen === null) this.forget(key, value);
      },
      () => this.forget(key, value),
    );
    return value;
  }

  private forget(key: string, value: Promise<TourSubject | null>): void {
    if (this.entries.get(key)?.value === value) this.entries.delete(key);
  }
}
