# GateQ recovery checkpoint

Recovery base: `codex/gateq-independent-qa` at `f03c963c20fa2f204ac9bc842b9f63bb8c5d4e34`; includes Claude backend `0552c4f73edf868198a02ee614b7bd359e7b6167` by ancestry. Original branches and local contact work in the earlier product checkout remain unchanged. Active branch: `codex/gateq-completion-recovery`.

## Contact verifier slice

The six-digit code verifier now uses application-bound HMAC-SHA256 with domain separation. It never falls back to unkeyed SHA256. Legacy outstanding codes must be reissued; already-confirmed contacts and verified-account confirmation remain valid. A missing or shorter-than-32-byte key fails closed before saving a code or sending mail. Database/schema shape is unchanged.

Before deploying the recovered backend, bind **`GATEQ_CONTACT_CODE_SECRET`** to the **api service only**, using a cryptographically random secret of at least 32 bytes (for example, 32 random bytes encoded as 64 hexadecimal characters). Store it in the existing server environment secret system. Use the same value on all api replicas; never expose it through `NEXT_PUBLIC_*`, client configuration, model input, logs, or Git. Do not reuse database, session, Supabase, or provider credentials. Rotation invalidates outstanding codes; request a new code. No value has been generated, printed, committed, or deployed by this slice.

This slice does not repair resend attempt reset, concurrent code confirmation, duplicate model calls, or final-turn/submission races. Do not expose the recovered backend until those defects and protected release gates are resolved. No new paid video usage is authorized by this work.

Focused regression results and exact pushed revision will be recorded after execution. Not deployed or browser accepted.
