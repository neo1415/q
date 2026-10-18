# Evidence: packages/q-actions/src/ports.ts lines 290-302

- Original path: `packages/q-actions/src/ports.ts`
- Line range: 290-302 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Default approval TTL 24h.

```ts
  290   * the default is conservative and explicit; a composition may narrow it.
  291   */
  292  export type QApprovalPolicy = {
  293    /** How long a requested approval stays open, and how long an APPROVED decision stays usable. */
  294    readonly approvalTtlMs: number;
  295    /** Execution claims permitted per action, counting retries of retryable failures. */
  296    readonly maxExecutionAttempts: number;
  297  };
  298
  299  export const DEFAULT_Q_APPROVAL_POLICY: QApprovalPolicy = Object.freeze({
  300    approvalTtlMs: 24 * 60 * 60 * 1000,
  301    maxExecutionAttempts: 3,
  302  });
```
