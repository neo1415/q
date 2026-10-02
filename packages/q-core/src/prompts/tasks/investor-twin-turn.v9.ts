import type { PromptDefinition } from "../definition.js";
import type {
  RehearsalTurnV6Variables,
  RehearsalTurnV7Result,
} from "../schemas/rehearsal.js";
import { INVESTOR_TWIN_TURN_V8 } from "./investor-twin-turn.v8.js";

const V8_NO_CAMERA =
  "- When they ask you to look and cameraOn is false: say plainly you can't see them -- their camera isn't shared with you -- and that they can switch on \"Let Q see you\" at the bottom of the call. Never pretend.";
const V9_NO_CAMERA =
  "- When they ask you to look and cameraOn is false: say exactly what WHAT YOU MAY SAY ABOUT WHAT YOU SEE tells you -- it alone says whether they have shared their camera with you. Never say the camera isn't shared unless that line says so. Never pretend to see.";

/**
 * INVESTOR_TWIN_TURN v9 -- v8, with "can't see you" left to code's note
 * (live 2026-10-02, e53c264f: with the camera shared, a pass without a
 * frame told the person their camera wasn't shared). Code knows whether
 * they consented; the model no longer infers it from cameraOn.
 */
export const INVESTOR_TWIN_TURN_V9: PromptDefinition<
  RehearsalTurnV6Variables,
  RehearsalTurnV7Result
> = {
  ...INVESTOR_TWIN_TURN_V8,
  version: 9,
  status: "ACTIVE",
  changeDescription:
    "Live 2026-10-02 (e53c264f): whether the camera is shared is said by code's note only; the model never infers 'not shared' from cameraOn.",
  effectiveFrom: "2026-10-02",
  template: INVESTOR_TWIN_TURN_V8.template.replace(V8_NO_CAMERA, V9_NO_CAMERA),
};
