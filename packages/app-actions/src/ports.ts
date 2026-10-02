import type { InteractionSignalService } from "@capital-q/discovery";
import type { MediaService } from "@capital-q/media";
import type { ActorContext } from "@capital-q/security";

/**
 * The services the declared actions call (ADR 0040). Each composition (the
 * API for routes, the Q API for tools and approved actions) passes its own
 * instances; an action whose port is absent is not offered and its route
 * refuses, never half-runs.
 */
export type AppActionPorts = {
  readonly media?:
    Pick<MediaService, "listCompanyMedia" | "setPitchDetails"> | undefined;
  readonly interactions?: Pick<InteractionSignalService, "decide"> | undefined;
  /** The actor's own company, from their membership on the server. */
  readonly ownCompanyId?:
    ((actor: ActorContext) => Promise<string | null>) | undefined;
};
