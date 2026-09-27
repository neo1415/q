import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";

import { createTokenCipher } from "./crypto.js";
import { createGoogleCalendarProvider } from "./google/calendar.js";
import { createGmailEmailProvider } from "./google/gmail.js";
import { platformGoogleHttp, type GoogleHttp } from "./google/http.js";
import { createGoogleOAuthClient } from "./google/oauth.js";
import {
  createNetworkRelationshipActivityWriter,
  createPostgresIntegrationsStore,
} from "./postgres.js";
import {
  createIntegrationsService,
  type IntegrationsService,
} from "./service.js";

/**
 * The one composition of the Google integration, shared by api, q-api and
 * workers so the three can never disagree. Without the OAuth client or the
 * encryption key it composes an unavailable integration that says so.
 */
export function composeGoogleIntegrations(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly oauth:
    | {
        readonly clientId: string;
        readonly clientSecret: { readonly reveal: () => string };
        readonly redirectUri: string;
      }
    | undefined;
  readonly tokenEncryptionKey: { readonly reveal: () => string } | undefined;
  readonly pushTopic?: string | undefined;
  readonly http?: GoogleHttp | undefined;
  readonly logger?: Logger | undefined;
}): IntegrationsService {
  const http = options.http ?? platformGoogleHttp;
  return createIntegrationsService({
    store: createPostgresIntegrationsStore({
      sql: options.sql,
      transactions: options.transactions,
    }),
    transactions: options.transactions,
    activity: createNetworkRelationshipActivityWriter(),
    google:
      options.oauth === undefined || options.tokenEncryptionKey === undefined
        ? undefined
        : {
            oauth: createGoogleOAuthClient({ ...options.oauth, http }),
            cipher: createTokenCipher(options.tokenEncryptionKey.reveal()),
            email: createGmailEmailProvider(http),
            calendar: createGoogleCalendarProvider(http),
            pushTopic: options.pushTopic,
          },
    logger: options.logger,
  });
}
