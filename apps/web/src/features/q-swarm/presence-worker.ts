import type { Rgb } from "./presence-gl";
import {
  startPresenceLoop,
  type PresenceInputs,
  type PresenceLoop,
} from "./presence-loop";

/**
 * Q room W7: the presence drawn off the main thread. The page hands this
 * worker its canvas (transferControlToOffscreen) and then only small
 * messages: what Q is doing, the colour, the voice levels and the
 * cursor's lean. The swarm's step and every draw -- the WebGL frame and
 * its copy onto the surface -- happen here, so they never hold up a tap.
 */

export type PresenceWorkerMessage =
  | {
      readonly type: "start";
      readonly canvas: OffscreenCanvas;
      readonly pixels: number;
      readonly dpr: number;
      readonly cores: number | undefined;
      readonly allow3d: boolean;
      readonly inputs: PresenceInputs;
      readonly colour: Rgb;
      readonly dark: boolean;
    }
  | { readonly type: "inputs"; readonly inputs: PresenceInputs }
  | { readonly type: "colour"; readonly colour: Rgb; readonly dark: boolean }
  | { readonly type: "levels"; readonly input: number; readonly output: number }
  | { readonly type: "lean"; readonly x: number; readonly y: number }
  | { readonly type: "visible"; readonly onScreen: boolean; readonly hidden: boolean }
  | { readonly type: "stop" };

export type PresenceWorkerNote = {
  readonly type: "note";
  readonly key: "qFigure" | "qRenderer";
  readonly value: string;
};

// A dedicated worker's global: the DOM typings describe the calls used
// here (onmessage, postMessage, requestAnimationFrame, close) alike.
const scope = self;
let loop: PresenceLoop | null = null;
const levels = { input: 0, output: 0 };
const lean = { x: 0, y: 0 };
let hidden = false;

/** A worker without animation frames (older engines) uses a timer. */
const framed = typeof scope.requestAnimationFrame === "function";
function requestFrame(callback: (now: number) => void): number {
  return framed
    ? scope.requestAnimationFrame(callback)
    : scope.setTimeout(() => callback(performance.now()), 16);
}
function cancelFrame(handle: number): void {
  if (framed) scope.cancelAnimationFrame(handle);
  else scope.clearTimeout(handle);
}

scope.onmessage = (event: MessageEvent<PresenceWorkerMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "start":
      loop?.dispose();
      loop = startPresenceLoop({
        canvas: message.canvas,
        pixels: message.pixels,
        dpr: message.dpr,
        cores: message.cores,
        allow3d: message.allow3d,
        inputs: message.inputs,
        colour: message.colour,
        dark: message.dark,
        levels: () => levels,
        leanTarget: () => lean,
        hidden: () => hidden,
        note: (key, value) => {
          const note: PresenceWorkerNote = { type: "note", key, value };
          scope.postMessage(note);
        },
        load3d: () => import("./presence-3d"),
        requestFrame,
        cancelFrame,
        now: () => performance.now(),
      });
      break;
    case "inputs":
      loop?.set(message.inputs);
      break;
    case "colour":
      loop?.setColour(message.colour, message.dark);
      break;
    case "levels":
      levels.input = message.input;
      levels.output = message.output;
      break;
    case "lean":
      lean.x = message.x;
      lean.y = message.y;
      break;
    case "visible":
      hidden = message.hidden;
      loop?.setOnScreen(message.onScreen && !message.hidden);
      break;
    case "stop":
      loop?.dispose();
      loop = null;
      scope.close();
      break;
  }
};
