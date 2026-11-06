import type { PromptDefinition } from "../definition.js";
import {
  TURN_SKIM_SCHEMA_NAME,
  TURN_SKIM_V11_SCHEMA_VERSION,
  TurnSkimV11ResultSchema,
  type TurnSkimV11Result,
  type TurnSkimV3Variables,
} from "../schemas/turn-skim.js";
import { V10_DOCUMENT, TURN_SKIM_V10 } from "./turn-skim.v10.js";

/**
 * v11 (owner's own account, live 2026-11-06 on 11180d8e6): "find me new
 * companies online that i would be interested in" was skimmed as FIT with
 * high confidence, and the fast lane answered with Capital Q's own mandate
 * ranking before the full reading landed, so "online" was never read and
 * nothing was searched. `onWeb` says the turn asks for companies or
 * investors out on the web or not on Capital Q, by meaning in any
 * language; code then waits for the full reading (q-specialists
 * fast-lane.ts). v10 is kept whole; one field is added for every kind.
 */
export const V11_ON_WEB = `onWeb (every kind): true when they ask you to find, look for or show companies, startups, founders or investors out on the public web -- online, on the internet, on the web, or ones that are not on Capital Q (yet) -- by what it means, in any language ("find me new companies online", "search the internet for fintech startups", "can you find more that aren't on Capital Q yet?", "busca startups en internet"). false when they ask only for what is on Capital Q, and for every other turn.
`;

if (TURN_SKIM_V10.template.split(V10_DOCUMENT).length !== 2) {
  throw new Error("TURN_SKIM v11 extends v10's document rule, which changed");
}

export const TURN_SKIM_V11: PromptDefinition<
  TurnSkimV3Variables,
  TurnSkimV11Result
> = {
  ...TURN_SKIM_V10,
  version: 11,
  status: "ACTIVE",
  changeDescription:
    "Owner's account, live 2026-11-06 (11180d8e6): 'find me new companies online that i would be interested in' was skimmed as FIT and answered from the in-app mandate ranking with no web search. v10 plus onWeb (every kind) -- the turn asks for companies, founders or investors on the public web or not on Capital Q, read by meaning in any language; the fast lane then waits for the full reading.",
  effectiveFrom: "2026-11-06",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_SKIM_SCHEMA_NAME,
    schemaVersion: TURN_SKIM_V11_SCHEMA_VERSION,
    schema: TurnSkimV11ResultSchema,
  },
  template: TURN_SKIM_V10.template.replace(
    V10_DOCUMENT,
    `${V10_DOCUMENT}${V11_ON_WEB}`,
  ),
};
