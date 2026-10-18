import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV31Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V30_ASKED_ACTION } from "./turn-reader.v30.js";
import { TURN_READER_V35 } from "./turn-reader.v35.js";

/**
 * TURN_READER v36 -- v35 plus the name (QA parity runs a6b19977, 11cae894,
 * 06289687 on v35): "We've decided not to proceed with Ledgerfold for now"
 * was read TOOL_REQUEST HIGH but askedAction stayed null, so code had no
 * action to run and the answer model only listed pending approvals. v35 told
 * the reader the kind, not the name: the ASKED ACTION rule ("null when none
 * of the listed actions does it") met a list label about meetings. A stated
 * decision now names relationship_outcome in askedAction too, a near-miss of
 * a name they have (a misheard "Ledgefold") is still that relationship, and
 * the APP ACTION rule shows its arguments. Same schema and order as v35; the
 * new words sit in the static prefix.
 */
const V36_ASKED_ACTION = `${TURN_READER_V30_ASKED_ACTION.trimEnd()} A decision they state about one of their own relationships (not proceeding for now, pausing, resuming, starting diligence, what a meeting led to) is relationship_outcome, even said as news and even when it names no meeting; a company or investor name that sounds close to one they are connected with (a misheard "Ledgefold" for Ledgerfold) is still that one.
`;
const V35_APP_ACTION_EXAMPLE =
  'for example {"company": "Ajopot"} or {"pitch": "my pitch video", "sharing": "INVESTORS"}';
const V36_APP_ACTION_EXAMPLE = `${V35_APP_ACTION_EXAMPLE}; a stated decision is {"relationship": "Ledgerfold", "operation": "NOT_PROCEED"}, or "PAUSE", "RESUME", or {"relationship": "Ledgerfold", "operation": "MEETING_OUTCOME", "meetingOutcome": "DILIGENCE"}`;

for (const anchor of [TURN_READER_V30_ASKED_ACTION, V35_APP_ACTION_EXAMPLE]) {
  if (TURN_READER_V35.template.split(anchor).length !== 2) {
    throw new Error(`TURN_READER v36 edits v35 once, which lost: ${anchor}`);
  }
}

export const TURN_READER_V36: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV31Result
> = {
  ...TURN_READER_V35,
  version: 36,
  status: "DEPRECATED",
  changeDescription:
    "QA parity runs a6b19977, 11cae894, 06289687 (v35): a stated decision about one of their relationships names relationship_outcome in askedAction, a near-miss name is still that relationship, and appAction shows its arguments. Same schema and order as v35.",
  effectiveFrom: "2026-10-02",
  template: TURN_READER_V35.template
    .replace(TURN_READER_V30_ASKED_ACTION, V36_ASKED_ACTION)
    .replace(V35_APP_ACTION_EXAMPLE, V36_APP_ACTION_EXAMPLE),
};
