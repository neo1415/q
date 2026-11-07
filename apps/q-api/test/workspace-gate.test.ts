import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { Q_VOICE_SCREEN_PATH } from "@capital-q/contracts";

import {
  registerWorkspaceGate,
  workspaceHintAllowed,
} from "../src/security/workspace-gate.js";

/**
 * Owner, batch 6 (decision 78 follow-up): Q's page-move decision runs only
 * for a person who opted in to the Q Workspace. The browser's
 * screen.workspace is a hint; q-api keeps it only when the person's own
 * token says the workspace is on for them (workspaceModeFromClaims, the
 * same rule the web app renders by), and drops it otherwise, before any
 * handler reads the body.
 */

const tokenWith = (metadata: Record<string, unknown> | null): string => {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `Bearer ${part({ alg: "ES256" })}.${part({
    sub: "u",
    ...(metadata === null ? {} : { user_metadata: metadata }),
  })}.signature`;
};
const ON = tokenWith({ cq_workspace: "on" });
const OFF = tokenWith({ cq_workspace: "off" });
const UNSET = tokenWith(null);
const WORKSPACE = { qPane: "open", pagePane: "open", at: "/home" };

describe("whether the workspace hint is theirs", () => {
  it("labs: only a person who turned it on; on: all but one who turned it off; off or unset: nobody", () => {
    const labs = { CQ_WORKSPACE_MODE: "labs" };
    const on = { CQ_WORKSPACE_MODE: "on" };
    expect(workspaceHintAllowed(ON, labs)).toBe(true);
    expect(workspaceHintAllowed(UNSET, labs)).toBe(false);
    expect(workspaceHintAllowed(OFF, labs)).toBe(false);
    expect(workspaceHintAllowed(UNSET, on)).toBe(true);
    expect(workspaceHintAllowed(OFF, on)).toBe(false);
    expect(workspaceHintAllowed(ON, { CQ_WORKSPACE_MODE: "off" })).toBe(false);
    expect(workspaceHintAllowed(ON, {})).toBe(false);
  });

  it("no token, or one that is not a JWT: never", () => {
    const labs = { CQ_WORKSPACE_MODE: "labs" };
    expect(workspaceHintAllowed(undefined, labs)).toBe(false);
    expect(workspaceHintAllowed("Bearer not-a-jwt", labs)).toBe(false);
    expect(workspaceHintAllowed("Basic abc", labs)).toBe(false);
  });
});

describe("the gate, before any handler", () => {
  async function app(env: Record<string, string | undefined>) {
    const server = Fastify();
    registerWorkspaceGate(server, () => env);
    const seen: unknown[] = [];
    server.post("/v1/q/runs", (request) => {
      seen.push(request.body);
      return {};
    });
    server.post(Q_VOICE_SCREEN_PATH, (request) => {
      seen.push(request.body);
      return {};
    });
    await server.ready();
    return { server, seen };
  }
  const labs = { CQ_WORKSPACE_MODE: "labs" };

  it("keeps screen.workspace for a person who opted in", async () => {
    const { server, seen } = await app(labs);
    await server.inject({
      method: "POST",
      url: "/v1/q/runs",
      headers: { authorization: ON },
      payload: { screen: { route: "HOME", workspace: WORKSPACE } },
    });
    expect(seen[0]).toEqual({
      screen: { route: "HOME", workspace: WORKSPACE },
    });
  });

  it("drops it for anyone else, keeping the rest of the screen", async () => {
    const { server, seen } = await app(labs);
    await server.inject({
      method: "POST",
      url: "/v1/q/runs",
      headers: { authorization: UNSET },
      payload: {
        message: "hi",
        screen: { route: "HOME", workspace: WORKSPACE },
      },
    });
    expect(seen[0]).toEqual({ message: "hi", screen: { route: "HOME" } });
  });

  it("the voice line's screen updates carry it at the top: dropped there too", async () => {
    const { server, seen } = await app(labs);
    await server.inject({
      method: "POST",
      url: Q_VOICE_SCREEN_PATH.replace(":voiceSessionId", "v1"),
      headers: { authorization: OFF },
      payload: { route: "HOME", workspace: WORKSPACE },
    });
    expect(seen[0]).toEqual({ route: "HOME" });
  });
});
