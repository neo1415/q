/**
 * The shapes a document-gathering onboarding step shares between the server
 * action that reads real processing state and the screen that renders it
 * (CQ-Q-021 §14).
 *
 * Kept apart from the "use server" module so a client component can import
 * the types without pulling a server action into the browser bundle.
 */

export const MATERIAL_STATES = [
  "uploading",
  "received",
  "reviewing",
  "ready",
  "unreadable",
] as const;
export type MaterialState = (typeof MATERIAL_STATES)[number];

export type MaterialFileView = {
  readonly id: string;
  readonly filename: string;
  readonly kindLabel: string;
  readonly state: MaterialState;
  /** A plain sentence. Never a code, a queue id, a bucket or a stack trace. */
  readonly stateLabel: string;
};
