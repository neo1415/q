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
