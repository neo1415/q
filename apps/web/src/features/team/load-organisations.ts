import { getMyOrganisations } from "@capital-q/api-client";
import type { MyOrganisationDto } from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/** The person's companies and firms for the switcher; none when unreadable. */
export async function loadMyOrganisations(): Promise<
  readonly MyOrganisationDto[]
> {
  const session = await apiSession();
  if (session === null) return [];
  return getMyOrganisations(session)
    .then((mine) => mine.items)
    .catch(() => []);
}
