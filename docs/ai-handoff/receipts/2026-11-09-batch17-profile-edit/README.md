# Batch 17 (3466339cb) live check: editing your own mandate mid-conversation, fictional investor savanna-seed

CI 1898 is green, including the integration job: W4's Postgres firewall tests (own scopes; a founder never gets the investor mandate; cross-tenant DENIED). All four services SUCCESS at 09:58 UTC.

- On /work, "tell me about clinicrest" → Clinicrest company page (6.4 s).
- Then "change my cheque range to 50k to 3m":
  - /profile opens (4.6 s);
  - Q prepares **"Update your mandate"** for approval (not approved in this check);
  - **no raw "That doesn't fit" text.**
  - This is the owner's 9 Nov failure, fixed.
- Small follow-ups:
  - Q's line "The card shows the details once it's saved" should instead say what will change (min $50,000, max $3,000,000).
  - A "Company · 1" sources chip appears on a mandate edit.
  - The whole turn took 61 s.
