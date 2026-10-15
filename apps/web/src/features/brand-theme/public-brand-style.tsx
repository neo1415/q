import { composeBrandStyle } from "./brand-compose";
import { BrandStyle } from "./brand-style";

/**
 * Capital Q's own brand (the default black-and-gold preset) for surfaces a
 * visitor sees before, or without, a session: the landing page, the auth
 * pages, public GateQ pages and shared cards.
 *
 * It reads no request data on purpose: public pages stay prerenderable and a
 * tenant's own preset (applied inside the signed-in app) never leaks onto
 * them. The sheet defines both themes, so light, dark and the device choice
 * all keep working through the one `data-theme` contract.
 */
const PUBLIC_BRAND_CSS = composeBrandStyle(null);

export function PublicBrandStyle() {
  return <BrandStyle css={PUBLIC_BRAND_CSS} />;
}
