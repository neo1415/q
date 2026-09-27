import { describe, expect, it } from "vitest";

import {
  GOOGLE_CALLBACK_PATH,
  loadGoogleWorkspaceConfig,
} from "../src/google-workspace.js";

/**
 * Google Workspace configuration outside the laptop. Production once sent
 * a person to http://127.0.0.1:3000/settings after Google consent because
 * `CQ_WEB_ORIGIN` was unset on the API and the fallback was silent. Outside
 * `local` a missing origin or redirect URI is named and the integration is
 * off; it is never a localhost default.
 */

const credentials = {
  GOOGLE_WORKSPACE_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GOOGLE_WORKSPACE_CLIENT_SECRET: "client-secret-value",
  GOOGLE_TOKEN_ENCRYPTION_KEY: "a".repeat(44),
} as const;

describe("Google workspace configuration", () => {
  for (const env of ["preview", "staging", "production"] as const) {
    it(`${env}: no web origin and no redirect → both named, integration off, no localhost anywhere`, () => {
      const config = loadGoogleWorkspaceConfig({
        CAPITAL_Q_ENV: env,
        ...credentials,
      });
      expect(config.oauth).toBeUndefined();
      expect(config.webOrigin).toBeUndefined();
      expect(config.missing).toEqual([
        "GOOGLE_WORKSPACE_REDIRECT_URI",
        "CQ_WEB_ORIGIN",
      ]);
      expect(JSON.stringify(config)).not.toMatch(/127\.0\.0\.1|localhost/);
    });
  }

  it("production with an origin and a push audience: on, redirect derived from the API origin", () => {
    const config = loadGoogleWorkspaceConfig({
      CAPITAL_Q_ENV: "production",
      ...credentials,
      GOOGLE_PUBSUB_PUSH_AUDIENCE: "https://api.example.com/v1/push/google",
      CQ_WEB_ORIGIN: "https://app.example.com/",
    });
    expect(config.missing).toEqual([]);
    expect(config.webOrigin).toBe("https://app.example.com");
    expect(config.oauth?.redirectUri).toBe(
      `https://api.example.com${GOOGLE_CALLBACK_PATH}`,
    );
  });

  it("production with only the origin missing: named, and off even with every credential", () => {
    const config = loadGoogleWorkspaceConfig({
      CAPITAL_Q_ENV: "production",
      ...credentials,
      GOOGLE_WORKSPACE_REDIRECT_URI: `https://api.example.com${GOOGLE_CALLBACK_PATH}`,
    });
    expect(config.missing).toEqual(["CQ_WEB_ORIGIN"]);
    expect(config.oauth).toBeUndefined();
  });

  it("a disabled- placeholder counts as missing, not as a value", () => {
    const config = loadGoogleWorkspaceConfig({
      CAPITAL_Q_ENV: "staging",
      ...credentials,
      GOOGLE_WORKSPACE_REDIRECT_URI: `https://api.example.com${GOOGLE_CALLBACK_PATH}`,
      CQ_WEB_ORIGIN: "disabled-locally-000000000000",
    });
    expect(config.missing).toEqual(["CQ_WEB_ORIGIN"]);
  });

  it("local keeps the laptop defaults", () => {
    const config = loadGoogleWorkspaceConfig({
      CAPITAL_Q_ENV: "local",
      ...credentials,
    });
    expect(config.missing).toEqual([]);
    expect(config.webOrigin).toBe("http://127.0.0.1:3000");
    expect(config.oauth?.redirectUri).toBe(
      `http://localhost:3001${GOOGLE_CALLBACK_PATH}`,
    );
  });

  it("no CAPITAL_Q_ENV means local, as every other loader reads it", () => {
    expect(loadGoogleWorkspaceConfig({ ...credentials }).missing).toEqual([]);
  });
});
