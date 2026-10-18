import { z } from "zod";

import { GOOGLE_WORKSPACE_SCOPES } from "@capital-q/contracts";

import { SecretToken } from "../secret.js";
import {
  errorForStatus,
  GoogleProviderError,
  readJson,
  send,
  type GoogleHttp,
} from "./http.js";

/**
 * Google OAuth 2.0 for the "Capital Q workspace" client (BIZ-007):
 * authorization code with PKCE (S256), offline access, exactly the
 * setup contract's scopes, token refresh and revocation.
 *
 * The ID token arrives on the direct, TLS-validated response from Google's
 * token endpoint to this server, so its claims are read without a second
 * signature check (OpenID Connect Core §3.1.3.7). It is used for the
 * subject and address only and is never stored.
 */

export const GOOGLE_AUTHORIZE_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export type GoogleOAuthClientConfig = {
  readonly clientId: string;
  readonly clientSecret: { readonly reveal: () => string };
  readonly redirectUri: string;
  readonly http: GoogleHttp;
};

export type GoogleTokenGrant = {
  readonly refreshToken: SecretToken;
  readonly accessToken: SecretToken;
  readonly expiresInSeconds: number;
  readonly scopes: readonly string[];
  readonly subject: string;
  readonly email: string;
};

export type GoogleOAuthClient = {
  readonly authorizationUrl: (input: {
    readonly state: string;
    readonly codeChallenge: string;
  }) => string;
  readonly exchangeCode: (input: {
    readonly code: string;
    readonly codeVerifier: SecretToken;
  }) => Promise<GoogleTokenGrant>;
  readonly refresh: (refreshToken: SecretToken) => Promise<{
    readonly accessToken: SecretToken;
    readonly expiresInSeconds: number;
  }>;
  /** Best effort: Google revokes the grant for every token of it. */
  readonly revoke: (token: SecretToken) => Promise<void>;
};

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});

const IdClaimsSchema = z.object({
  sub: z.string().regex(/^[0-9A-Za-z_-]{1,255}$/),
  email: z.email(),
  email_verified: z.boolean().optional(),
});

function idClaims(idToken: string | undefined) {
  const part = idToken?.split(".")[1];
  if (part === undefined) {
    throw new GoogleProviderError("MALFORMED_RESPONSE", null);
  }
  try {
    const claims = IdClaimsSchema.parse(
      JSON.parse(Buffer.from(part, "base64url").toString("utf8")),
    );
    if (claims.email_verified === false) {
      throw new GoogleProviderError("REJECTED", null);
    }
    return claims;
  } catch (error: unknown) {
    if (error instanceof GoogleProviderError) throw error;
    throw new GoogleProviderError("MALFORMED_RESPONSE", null);
  }
}

function form(values: Readonly<Record<string, string>>): string {
  return new URLSearchParams(values).toString();
}

const FORM_HEADERS = {
  "content-type": "application/x-www-form-urlencoded",
  accept: "application/json",
} as const;

export function createGoogleOAuthClient(
  config: GoogleOAuthClientConfig,
): GoogleOAuthClient {
  const tokenRequest = async (values: Record<string, string>) => {
    const response = await send(config.http, GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: FORM_HEADERS,
      body: form({
        ...values,
        client_id: config.clientId,
        client_secret: config.clientSecret.reveal(),
      }),
    });
    if (response.status === 400 || response.status === 401) {
      // invalid_grant: revoked, expired or already-used code/refresh token.
      throw new GoogleProviderError("INVALID_GRANT", response.status);
    }
    if (response.status !== 200) throw errorForStatus(response.status);
    const parsed = TokenResponseSchema.safeParse(await readJson(response));
    if (!parsed.success) {
      throw new GoogleProviderError("MALFORMED_RESPONSE", response.status);
    }
    return parsed.data;
  };

  return {
    authorizationUrl: ({ state, codeChallenge }) => {
      const url = new URL(GOOGLE_AUTHORIZE_URL);
      url.search = form({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: GOOGLE_WORKSPACE_SCOPES.join(" "),
        access_type: "offline",
        // A refresh token every time: a reconnect after a revoke needs one.
        prompt: "consent",
        include_granted_scopes: "false",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      return url.toString();
    },
    exchangeCode: async ({ code, codeVerifier }) => {
      const token = await tokenRequest({
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier.reveal(),
        redirect_uri: config.redirectUri,
      });
      if (token.refresh_token === undefined) {
        throw new GoogleProviderError("MALFORMED_RESPONSE", 200);
      }
      const claims = idClaims(token.id_token);
      return {
        refreshToken: new SecretToken(token.refresh_token),
        accessToken: new SecretToken(token.access_token),
        expiresInSeconds: token.expires_in,
        scopes: (token.scope ?? "").split(" ").filter((s) => s.length > 0),
        subject: claims.sub,
        email: claims.email.toLowerCase(),
      };
    },
    refresh: async (refreshToken) => {
      const token = await tokenRequest({
        grant_type: "refresh_token",
        refresh_token: refreshToken.reveal(),
      });
      return {
        accessToken: new SecretToken(token.access_token),
        expiresInSeconds: token.expires_in,
      };
    },
    revoke: async (token) => {
      const response = await send(config.http, GOOGLE_REVOKE_URL, {
        method: "POST",
        headers: FORM_HEADERS,
        body: form({ token: token.reveal() }),
      });
      // 400 = already invalid: the outcome the person asked for.
      if (response.status !== 200 && response.status !== 400) {
        throw errorForStatus(response.status);
      }
    },
  };
}

/** The granted scopes must include every scope we send and read with. */
export function hasRequiredScopes(granted: readonly string[]): boolean {
  const required = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.metadata",
  ];
  return required.every((scope) => granted.includes(scope));
}
