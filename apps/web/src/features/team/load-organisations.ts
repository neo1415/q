import type { MyOrganisationDto } from "@capital-q/contracts";

import { resolveMyOrganisations } from "@/features/q/context";

/** The person's companies and firms for the switcher; none when unreadable. */
export async function loadMyOrganisations(): Promise<
  readonly MyOrganisationDto[]
> {
  return resolveMyOrganisations();
}
