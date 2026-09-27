const REDACTED = "[redacted]";

/**
 * A provider credential in memory: an OAuth refresh or access token, a
 * client secret, a PKCE verifier. It cannot be stringified, serialised or
 * inspected into a log line, an error, a prompt or a response by accident;
 * `reveal()` is the only way to the value and is called only at the one
 * HTTP request that needs it.
 */
export class SecretToken {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}

/**
 * Belt and braces for text that may have touched a provider (an error
 * message, a response excerpt): anything shaped like a Google OAuth token,
 * an authorization code or a bearer header is replaced before it can be
 * logged. Our own code never puts a token in text; this is for text we did
 * not write.
 */
export function redactProviderText(text: string): string {
  return text
    .replace(/\bya29\.[\w.-]+/g, REDACTED)
    .replace(/\b1\/\/[\w.-]{10,}/g, REDACTED)
    .replace(/\b4\/[\w.-]{10,}/g, REDACTED)
    .replace(/(bearer\s+)[\w.~+/=-]+/gi, `$1${REDACTED}`)
    .replace(
      /("?(?:access_token|refresh_token|id_token|code|client_secret|code_verifier)"?\s*[:=]\s*"?)[^"&\s,}]+/gi,
      `$1${REDACTED}`,
    );
}
