import "server-only";

import { getPublicGateway } from "@capital-q/api-client";
import type { PublicGatewayDto } from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

/** A published gateway's public wording, or null for anything else. */
export async function publicGateway(
  publicId: string,
): Promise<PublicGatewayDto | null> {
  const { apiBaseUrl } = loadWebServerConfig();
  if (apiBaseUrl === undefined || !/^[A-Za-z0-9_-]{4,64}$/.test(publicId)) {
    return null;
  }
  return getPublicGateway(apiBaseUrl, publicId).catch(() => null);
}
