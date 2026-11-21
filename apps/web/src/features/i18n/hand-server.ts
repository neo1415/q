import "server-only";

import { ARABIC } from "./arabic";
import { registerHandCatalogue } from "./messages";

/**
 * W4-A: the server translates with every hand catalogue from the start
 * (server components, page titles, e-mails); only the browser loads them
 * on demand. Imported by every server entry to the catalogue.
 */
registerHandCatalogue("ar", ARABIC);
