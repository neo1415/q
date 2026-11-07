import type { FastifyInstance } from "fastify";

import { workspaceModeFromClaims } from "@capital-q/config/workspace-mode";
import { Q_VOICE_SCREEN_PATH } from "@capital-q/contracts";
import { extractBearerToken } from "@capital-q/security/supabase";

/**
 * Owner, batch 6 (decision 78 follow-up): Q's page-move decision runs only
 * for a person who opted in to the Q Workspace.
 *
 * The browser sends `screen.workspace` while the split workspace is on in
 * that tab. That is a hint about their screen, never authority. q-api keeps
 * it only when the person's own token says the workspace is on for them,
 * by the same rule the web app renders with (workspaceModeFromClaims over
 * `CQ_WORKSPACE_MODE` and their `user_metadata` preference), and drops it
 * otherwise before any handler reads the body. Without it the answer path
 * never starts a navigation decision, so a person who did not opt in costs
 * nothing and is never moved.
 *
 * The token is read here without verifying its signature. That is safe
 * because the gate can only take the hint away: a forged token claiming
 * the workspace is on fails the route's own authentication, which verifies
 * this same Authorization header before the handler runs.
 */
export function workspaceHintAllowed(
  authorization: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const token = extractBearerToken(authorization);
  if (token === null) return false;
  const payload = token.split(".")[1];
  if (payload === undefined) return false;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  return workspaceModeFromClaims(claims, env).enabled;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Registers the gate on every route (a preValidation hook: after the body
 * is parsed and the route authenticated, before its handler reads it). The
 * environment is read per request, so `CQ_WORKSPACE_MODE` reverts with a
 * variable change.
 */
export function registerWorkspaceGate(
  app: FastifyInstance,
  env: () => Readonly<Record<string, string | undefined>> = () => process.env,
): void {
  app.addHook("preValidation", (request, _reply, done) => {
    const body = request.body;
    if (!isObject(body)) {
      done();
      return;
    }
    // Where a body carries it: a run's or a voice line's `screen`, and the
    // voice line's screen updates, which are a screen themselves.
    const screen = isObject(body["screen"]) ? body["screen"] : null;
    const top = request.routeOptions.url === Q_VOICE_SCREEN_PATH ? body : null;
    const carries =
      (screen !== null && "workspace" in screen) ||
      (top !== null && "workspace" in top);
    if (!carries) {
      done();
      return;
    }
    const header = request.headers.authorization;
    if (
      !workspaceHintAllowed(
        typeof header === "string" ? header : undefined,
        env(),
      )
    ) {
      if (screen !== null) delete screen["workspace"];
      if (top !== null) delete top["workspace"];
    }
    done();
  });
}
