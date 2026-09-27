/**
 * @capital-q/integrations (BIZ-007)
 *
 * Owns: a person's connected Google mailbox (OAuth + PKCE, the sealed
 * refresh token, disconnect/revoke), the EmailProvider port and its Gmail
 * adapter, approved sends on the canonical relationship, and reply
 * tracking (Gmail history via verified Pub/Sub push, and polling).
 *
 * Does not own: authority. A send happens only as the executor of an
 * approved `email.send` Q action (Approval Engine); relationship history
 * is written through the Network context's appender.
 *
 * Server-side only.
 */

export {
  createTokenCipher,
  pkceChallenge,
  randomUrlToken,
  sha256Hex,
  TokenCipherError,
  type TokenCipher,
} from "./crypto.js";
export { redactProviderText, SecretToken } from "./secret.js";
export {
  addressOf,
  buildRfc822,
  MimeHeaderError,
  newMessageId,
  referencedMessageIds,
  toBase64Url,
  type OutboundMime,
} from "./mime.js";
export type {
  EmailProvider,
  InboundMetadata,
  MailboxAccess,
  SentMessage,
} from "./email-provider.js";
export {
  errorForStatus,
  GoogleProviderError,
  platformGoogleHttp,
  type GoogleHttp,
  type GoogleHttpRequest,
  type GoogleHttpResponse,
  type GoogleProviderErrorCode,
} from "./google/http.js";
export {
  createGoogleOAuthClient,
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  hasRequiredScopes,
  type GoogleOAuthClient,
  type GoogleTokenGrant,
} from "./google/oauth.js";
export { createGmailEmailProvider, GMAIL_API } from "./google/gmail.js";
export {
  createGoogleKeySource,
  decodeGmailNotification,
  GOOGLE_CERTS_URL,
  PushTokenError,
  verifyGooglePushToken,
  type GoogleKeySource,
  type PushTokenRefusal,
} from "./google/oidc.js";
export type {
  CounterpartDirectory,
  EmailMessageRecord,
  GoogleAccountRecord,
  IntegrationsStore,
  OAuthStateRecord,
  RelationshipActivityWriter,
  RelationshipContact,
} from "./store.js";
export {
  createIntegrationsService,
  IntegrationUnavailableError,
  OAUTH_STATE_TTL_MS,
  type CompleteConnectOutcome,
  type IntegrationsService,
  type IntegrationsServiceDependencies,
  type SendApprovedEmailCommand,
  type SendApprovedEmailOutcome,
} from "./service.js";
export {
  createNetworkRelationshipActivityWriter,
  createPostgresCounterpartDirectory,
  createPostgresIntegrationsStore,
} from "./postgres.js";
export { composeGoogleIntegrations } from "./compose.js";
