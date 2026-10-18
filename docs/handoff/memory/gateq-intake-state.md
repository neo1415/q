---
name: gateq-intake-state
description: GateQ applicant surface is live at /v1/gateq/apply; guest document upload is blocked on an Evidence authority decision
metadata: 
  node_type: memory
  type: project
  originSessionId: 527a3870-2616-4832-9211-ae49f1424757
  modified: 2026-09-21T09:33:16.615Z
---

CQ-GATE-002/002R/002S closed 2026-09-21 at `ac4ec96`. The public applicant
surface (`/v1/gateq/apply`, four anonymous routes), per-session rate
limits and the QGATE eval profile (20 cases) are in; the API composes a
model gateway for the interview, reusing the existing GEMINI/GROQ keys.

**Guest document upload is not implemented and blocks CQ-GATE-003**
(`CQ-GATE-EVIDENCE-GUEST-001`). The blocker is in the schema, not only the
service: `evidence.documents.owner_organisation_id` and
`created_by_user_id` are NOT NULL with FKs to `identity.tenant_organisations`
and `identity.user_profiles`, and `document_versions.uploaded_by_user_id`
is the same inside an immutability trigger. A guest has neither. Widening
`subject_type` to GATEQ_APPLICATION is easy and has a precedent
(`20260924090000_presence_subjects.sql`); the identity columns are the
real change — 116 references across 19 Evidence files, plus the
storage-key derivation, the audit actor and the document event payload.

**Why:** the packet's preserved-invariant list forbids creating a fake
Supabase user, so the shortcut that would unblock this is the one thing
that cannot be taken.

**How to apply:** raise the authority-model choice with the user before
starting GATE-003, rather than discovering it again mid-packet. See
[[hosted-supabase-state]] for the pending migration range (now 20260925
through 20261003).
