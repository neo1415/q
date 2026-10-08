# Logger redaction

Why included: Key-name redaction, one level deep; content discipline is by convention.

## `packages/observability/src/logger.ts` lines 7-38

```ts
    7  /**
    8   * Baseline redaction for field names that commonly carry credentials.
    9   *
   10   * This is a second line of defence, not the control. The primary rule is that
   11   * sensitive material is never passed to the logger in the first place: key-name
   12   * redaction cannot recognise a founder-private disclosure, a document body or a
   13   * Q prompt, because those have no distinguishing key name (ERA-143, TEO-054).
   14   */
   15  const REDACTED_PATHS = [
   16    "password",
   17    "*.password",
   18    "authorization",
   19    "*.authorization",
   20    "cookie",
   21    "*.cookie",
   22    "token",
   23    "*.token",
   24    "accessToken",
   25    "*.accessToken",
   26    "refreshToken",
   27    "*.refreshToken",
   28    "apiKey",
   29    "*.apiKey",
   30    "secret",
   31    "*.secret",
   32    "clientSecret",
   33    "*.clientSecret",
   34    "serviceRoleKey",
   35    "*.serviceRoleKey",
   36  ];
   37  
   38  export const REDACTED_PLACEHOLDER = "[redacted]";
```

## `packages/observability/src/logger.ts` lines 100-140

```ts
  100  /**
  101   * Create the structured logger for a service.
  102   *
  103   * Emits newline-delimited JSON to stdout. Logging performs no synchronous
  104   * network I/O; shipping logs onward is the platform's job.
  105   */
  106  export function createLogger(
  107    identity: ServiceIdentity,
  108    options: CreateLoggerOptions = {},
  109  ): Logger {
  110    const pinoOptions = {
  111      level: options.level ?? "info",
  112      base: baseFields(identity),
  113      redact: { paths: REDACTED_PATHS, censor: REDACTED_PLACEHOLDER },
  114    };
  115  
  116    const pinoLogger =
  117      options.destination === undefined
  118        ? pino(pinoOptions)
  119        : pino(pinoOptions, options.destination);
  120  
  121    return wrap(pinoLogger);
  122  }
  123  
  124  /**
  125   * The underlying Pino instance, for frameworks that own their own logging
  126   * (Fastify). This is the single sanctioned place Pino crosses the package
  127   * boundary; application code uses the `Logger` interface so that Pino-specific
  128   * usage does not spread through the codebase.
  129   */
  130  export function createFrameworkLogger(
  131    identity: ServiceIdentity,
  132    options: CreateLoggerOptions = {},
  133  ): PinoLogger {
  134    return pino({
  135      level: options.level ?? "info",
  136      base: baseFields(identity),
  137      redact: { paths: REDACTED_PATHS, censor: REDACTED_PLACEHOLDER },
  138    });
  139  }
```

