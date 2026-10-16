import type { AnchorId, SceneScript, TourScript } from "./script.js";

/**
 * Q Pitch v6: the tour as numbered steps, addressed by id (owner addendum,
 * 16 Oct). A step is a scene; its id is the scene id, stable across
 * versions. Each node knows its neighbours, so "next", "back two" and "go
 * to step 7" are lookups, never a decision.
 */
export type StepNode = {
  readonly stepId: string;
  /** 1-based, as the viewer counts. */
  readonly number: number;
  readonly title: string;
  readonly prevId: string | null;
  readonly nextId: string | null;
  /** The page the step opens on (the scene's expected route). */
  readonly route: string;
  /** The sections it talks about, in narration order. */
  readonly anchors: readonly AnchorId[];
};

export type StepGraph = {
  readonly steps: readonly StepNode[];
  readonly byId: (stepId: string) => StepNode | null;
  readonly byNumber: (number: number) => StepNode | null;
};

function anchorsOf(scene: SceneScript): AnchorId[] {
  const seen: AnchorId[] = [];
  for (const line of scene.lines) {
    if (line.anchor !== undefined && !seen.includes(line.anchor)) {
      seen.push(line.anchor);
    }
  }
  return seen;
}

export function buildStepGraph(script: Pick<TourScript, "scenes">): StepGraph {
  const scenes = script.scenes;
  const steps: StepNode[] = scenes.map((scene, index) => ({
    stepId: scene.sceneId,
    number: index + 1,
    title: scene.title,
    prevId: scenes[index - 1]?.sceneId ?? null,
    nextId: scenes[index + 1]?.sceneId ?? null,
    route: scene.expectedRoute,
    anchors: anchorsOf(scene),
  }));
  const index = new Map(steps.map((step) => [step.stepId, step]));
  return {
    steps,
    byId: (stepId) => index.get(stepId) ?? null,
    byNumber: (number) => steps[number - 1] ?? null,
  };
}
