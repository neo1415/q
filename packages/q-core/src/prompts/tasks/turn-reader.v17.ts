import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV15Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V16 } from "./turn-reader.v16.js";

/**
 * TURN_READER v17 -- v16, plus every other screen of the app (founder
 * direction 2026-09-30: "Q can take me anywhere"): Investors, Search, the
 * GateQ gateway, what Q remembers, and adding a pitch video. Same output
 * schema; whether this person may open a screen is still decided by the
 * navigate capability, not here.
 */
const V16_LAST_DESTINATION =
  "COMPANY_INTEREST (their company's incoming investor interest, to read and answer it).";

const V17_LAST_DESTINATIONS =
  "COMPANY_INTEREST (their company's incoming investor interest, to read and answer it), INVESTORS (the Investors page: for a founder, investors open to connection requests; for an investor, requests founders sent them), SEARCH (search people by name or handle, and pitch videos), GATEWAY (their GateQ gateway: its public link, QR code, website snippet and applications), MEMORY (what Q remembers about them, to review or forget), NEW_PITCH (add a new pitch video).";

if (!TURN_READER_V16.template.includes(V16_LAST_DESTINATION)) {
  throw new Error(
    "TURN_READER v17 extends v16's NAVIGATE destinations, which v16 lost",
  );
}

export const TURN_READER_V17: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV15Result
> = {
  ...TURN_READER_V16,
  version: 17,
  status: "ACTIVE",
  changeDescription:
    "Founder direction 2026-09-30: every screen of the app is a destination (Investors, Search, Gateway, Memory, new pitch video).",
  effectiveFrom: "2026-09-30",
  template: TURN_READER_V16.template.replace(
    V16_LAST_DESTINATION,
    V17_LAST_DESTINATIONS,
  ),
};
