import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  APP_ACTIONS,
  PERSON_ACTIONS,
  qCapabilityId,
} from "@capital-q/app-actions";
import { Q_CAPABILITIES } from "@capital-q/q-tools";

/**
 * R20/R33 parity: every HTTP route a person's action reaches, in the
 * application API and the Q API, and every page of the web app, is either
 * something Q can do (a capability id in the registry) or exempt with the
 * reason it is not. A new route or page that is neither fails here, so a
 * feature cannot ship that Q silently cannot do.
 *
 * Routes are read from the source (the `app.<method>(<path>` call sites),
 * so this runs without composing either service. The key is
 * `<app>/<file> <METHOD> <path expression>` exactly as written.
 *
 * An exemption is a stated reason why a route is not a person's action
 * (transport, webhook, public or anonymous surface, reference data, the Q
 * conversation itself) or cannot be a tool (a file download, a consent).
 * There is no backlog: a person's action without a Q capability fails.
 */

type Coverage = { readonly capability: string } | { readonly exempt: string };

const cap = (capability: string): Coverage => ({ capability });
const exempt = (reason: string): Coverage => ({ exempt: reason });

const HEALTH = exempt("liveness/readiness probe; not a person's action");
const ONBOARDING_SETUP = exempt(
  "account and organisation setup happens once, inside onboarding (the ADR 0016 loop and its own tools)",
);
const REFERENCE = exempt(
  "reference data the forms read (taxonomy); Q reads taxonomy through its own tools",
);
const Q_TRANSPORT = exempt(
  "the Q conversation's own transport (runs, messages, events, voice): Q is the one using it",
);
const WEBHOOK = exempt(
  "provider webhook or OAuth callback: called by Google/Cloudflare/Postmark, never by a person",
);
const PUBLIC = exempt(
  "public or anonymous surface (Q Card by handle/code, GateQ applicant): no signed-in Q session",
);
const PLAYER = exempt(
  "the video player's own signed playback, captions and (ADR 0047) signed download link: bytes go browser <-> CDN; Q reads transcripts with get_pitch_moment and sets downloads with set_pitch_sharing",
);
const DOWNLOAD = exempt(
  "a document's render or file download (PDF/PPTX, slides, a version), linked from its card; Q lists documents (list_my_documents) and the card carries the downloads",
);

// ADMIN block
const OPERATIONS_CONSOLE = exempt(
  "Capital Q's operations console (ADR 0033): platform operators only, step-up for writes; never Q's to act on, never a tenant's",
);
// end ADMIN block

const ROUTE_COVERAGE: Readonly<Record<string, Coverage>> = {
  // ---- apps/api ---------------------------------------------------------
  'api/app.ts GET "/health/live"': HEALTH,
  'api/app.ts GET "/health/ready"': HEALTH,

  "api/http/capital-objectives.ts GET base": cap("tool.get_capital_objective"),
  "api/http/capital-objectives.ts GET `${base}${CAPITAL_OBJECTIVE_CURRENT_SEGMENT}`":
    cap("tool.get_capital_objective"),
  "api/http/capital-objectives.ts GET byId": cap("tool.get_capital_objective"),

  // BIZ-008 meetings, reminders, notifications.
  "api/http/schedule.ts GET RELATIONSHIP_MEETINGS_PATH":
    cap("tool.list_schedule"),
  "api/http/schedule.ts POST RELATIONSHIP_MEETING_SLOTS_PATH": cap(
    "tool.find_meeting_times",
  ),
  "api/http/schedule.ts GET MEETING_BRIEF_PATH": cap("tool.list_schedule"),
  "api/http/schedule.ts GET REMINDERS_PATH": cap("tool.list_schedule"),
  "api/http/schedule.ts GET NOTIFICATIONS_PATH": exempt(
    "the notices panel's own feed of what already happened (a reminder due, an invite, a brief ready); Q reads the calls and reminders behind them with list_schedule",
  ),
  "api/http/schedule.ts POST NOTIFICATIONS_READ_PATH": exempt(
    "the read marker the notices panel records as notices are seen; not something a person asks for",
  ),
  // AUTO (ADR 0030): Web Push and notification settings.
  "api/http/push.ts GET PUSH_KEY_PATH": exempt(
    "the browser's own push subscription handshake (the public VAPID key); a device setting, not something Q does",
  ),
  "api/http/push.ts PUT PUSH_SUBSCRIPTION_PATH": exempt(
    "subscribing this device to pushes needs the browser's own permission prompt; only the person's tap can do it",
  ),
  "api/http/push.ts POST PUSH_SUBSCRIPTION_REMOVE_PATH": exempt(
    "unsubscribing this device from pushes is the browser's own device setting",
  ),
  "api/http/push.ts GET NOTIFICATION_SETTINGS_PATH": exempt(
    "the notification settings switches, shown in Settings and the notices panel",
  ),

  // R34 relationship chat.
  "api/http/chat.ts GET RELATIONSHIP_MESSAGES_PATH": cap("tool.list_messages"),
  "api/http/chat.ts POST RELATIONSHIP_MESSAGES_READ_PATH": exempt(
    "the read receipt the chat screen records as messages come into view; not something a person asks for",
  ),
  "api/http/chat.ts GET RELATIONSHIP_MESSAGE_ATTACHMENT_PATH": exempt(
    "a shared file's download to the browser from the chat; Q names shared files through list_messages",
  ),
  "api/http/chat.ts GET CHAT_UNREAD_PATH": exempt(
    "the unread badge the app shell polls; Q reads the messages themselves with list_messages",
  ),
  "api/http/companies.ts POST COMPANIES_PATH": ONBOARDING_SETUP,
  "api/http/companies.ts GET `${COMPANIES_PATH}/:companyId`":
    cap("tool.get_company"),
  "api/http/companies.ts GET `${COMPANIES_PATH}/:companyId${COMPANY_MARKETPLACE_READINESS_SEGMENT}`":
    cap("tool.read_my_record"),
  "api/http/companies.ts POST `${COMPANIES_PATH}/:companyId${COMPANY_MARKETPLACE_READINESS_ASSESS_SEGMENT}`":
    cap("tool.reassess_marketplace_readiness"),
  "api/http/companies.ts GET `${COMPANIES_PATH}/:companyId${COMPANY_NETWORK_PREVIEW_SEGMENT}`":
    cap("tool.read_my_record"),

  // A company's profile from Discover (2026-10-02; ADR 0041): Q reads a
  // company with get_company; the photo and the deck are file reads.
  "api/http/company-profile.ts GET `${base}${COMPANY_PROFILE_SEGMENT}`":
    cap("tool.get_company"),
  "api/http/company-profile.ts GET `${base}${COMPANY_PROFILE_PHOTO_SEGMENT}`":
    exempt(
      "the avatar's image: a redirect to a short-lived signed photo URL, bytes browser <-> storage; Q names the company instead",
    ),
  "api/http/company-profile.ts GET `${base}${COMPANY_PROFILE_DECK_DOWNLOAD_SEGMENT}`":
    DOWNLOAD,

  // Overnight A3-A7: the profile's Data room and Pitch deck tabs, read by Q
  // with its own read tools; opening a file is a signed read.
  "api/http/company-material.ts GET `${base}${COMPANY_DATA_ROOM_SEGMENT}`": cap(
    "tool.read_company_data_room",
  ),
  "api/http/company-material.ts GET `${base}${COMPANY_DATA_ROOM_OPEN_SEGMENT}`":
    DOWNLOAD,
  "api/http/company-material.ts GET `${base}${COMPANY_DECK_SEGMENT}`": cap(
    "tool.read_company_deck",
  ),
  "api/http/company-material.ts GET `${base}${COMPANY_DECK_OPEN_SEGMENT}`":
    DOWNLOAD,
  "api/http/company-material.ts GET `${base}${COMPANY_FOUNDER_SEGMENT}`":
    cap("tool.get_company"),
  // Investor promises (2026-10-07): each screen read is a Q tool too.
  "api/http/company-material.ts GET `${base}${COMPANY_ASSUMPTIONS_SEGMENT}`":
    cap("tool.company_assumptions"),
  // Founder documents (2026-10-08): the requests inbox and who can see each
  // document are read_my kinds; an investor's own questions and the
  // answers ride on the assumptions board.
  "api/http/company-material.ts GET `${base}${COMPANY_REQUESTS_SEGMENT}`":
    cap("tool.read_my"),
  "api/http/company-material.ts GET `${base}${COMPANY_QUESTIONS_SEGMENT}`": cap(
    "tool.company_assumptions",
  ),
  "api/http/company-material.ts GET DOCUMENT_ACCESS_PATH": cap("tool.read_my"),
  "api/http/company-material.ts GET FOLDER_ACCESS_PATH": cap("tool.read_my"),
  "api/http/gateq.ts GET GATEQ_INVESTOR_GATES_PATH": cap(
    "tool.find_prospective_investors",
  ),
  "q-api/http/investor-promises.ts GET FIT_COMPARE_PATH":
    cap("tool.fit_compare"),
  "q-api/http/investor-promises.ts GET FIT_THESIS_PATH": cap(
    "tool.thesis_reading",
  ),

  "api/http/company-team.ts GET `${base}${COMPANY_TEAM_ME_SUFFIX}`": cap(
    "tool.read_my_record",
  ),
  "api/http/company-team.ts GET `${base}${COMPANY_FOUNDER_PROFILE_ME_SUFFIX}`":
    cap("tool.read_my_record"),
  "api/http/company-team.ts GET `${base}${COMPANY_TEAM_FACTS_SUFFIX}`": cap(
    "tool.read_my_record",
  ),

  // E: Explore browses the same eligible slate as Discover.
  "api/http/explore.ts GET DISCOVERY_EXPLORE_PATH": cap("navigate.DISCOVER"),
  "api/http/explore.ts GET DISCOVERY_EXPLORE_RELATED_PATH":
    cap("navigate.DISCOVER"),
  "api/http/explore.ts GET DISCOVERY_EXPLORE_SEARCH_PATH": cap(
    "tool.search_companies",
  ),
  "api/http/discovery.ts GET DISCOVERY_COMPANIES_PATH": cap(
    "tool.discovery_slate",
  ),
  "api/http/discovery.ts GET DISCOVERY_INVESTORS_PATH": cap(
    "tool.find_prospective_investors",
  ),
  // Founders' videos (ADR 0021): browsed on Discover's second tab.
  "api/http/discovery.ts GET DISCOVERY_INVESTOR_PATH": cap(
    "offer.connection_request",
  ),
  "api/http/discovery.ts GET DISCOVERY_INVESTOR_PHOTO_PATH": exempt(
    "the avatar's image on a Q investor reference: a redirect to a short-lived signed logo URL, bytes browser <-> storage; Q names the investor instead",
  ),
  // The Discover row of their own companies' pitches (2026-10-02).
  "api/http/discovery.ts GET DISCOVERY_YOUR_COMPANIES_PATH":
    cap("navigate.DISCOVER"),
  "api/http/discovery.ts GET DISCOVERY_NETWORK_PITCHES_PATH":
    cap("navigate.DISCOVER"),

  "api/http/documents.ts GET sessionById": cap("offer.document_upload"),
  "api/http/documents.ts GET DOCUMENTS_PATH": cap(
    "tool.list_uploaded_documents",
  ),
  // P3: the owner's own file from the documents page (a download).
  "api/http/documents.ts GET `${DOCUMENTS_PATH}/:documentId${DOCUMENT_FILE_SEGMENT}`":
    DOWNLOAD,
  "api/http/documents.ts GET `${DOCUMENTS_PATH}/:documentId`": cap(
    "tool.list_uploaded_documents",
  ),

  "api/http/gateq-apply.ts POST GATEQ_APPLY_START_PATH": PUBLIC,
  "api/http/gateq-apply.ts GET GATEQ_APPLY_SESSION_PATH": PUBLIC,
  "api/http/gateq-apply.ts POST GATEQ_APPLY_TURN_PATH": PUBLIC,
  "api/http/gateq-apply.ts POST GATEQ_APPLY_SUBMIT_PATH": PUBLIC,
  // F1: the GateQ form, the same anonymous applicant surface.
  "api/http/gateq-apply.ts POST GATEQ_APPLY_ANSWERS_PATH": PUBLIC,
  ...Object.fromEntries(
    [
      "POST GATEQ_GATEWAYS_PATH",
      "GET GATEQ_GATEWAYS_PATH",
      "GET GATEQ_GATEWAY_PATH",
      "GET GATEQ_GATEWAY_VERSIONS_PATH",
      "POST GATEQ_GATEWAY_VERSIONS_PATH",
      "PUT GATEQ_GATEWAY_VERSION_PATH",
      "POST GATEQ_GATEWAY_PUBLISH_PATH",
      "POST GATEQ_GATEWAY_QUALIFY_PATH",
    ].map((route) => [
      `api/http/gateq.ts ${route}`,
      exempt(
        "GateQ gateway administration is opened from the Gateway page with one press; a Q tool for editing its rules comes later",
      ),
    ]),
  ),
  "api/http/gateq.ts GET GATEQ_PUBLIC_GATEWAY_PATH": PUBLIC,
  "api/http/gateq.ts POST GATEQ_APPLY_MATERIALS_PATH": exempt(
    "the founder ticking their own documents in the GateQ form, at the moment they press Send; consent belongs on that screen",
  ),
  "api/http/gateq.ts GET GATEQ_GATEWAY_APPLICATIONS_PATH": exempt(
    "the organisation reading applications submitted to its own gateway, on its gateway page",
  ),
  // F4: the GateQ inbox. Q reads it through its triage tool.
  "api/http/gateq.ts GET GATEQ_INBOX_PATH": cap("tool.gateq_inbox_triage"),
  "api/http/gateq.ts GET GATEQ_INBOX_ITEM_PATH": cap("tool.gateq_inbox_triage"),
  "api/http/gateq.ts GET COMPANY_CLAIMABLE_PATH": cap("offer.find_my_startup"),
  // P14: the claim's work-email code, and the claims waiting on a company.
  "api/http/gateq.ts POST COMPANY_CLAIM_CONFIRM_PATH": exempt(
    "a one-time code from the claimant's own inbox, typed on the claim screen; Q never holds it",
  ),
  "api/http/gateq.ts GET COMPANY_CLAIM_REQUESTS_PATH": exempt(
    "a company's admins reading who claimed their company, on Settings → Team",
  ),
  "api/http/gateq.ts GET GATEQ_MY_APPLICATIONS_PATH": exempt(
    "the founder's own GateQ applications and the investors' answers, listed on their GateQ page",
  ),
  "api/http/gateq.ts GET GATEQ_INBOX_PACK_PATH": exempt(
    "a zip file the investor downloads to their own device; Q has no device to save it to",
  ),

  // Capital Q's own operators; never Q's to act on, never a tenant's.
  "api/http/admin.ts GET ADMIN_OVERVIEW_PATH": exempt(
    "Capital Q's admin console: platform operators only, not a person's own action",
  ),
  "api/http/admin.ts GET ADMIN_ATTRIBUTION_PATH": exempt(
    "Capital Q's attribution and fee ledger: platform operators only",
  ),
  "api/http/admin.ts GET ADMIN_DISPUTES_PATH": exempt(
    "disputed commitments for Capital Q's operators: platform operators only",
  ),
  "api/http/admin.ts GET ADMIN_PAUSED_PATH": exempt(
    "accounts Q paused, for Capital Q's operators: platform operators only",
  ),
  "api/http/admin.ts POST ADMIN_REINSTATE_PATH": exempt(
    "an operator lifting a pause Q put on an account: a person's decision, never Q's",
  ),

  // ADMIN block (ADR 0033): the operations console. Operators only;
  // Q holds no console authority.
  // BILLING block (ADR 0034)
  "api/http/billing.ts GET BILLING_PLAN_PATH": cap("tool.get_my_plan"),
  "api/http/billing.ts GET BILLING_PLANS_PATH": cap("tool.get_my_plan"),
  "api/http/billing.ts POST BILLING_CHECKOUT_PATH": exempt(
    "buying a plan happens on the payment provider's own hosted page, by a person; Q never pays (it reads the plan with get_my_plan)",
  ),
  "api/http/billing.ts POST BILLING_PORTAL_PATH": exempt(
    "the payment provider's hosted billing portal, opened by a person; Q never manages payment",
  ),
  "api/http/billing.ts POST BILLING_STRIPE_WEBHOOK_PATH": WEBHOOK,
  "api/http/admin-billing.ts GET ADMIN_BILLING_ACCOUNT_PATH":
    OPERATIONS_CONSOLE,
  "api/http/admin-billing.ts POST ADMIN_BILLING_ASSIGN_PATH":
    OPERATIONS_CONSOLE,
  "api/http/admin-billing.ts POST ADMIN_BILLING_OVERRIDE_PATH":
    OPERATIONS_CONSOLE,
  "api/http/admin-billing.ts GET ADMIN_BILLING_FEES_PATH": OPERATIONS_CONSOLE,
  // P5 block: brand theming. The colour the app is painted in is read by
  // the shell itself; changing it is the console's alone.
  "api/http/brand-theme.ts GET BRAND_THEME_PATH": exempt(
    "the app shell's own paint (the brand colour in effect for the tenant), read on every page; not a person's action",
  ),
  "api/http/brand-theme.ts GET ADMIN_BRAND_THEME_PATH": OPERATIONS_CONSOLE,
  "api/http/brand-theme.ts POST ADMIN_BRAND_THEME_PATH": OPERATIONS_CONSOLE,
  // end P5 block
  // ETIQUETTE block (ADR 0050). Saving and removing their own guide are
  // declared app actions (set_my_speaking_guide, remove_my_speaking_guide).
  "api/http/etiquette.ts GET ME_ETIQUETTE_GUIDE_PATH": exempt(
    "the person reading their own speaking guide and which house guide applies, in Settings; Q already follows it whenever it speaks for them",
  ),
  "api/http/etiquette.ts GET ADMIN_ETIQUETTE_GUIDE_PATH": OPERATIONS_CONSOLE,
  "api/http/etiquette.ts POST ADMIN_ETIQUETTE_GUIDE_PATH": OPERATIONS_CONSOLE,
  "api/http/etiquette.ts POST ADMIN_ETIQUETTE_GUIDE_ACTIVE_PATH":
    OPERATIONS_CONSOLE,
  // end ETIQUETTE block
  // Platform model cost per tenant and person: the operators' console.
  "api/http/admin-billing.ts GET ADMIN_BILLING_USAGE_PATH": OPERATIONS_CONSOLE,
  "api/http/admin-billing.ts GET ADMIN_BILLING_FEES_EXPORT_PATH":
    OPERATIONS_CONSOLE,
  "api/http/admin-billing.ts POST ADMIN_BILLING_FEES_ACCRUE_PATH":
    OPERATIONS_CONSOLE,
  "api/http/admin-billing.ts POST ADMIN_BILLING_FEE_RATE_PATH":
    OPERATIONS_CONSOLE,
  // end BILLING block
  "api/http/admin.ts GET ADMIN_ME_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts POST ADMIN_STEP_UP_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_ACCOUNTS_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_ACCOUNT_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts POST ADMIN_ACCOUNT_SUSPENSION_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_ORGANISATIONS_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_ORGANISATION_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts POST ADMIN_ORGANISATION_SUSPENSION_PATH":
    OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_VERIFICATION_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts POST ADMIN_VERIFICATION_DECISION_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_SAFETY_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts POST ADMIN_SAFETY_REVIEW_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_BREAK_GLASS_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts POST ADMIN_BREAK_GLASS_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts POST ADMIN_BREAK_GLASS_DECISION_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_BREAK_GLASS_CHAT_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_Q_MONITOR_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_Q_ERRORS_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_Q_RUN_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_AUDIT_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_FLAGS_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts POST ADMIN_FLAG_PATH": OPERATIONS_CONSOLE,
  // P14: claims on unclaimed companies, and public company profiles.
  "api/http/admin.ts GET ADMIN_COMPANY_CLAIMS_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts POST ADMIN_COMPANY_CLAIM_DECISION_PATH":
    OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_COMPANY_CLAIM_EVIDENCE_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts POST ADMIN_COMPANY_PUBLISH_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_EMAIL_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_TEAM_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts POST ADMIN_TEAM_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts DELETE ADMIN_TEAM_MEMBER_PATH": OPERATIONS_CONSOLE,
  "api/http/results.ts GET RESULTS_PATH": cap("tool.get_my_results"),
  "api/http/results.ts GET RESULTS_REPORT_PATH": cap(
    "tool.get_my_results_report",
  ),
  // end ADMIN block

  // ADMIN-3 block
  "api/http/admin.ts GET ADMIN_REVIEWS_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts POST ADMIN_REVIEW_DECISION_PATH": OPERATIONS_CONSOLE,
  "api/http/admin.ts GET ADMIN_KYB_DOCUMENT_PATH": OPERATIONS_CONSOLE,
  "api/http/reviews-kyb.ts GET REVIEWS_PATH": exempt(
    "the person's own review cases, read on their Reviews page; Q's side is propose_human_review",
  ),
  "api/http/reviews-kyb.ts GET KYB_PATH": exempt(
    "the organisation's own KYB submission, read on the Verification page",
  ),
  // end ADMIN-3 block

  // Spec 6.6.14: money is stated and confirmed by a person on each side;
  // Q never states, confirms or withdraws a commitment on anyone's behalf.
  "api/http/commitments.ts GET NETWORK_RELATIONSHIP_COMMITMENTS_PATH": exempt(
    "a party reading its relationship's commitment, shown on the relationship itself",
  ),
  "api/http/commitments.ts POST NETWORK_RELATIONSHIP_COMMITMENTS_PATH": exempt(
    "money is recorded by a person on one side (spec 6.6.14); never a Q action",
  ),
  "api/http/commitments.ts POST NETWORK_COMMITMENT_CONFIRM_PATH": exempt(
    "consequential financial facts need human confirmation by the other side (spec 6.6.14); never a Q action",
  ),
  "api/http/commitments.ts POST NETWORK_COMMITMENT_ADOPT_PATH": exempt(
    "a party adopting money Q heard in a call as their own statement (spec 6.6.14); never a Q action",
  ),
  "api/http/commitments.ts POST NETWORK_COMMITMENT_DISPUTE_PATH": exempt(
    "a party disputing money Q heard in a call; their own judgement, never a Q action",
  ),
  "api/http/commitments.ts POST NETWORK_COMMITMENT_WITHDRAW_PATH": exempt(
    "a party withdrawing its relationship's commitment is their own decision; never a Q action",
  ),
  // 2026-10-04: the Capital page's book, read by read_my("capital").
  "api/http/commitments.ts GET COMPANY_CAPITAL_LEDGER_PATH":
    cap("tool.read_my"),
  // P8: a round's correction history, read with the same capital capability.
  "api/http/commitments.ts GET COMPANY_CAPITAL_ROUND_HISTORY_PATH":
    cap("tool.read_my"),
  "api/http/commitments.ts GET NETWORK_MY_COMMITMENTS_PATH":
    cap("tool.read_my"),
  "api/http/commitments.ts GET NETWORK_COMPANY_FUNDRAISING_PATH": exempt(
    "the founder's raise in money, shown on Capital; a Q read tool comes later",
  ),

  "api/http/integrations.ts GET GOOGLE_INTEGRATION_PATH": cap(
    "offer.gmail_connect",
  ),
  "api/http/integrations.ts GET GOOGLE_OAUTH_CALLBACK_PATH": WEBHOOK,
  "api/http/integrations.ts GET GOOGLE_RELATIONSHIP_MAIL_PATH": cap(
    "tool.read_relationship_email",
  ),
  "api/http/integrations.ts POST GOOGLE_GMAIL_PUSH_PATH": WEBHOOK,
  // Inbound email: Postmark's delivery, and the person's own Q address
  // (list_my_inbound_emails names it; a new one is offered in Settings).
  "api/http/inbound-email.ts POST INBOUND_EMAIL_POSTMARK_PATH": WEBHOOK,
  "api/http/inbound-email.ts GET INBOUND_EMAIL_ADDRESS_PATH": cap(
    "tool.list_my_inbound_emails",
  ),

  "api/http/investor-mandates.ts GET base": cap("tool.get_investor_mandate"),
  "api/http/investor-mandates.ts GET byId": cap("tool.get_investor_mandate"),

  "api/http/investors.ts POST INVESTORS_PATH": ONBOARDING_SETUP,
  "api/http/investors.ts GET INVESTORS_CURRENT_PATH": cap(
    "tool.read_my_record",
  ),
  "api/http/investors.ts GET byId": cap("tool.read_my_record"),
  "api/http/investors.ts GET `${byId}${INVESTOR_NETWORK_PREVIEW_SEGMENT}`": cap(
    "tool.read_my_record",
  ),
  "api/http/investors.ts GET `${byId}${INVESTOR_REPRESENTATIVE_ME_SUFFIX}`":
    cap("tool.read_my_record"),

  "api/http/me.ts GET ME_PROFILE_PATH": exempt(
    "the person's own profile is in every Q run's context already (CQ-QX-007)",
  ),
  "api/http/me.ts GET ME_PATH": exempt(
    "the app shell's session read; Q already acts as the signed-in person",
  ),

  "api/http/media-webhooks.ts POST CLOUDFLARE_STREAM_WEBHOOK_PATH": WEBHOOK,
  "api/http/profile-images.ts GET subjectPath": cap(
    "offer.profile_photo_upload",
  ),
  "api/http/media.ts GET pitch": cap("tool.get_pitch_moment"),
  "api/http/media.ts GET `${COMPANIES_PATH}/:companyId/media`": cap(
    "tool.get_pitch_moment",
  ),
  "api/http/media.ts POST `${pitch}/:mediaAssetId${MEDIA_SYNC_SUFFIX}`": PLAYER,
  "api/http/media.ts POST `${pitch}/:mediaAssetId${MEDIA_PLAYBACK_SUFFIX}`":
    PLAYER,
  "api/http/media.ts GET `${pitch}/:mediaAssetId${MEDIA_DOWNLOAD_SUFFIX}`":
    PLAYER,
  "api/http/media.ts GET `${pitch}/:mediaAssetId${MEDIA_TRANSCRIPT_SUFFIX}`":
    cap("tool.get_pitch_moment"),
  "api/http/media.ts GET `${pitch}/:mediaAssetId${MEDIA_CAPTIONS_VTT_SUFFIX}`":
    PLAYER,

  "api/http/network-interests.ts GET NETWORK_COMPANY_INTEREST_PATH": cap(
    "tool.get_relationship",
  ),
  "api/http/network-interests.ts GET NETWORK_COMPANY_RELATIONSHIP_PATH": cap(
    "tool.get_relationship",
  ),
  "api/http/network-interests.ts GET NETWORK_INVESTOR_RELATIONSHIP_PATH": cap(
    "tool.get_relationship",
  ),
  "api/http/network-interests.ts GET NETWORK_INVESTOR_RELATIONSHIPS_PATH": cap(
    "navigate.RELATIONSHIPS",
  ),
  "api/http/network-interests.ts GET NETWORK_COMPANY_RELATIONSHIPS_PATH": cap(
    "navigate.RELATIONSHIPS",
  ),
  // Post-meeting outcomes (2026-10-02): the Pass dialog's reason list is
  // reference data; the current pass is read on the relationship page.
  "api/http/network-interests.ts GET NETWORK_PASS_REASONS_PATH": REFERENCE,
  // Diligence (2026-10-02): the area Q acts in through diligence_documents;
  // a download is the person's own browser fetching a signed URL.
  "api/http/network-interests.ts GET NETWORK_RELATIONSHIP_DILIGENCE_PATH": cap(
    "tool.diligence_documents",
  ),
  "api/http/network-interests.ts GET NETWORK_DILIGENCE_DOWNLOAD_PATH": cap(
    "navigate.RELATIONSHIPS",
  ),
  "api/http/network-interests.ts GET NETWORK_RELATIONSHIP_PASS_PATH": cap(
    "navigate.RELATIONSHIPS",
  ),
  "api/http/network-interests.ts GET NETWORK_COMPANY_INCOMING_INTEREST_PATH":
    cap("tool.list_incoming_interest"),
  // ADR 0023: founders' Connection Requests and the investor's inbox. The
  // accept/decline loop is the "POST path" entry below.
  "api/http/network-interests.ts GET NETWORK_INVESTOR_CONNECTION_PATH": cap(
    "offer.connection_request",
  ),
  "api/http/network-interests.ts GET NETWORK_CONNECTION_REQUESTS_PATH": cap(
    "offer.connection_request_answer",
  ),

  "api/http/onboarding.ts POST sessions": exempt(
    "an onboarding session starts when the onboarding screen opens; the loop's tools act within it",
  ),
  "api/http/onboarding.ts GET `${sessions}${ONBOARDING_CURRENT_SEGMENT}`": cap(
    "tool.get_onboarding_state",
  ),
  "api/http/onboarding.ts GET byId": cap("tool.get_onboarding_state"),
  // Setup reminders (founder directive 2026-09-27): Home's card claims
  // today's reminder; "Later" / "stop" are Q's own tool too.
  "api/http/onboarding.ts GET `${nudgePath}${ONBOARDING_NUDGE_BRIEFING_SEGMENT}`":
    exempt(
      "Home reads whether today's setup reminder is due; Q is told of the same reminder in its own answer",
    ),
  "api/http/onboarding.ts POST `${nudgePath}${ONBOARDING_NUDGE_BRIEFING_SEGMENT}`":
    exempt(
      "Home's briefing reads today's setup reminder for its card; Q is told of the same reminder in its own answer",
    ),
  "api/http/onboarding.ts POST `${byId}${ONBOARDING_BACK_SEGMENT}`": exempt(
    "the form's Back button (screen position, not a change); in the Q loop the person just says what to revisit",
  ),
  "api/http/onboarding.ts POST `${byId}${ONBOARDING_SAY_SEGMENT}`": Q_TRANSPORT,
  "api/http/onboarding.ts GET `${byId}${ONBOARDING_TURNS_SEGMENT}`":
    Q_TRANSPORT,
  "api/http/onboarding.ts POST `${byId}${ONBOARDING_TURNS_SEGMENT}`":
    Q_TRANSPORT,

  "api/http/organisations.ts POST ORGANISATIONS_PATH": ONBOARDING_SETUP,
  "api/http/organisations.ts GET ORGANISATIONS_PATH": ONBOARDING_SETUP,
  "api/http/organisations.ts GET `${ORGANISATIONS_PATH}/:organisationId`":
    ONBOARDING_SETUP,
  "api/http/organisations.ts PATCH `${ORGANISATIONS_PATH}/:organisationId`":
    ONBOARDING_SETUP,
  "api/http/organisations.ts POST `${ORGANISATIONS_PATH}/:organisationId/activate`":
    ONBOARDING_SETUP,

  // G1/G2: the team's reads (its changes are declared team.* actions).
  "api/http/team.ts GET TEAM_PATH": cap("tool.read_my"),
  "api/http/team.ts GET MY_ORGANISATIONS_PATH": exempt(
    "the switcher's own list of the person's companies and firms; switching is the existing activate route, and Q reads the team itself with read_my(team)",
  ),
  "api/http/team.ts GET INVITATION_PREVIEW_PATH": PUBLIC,

  "api/http/q-cards.ts GET cardPath": cap("tool.get_q_card"),
  "api/http/q-cards.ts GET `${PUBLIC_HANDLES_PATH}/:handle`": PUBLIC,
  "api/http/q-cards.ts GET `${PUBLIC_CARD_CODES_PATH}/:code`": PUBLIC,

  "api/http/recommendation-interactions.ts POST DISCOVERY_INTERACTIONS_PATH":
    exempt(
      "observations the feed reports (impressions, watch milestones); never an action a person asks for",
    ),
  "api/http/recommendation-interactions.ts GET DISCOVERY_SAVED_PATH": cap(
    "tool.discovery_slate",
  ),
  // Founder report 2026-10-02: the Passed list and Undo pass (doc 19 §68).
  // Not yet a Q destination or tool: the turn reader's destinations are
  // HARDEN's (v24); Q's own list_my_relationships already reads passes.
  "api/http/recommendation-interactions.ts GET DISCOVERY_PASSED_PATH": exempt(
    "the Passed screen's own list; Q reads passes through its relationship tools, a Q destination waits for a turn-reader version",
  ),

  "api/http/taxonomy.ts POST `${TAXONOMY_PATH}${TAXONOMY_CANDIDATES_SEGMENT}`":
    REFERENCE,
  "api/http/taxonomy.ts GET vocabularies": REFERENCE,
  "api/http/taxonomy.ts GET `${vocabularies}/:vocabularyCode${TAXONOMY_NODES_SEGMENT}`":
    REFERENCE,
  "api/http/taxonomy.ts GET `${TAXONOMY_PATH}${TAXONOMY_NODES_SEGMENT}/:nodeId`":
    REFERENCE,

  "api/http/verification.ts GET `${base}${COMPANY_VERIFICATION_SEGMENT}`": cap(
    "tool.read_my_record",
  ),

  "api/http/visibility.ts GET COMPANY_VISIBILITY_STATE_PATH": cap(
    "tool.get_disclosure_state",
  ),
  "api/http/visibility.ts GET COMPANY_AUDIENCE_PREVIEW_PATH": cap(
    "tool.read_my_record",
  ),

  // ---- apps/q-api -------------------------------------------------------
  'q-api/app.ts GET "/health/live"': HEALTH,
  'q-api/app.ts GET "/health/ready"': HEALTH,
  "q-api/http/errands.ts GET Q_RELATIONSHIP_ERRANDS_PATH": exempt(
    "the person reading their own errands on a relationship, shown on the relationship itself",
  ),
  // AUTO (ADR 0030): the "Q is working on" panel's own controls.
  "q-api/http/work.ts GET Q_WORK_PATH": cap("tool.list_q_work"),
  // Lead 2026-10-03: what Q used for them; Q opens it (navigate USAGE).
  "q-api/http/usage.ts GET Q_USAGE_PATH": cap("navigate.USAGE"),
  "q-api/http/work.ts GET Q_WORK_ITEM_PATH": cap("tool.list_q_work"),
  "q-api/http/work.ts DELETE Q_WORK_ITEM_PATH": cap("tool.stop_q_work"),
  "q-api/http/work.ts DELETE Q_WORK_LANE_PATH": cap("tool.stop_q_work"),
  "q-api/http/work.ts POST Q_WORK_LANE_ANSWER_PATH": cap("tool.answer_q_work"),
  "q-api/http/work.ts GET Q_WORK_LANE_REPORT_PATH": DOWNLOAD,
  // WORKFORCE (founder brief J5): the workforce page's record of Q's agents.
  "q-api/http/workforce.ts GET Q_WORKFORCE_JOBS_PATH": exempt(
    "the workforce page's audit-style record of Q's own agents (jobs, runs, grades); Q reports the same work in conversation through list_q_work",
  ),
  "q-api/http/workforce.ts GET Q_WORKFORCE_OVERVIEW_PATH": exempt(
    "the workforce page's team and month spend against the person's limit; Q reports its usage in conversation through its usage tools",
  ),
  "q-api/http/briefing-command.ts POST Q_BRIEFING_COMMAND_PATH": exempt(
    "the arrival briefing's reading of the person's own words into card verbs for their own screen; it changes nothing (the card sequence runs and checks each verb), so it is the Q conversation's transport, not an action",
  ),
  "q-api/http/workforce.ts POST Q_WORKFORCE_DRAFT_RETRY_PATH": exempt(
    "a held card's own 'Ask Q to try again' (button, or the person's words read into the card's typed verb in the arrival briefing); it only rewrites and offers an approval card, which the Approval Engine decides",
  ),
  "q-api/http/workforce.ts GET Q_WORKFORCE_JOB_PATH": exempt(
    "one job's agent record (runs, hand-offs, drafts, grades, timeline) for the workforce page; Q reports its work through list_q_work",
  ),
  "q-api/http/work.ts PUT Q_PRESENCE_PATH": cap("tool.set_away"),
  // WORK-58: Q's work page.
  "q-api/http/work.ts GET Q_WORK_SUGGESTIONS_PATH": cap("navigate.WORK"),
  "q-api/http/work.ts GET Q_WORK_DONE_PATH": cap("tool.list_q_work"),
  "q-api/http/work.ts GET Q_WORK_SINCE_PATH": cap("tool.list_q_work"),
  "q-api/http/errands.ts DELETE Q_ERRAND_PATH": cap("tool.stop_q_work"),
  // DAILY block: The Q Daily.
  "q-api/http/daily.ts GET Q_DAILY_PATH": cap("tool.get_q_daily"),
  "q-api/http/daily.ts GET Q_DAILY_EDITION_PATH": cap("tool.get_q_daily"),
  "q-api/http/daily.ts GET Q_DAILY_EDITION_PDF_PATH": DOWNLOAD,
  "q-api/http/daily.ts GET Q_DAILY_PREFERENCES_PATH": cap("tool.get_q_daily"),
  "q-api/http/daily.ts PUT Q_DAILY_PREFERENCES_PATH": cap(
    "tool.set_q_daily_preferences",
  ),
  "q-api/http/daily.ts POST Q_DAILY_REQUESTS_PATH": cap("tool.request_q_daily"),
  "q-api/http/standing.ts GET Q_STANDING_PATH": exempt(
    "the person reading their own Q personality and whether their account is paused; shown in Settings and on arrival",
  ),
  "q-api/http/standing.ts PUT Q_STANDING_PERSONALITY_PATH": cap(
    "tool.set_q_personality",
  ),
  // BILLING-2 block (ADR 0036)
  "q-api/http/readiness-blueprint.ts POST Q_READINESS_BLUEPRINTS_PATH": exempt(
    "the plan-gated Readiness Blueprint (Pro), built by code from the free diagnosis Q already reads with read_my plan; the sequencing is the page's, the steps are Q's read",
  ),
  // Q.03/Q.04/Q.01: the founder's own readiness, plan and questions.
  "api/http/readiness.ts GET READINESS_PATH": cap("tool.read_my"),
  // end BILLING-2 block
  // MEET-HOST (ADR 0037): Recall's live events, signed per meeting.
  "q-api/http/meeting-host.ts POST MEETING_HOST_WEBHOOK_PATH": WEBHOOK,
  "q-api/http/rehearsals.ts POST Q_REHEARSALS_PATH": exempt(
    "the rehearsal screen's own start; Q takes them there with open_page INVESTOR_REHEARSAL, and the rehearsal itself is Q playing the investor",
  ),
  "q-api/http/rehearsals.ts GET Q_INVESTOR_REHEARSALS_PATH": exempt(
    "the founder reading their own past rehearsals, shown on the rehearsal screen",
  ),
  "q-api/http/rehearsals.ts GET Q_REHEARSAL_PATH": exempt(
    "the founder reading their own rehearsal, shown on the rehearsal screen",
  ),
  "q-api/http/rehearsals.ts POST Q_REHEARSAL_TURNS_PATH": exempt(
    "the founder answering the investor Q plays; the turn is already Q",
  ),
  "q-api/http/rehearsals.ts POST Q_REHEARSAL_FINISH_PATH": exempt(
    "the founder ending their rehearsal for Q's coaching; the scoring is already Q",
  ),
  // REHEARSE block
  "q-api/http/rehearsals.ts GET Q_REHEARSALS_PATH": exempt(
    "the person's own rehearsal history, shown on the Rehearsals page Q opens with navigate REHEARSALS",
  ),
  "q-api/http/rehearsals.ts GET Q_REHEARSAL_PARTNERS_PATH": exempt(
    "who the person can rehearse with and their upcoming calls, shown on the Rehearsals page Q opens with navigate REHEARSALS",
  ),
  "q-api/http/rehearsals.ts GET Q_REHEARSAL_PERSONA_PATH": exempt(
    "the lobby's reading of the person Q will play; Q opens the lobby with open_page",
  ),
  "q-api/http/rehearsals.ts GET Q_REHEARSAL_MEETING_PATH": exempt(
    "which person a booked call is with, for the rehearsal suggested when the call was booked",
  ),
  "q-api/http/rehearsals.ts POST Q_REHEARSAL_SCREEN_PATH": exempt(
    "a frame of the screen the person shares in the rehearsal room; only the person can share their screen",
  ),
  // end REHEARSE block
  "q-api/http/meeting-assistant.ts GET Q_MEETING_ASSISTANT_PATH": exempt(
    "the organiser reading whether Q is in their call and its notes; shown on the meeting itself",
  ),
  "q-api/http/meeting-assistant.ts POST Q_MEETING_ASSISTANT_PATH": exempt(
    "the organiser's own click bringing Q to their call: a paid bot joins, so never a Q action without that click",
  ),
  "q-api/http/meeting-assistant.ts DELETE Q_MEETING_ASSISTANT_PATH": exempt(
    "the organiser taking Q back out of their call",
  ),
  "q-api/http/memory.ts GET Q_MEMORY_PATH": exempt(
    "the person's own view of what Q remembers; Q reads memory on every run, not as a tool",
  ),
  "q-api/http/memory.ts POST Q_MEMORY_FORGET_PATH": exempt(
    "the person correcting Q's memory of them; never a Q action",
  ),
  "q-api/http/profile-findings.ts GET Q_PROFILE_FINDINGS_PATH": cap(
    "tool.read_my_record",
  ),
  "q-api/http/q-approvals.ts GET Q_APPROVALS_PATH": cap(
    "tool.list_pending_approvals",
  ),
  "q-api/http/q-approvals.ts GET approvalPath": exempt(
    "one approval's card read; Q reads the same status through its receipts and list_pending_approvals",
  ),
  "q-api/http/q-approvals.ts POST `${approvalPath}${Q_APPROVAL_APPROVE_SUFFIX}`":
    cap("tool.approve_pending_proposal"),
  "q-api/http/q-approvals.ts POST `${approvalPath}${Q_APPROVAL_REJECT_SUFFIX}`":
    cap("tool.decline_pending_proposal"),
  "q-api/http/q-approvals.ts GET `${approvalPath}${Q_APPROVAL_EMAIL_DRAFT_SUFFIX}`":
    cap("tool.propose_email"),
  "q-api/http/q-approvals.ts POST `${approvalPath}${Q_APPROVAL_EMAIL_DRAFT_SUFFIX}`":
    exempt(
      "the person's own edit of a draft's words on its card; asked to Q, Q prepares a new draft (propose_email) for its own approval",
    ),
  "q-api/http/q-artifacts.ts GET Q_ARTIFACTS_PATH": cap(
    "tool.list_my_documents",
  ),
  // voiceq-63: one document as its viewer shows it.
  "q-api/http/q-artifacts.ts GET artifactPath": cap("tool.read_my_document"),
  "q-api/http/q-artifacts.ts GET `${artifactPath}${Q_ARTIFACT_SLIDES_SUFFIX}`":
    DOWNLOAD,
  "q-api/http/q-artifacts.ts GET `${artifactPath}${Q_ARTIFACT_EXPORT_SUFFIX}/:format`":
    DOWNLOAD,
  "q-api/http/q-artifacts.ts GET `${artifactPath}${Q_ARTIFACT_VERSIONS_SUFFIX}/:version`":
    DOWNLOAD,
  // Q room W5 (R8): the room's own progress line while Q makes a document;
  // Q hears the same stages on its own run (the silence ladder).
  "q-api/http/q-artifacts.ts GET `${artifactPath}${Q_ARTIFACT_PROGRESS_SUFFIX}`":
    cap("tool.read_my_document"),
  // The drop target writes the same edit as edit_my_document USE_PICTURE.
  "q-api/http/q-artifacts.ts POST `${artifactPath}${Q_ARTIFACT_PLACEHOLDERS_SUFFIX}`":
    cap("tool.edit_my_document"),
  // DOCS block: the document studio.
  "q-api/http/q-documents.ts GET Q_BRAND_KIT_PATH": cap("tool.get_brand_kit"),
  "q-api/http/q-documents.ts POST Q_BRAND_KIT_PATH": cap("offer.confirm_brand"),
  "q-api/http/q-documents.ts POST `${Q_BRAND_KIT_PATH}${Q_BRAND_KIT_SUGGEST_SUFFIX}`":
    cap("tool.suggest_brand_kit"),
  "q-api/http/q-documents.ts POST `${Q_BRAND_KIT_PATH}${Q_BRAND_KIT_CONFIRM_SUFFIX}`":
    cap("offer.confirm_brand"),
  "q-api/http/q-documents.ts GET `${Q_BRAND_KIT_PATH}${Q_BRAND_KIT_LOGO_SUFFIX}`":
    DOWNLOAD,
  "q-api/http/q-documents.ts POST Q_ANSWER_EXPORTS_PATH": cap(
    "document.ANSWER_EXPORT",
  ),
  "q-api/http/q-conversations.ts GET Q_CONVERSATIONS_PATH": Q_TRANSPORT,
  "q-api/http/q-conversations.ts GET conversationPath": Q_TRANSPORT,
  "q-api/http/q-conversations.ts POST `${conversationPath}${Q_CONVERSATION_ARCHIVE_SUFFIX}`":
    exempt(
      "a conversation is ended from the chats list; Q never ends or clears its own conversation (conversation receipts rule)",
    ),
  "q-api/http/q-conversations.ts POST `${conversationPath}/messages/:messageId${Q_CONVERSATION_MESSAGE_HIDE_SUFFIX}`":
    exempt(
      "the person hides one of their own lines from Q in the conversation view; Q does not decide what it may read back (founder live 2026-10-01)",
    ),
  "q-api/http/q-events.ts GET eventsPath": Q_TRANSPORT,
  "q-api/http/q-mcp.ts POST Q_MCP_PATH": exempt(
    "the MCP connector surface: an external client calling Q's tools, not a person's action",
  ),
  "q-api/http/q-runs.ts POST Q_RUNS_PATH": Q_TRANSPORT,
  "q-api/http/q-runs.ts GET runPath": Q_TRANSPORT,
  "q-api/http/q-runs.ts POST `${runPath}${Q_RUN_MESSAGES_SUFFIX}`": Q_TRANSPORT,
  "q-api/http/q-runs.ts POST `${runPath}${Q_RUN_CANCEL_SUFFIX}`": Q_TRANSPORT,
  // MATCH block (ADR 0052): fit with the reader's own mandate.
  "q-api/http/fit.ts GET FIT_COMPANIES_PATH": cap("tool.fit_profile"),
  "q-api/http/fit.ts GET FIT_COMPANY_PATH": cap("tool.fit_profile"),
  "q-api/http/fit.ts GET FIT_Q_VIEW_PATH": cap("tool.fit_profile"),
  "q-api/http/fit.ts GET FIT_TOP_PATH": cap("tool.fit_top_candidates"),
  "q-api/http/recommendation-explanations.ts GET DISCOVERY_EXPLANATION_PATH":
    cap("tool.recommendation_explanation"),
  "q-api/voice/interview-route.ts POST dependencies.path": Q_TRANSPORT,
  "q-api/voice/routes.ts GET Q_VOICE_TURN_PATH": Q_TRANSPORT,
  "q-api/voice/routes.ts POST Q_VOICE_SCREEN_PATH": Q_TRANSPORT,
  "q-api/voice/routes.ts POST Q_VOICE_SPEECH_PATH": Q_TRANSPORT,
  "q-api/voice/routes.ts POST Q_VOICE_SPEAK_RELAY_PATH": Q_TRANSPORT,
  "q-api/voice/routes.ts POST Q_VOICE_SESSIONS_PATH": Q_TRANSPORT,
  // DUPLEX: the full-duplex line's tool relay, usage report and end.
  "q-api/voice/duplex/routes.ts POST Q_VOICE_DUPLEX_TOOL_PATH": Q_TRANSPORT,
  "q-api/voice/duplex/routes.ts POST Q_VOICE_DUPLEX_USAGE_PATH": Q_TRANSPORT,
  "q-api/voice/duplex/routes.ts POST Q_VOICE_DUPLEX_END_PATH": Q_TRANSPORT,
  // I1 (2026-10-05): a dropped line rejoins on a fresh call, same voice.
  "q-api/voice/duplex/routes.ts POST Q_VOICE_DUPLEX_REJOIN_PATH": Q_TRANSPORT,
  // Q room R7: the line's waiting lines (silence ladder), read by its owner.
  "q-api/voice/duplex/routes.ts POST Q_VOICE_DUPLEX_NARRATION_PATH":
    Q_TRANSPORT,
  "q-api/voice/think.ts POST dependencies.path": Q_TRANSPORT,
  "q-api/voice/think.ts POST `${dependencies.path}/chat/completions`":
    Q_TRANSPORT,
};

/** Every web page (app/**\/page.tsx), by route. */
const PAGE_COVERAGE: Readonly<Record<string, Coverage>> = {
  "/": exempt("the signed-out landing page"),
  "/auth/check-email": exempt("signed-out authentication"),
  "/auth/forgot-password": exempt("signed-out authentication"),
  "/auth/sign-in": exempt("signed-out authentication"),
  "/auth/sign-up": exempt("signed-out authentication"),
  "/auth/update-password": exempt(
    "password entry in the auth provider's own flow; a password never passes through Q",
  ),
  "/dev/q-presence": exempt("development-only page"),
  "/dev/ui": exempt("development-only page"),
  "/dev/daily": exempt("development-only page"),
  "/dev/profile": exempt(
    "development-only page (design review, fictional data)",
  ),
  "/dev/presence": exempt("development-only page"),
  "/dev/work": exempt("development-only page"),
  "/dev/briefing": exempt("development-only page"),
  "/dev/q-nav": exempt("development-only page"),
  "/dev/q-nav/work": exempt("development-only page"),
  "/dev/workforce": exempt("development-only page"),
  "/dev/gateq-v2": exempt("development-only page"),
  "/dev/canvas": exempt("development-only page"),
  "/dev/founder-docs": exempt("development-only page"),
  "/dev/relationships": exempt("development-only page"),
  "/dev/brand-preview": exempt("development-only page"),
  "/dev/q-cards": exempt("development-only page"),
  "/dev/q-room": exempt("development-only page"),
  "/dev/results": exempt("development-only page"),
  "/dev/rehearsals": exempt("development-only page"),
  "/dev/gateq": exempt("development-only page"),
  "/dev/match": exempt("development-only page"),
  "/dev/team": exempt("development-only page"),
  "/u/[handle]": PUBLIC,
  // GateQ: a gateway's public page and the embed another site frames.
  "/g/[publicId]": PUBLIC,
  "/g/[publicId]/embed": PUBLIC,
  // ADMIN block
  "/admin/accounts": OPERATIONS_CONSOLE,
  "/admin/brand": OPERATIONS_CONSOLE,
  "/admin/etiquette": OPERATIONS_CONSOLE,
  "/admin/accounts/[userId]": OPERATIONS_CONSOLE,
  "/admin/organisations": OPERATIONS_CONSOLE,
  "/admin/organisations/[organisationId]": OPERATIONS_CONSOLE,
  "/admin/queue": OPERATIONS_CONSOLE,
  "/admin/verification": OPERATIONS_CONSOLE,
  "/admin/safety": OPERATIONS_CONSOLE,
  "/admin/safety/break-glass/[requestId]": OPERATIONS_CONSOLE,
  "/admin/q": OPERATIONS_CONSOLE,
  "/admin/q/runs/[runId]": OPERATIONS_CONSOLE,
  "/admin/audit": OPERATIONS_CONSOLE,
  "/admin/flags": OPERATIONS_CONSOLE,
  "/admin/claims": OPERATIONS_CONSOLE,
  "/admin/billing": OPERATIONS_CONSOLE,
  "/admin/email": OPERATIONS_CONSOLE,
  "/admin/team": OPERATIONS_CONSOLE,
  "/results": cap("navigate.RESULTS"),
  // ADMIN-3 block
  "/admin/reviews": OPERATIONS_CONSOLE,
  "/reviews": cap("tool.propose_human_review"),
  // end ADMIN-3 block
  // end ADMIN block
  "/admin": exempt(
    "Capital Q's admin console: platform operators only, never a place Q sends anyone",
  ),
  "/gateway": cap("navigate.GATEWAY"),
  // F2: GateQ's own page; /gateway now redirects to its "Your gate" tab.
  "/gateq": cap("navigate.GATEWAY"),
  "/onboarding/founder": exempt(
    "the founder interview: Q's own onboarding loop (voice INTERVIEW_FOUNDER)",
  ),
  "/onboarding/investor": exempt(
    "the investor interview: Q's own onboarding loop (voice INTERVIEW_INVESTOR)",
  ),
  "/welcome": exempt("the first-run welcome shown once after sign-up"),
  "/paused": exempt(
    "what an account Q paused sees until an operator reinstates it; nothing to do there",
  ),
  "/connected/google": exempt(
    "where Google returns the connect window: it tells the room how it went and closes (Q offers the connect card)",
  ),
  "/home": cap("navigate.HOME"),
  "/profile": cap("navigate.PROFILE"),
  "/capital": cap("navigate.CAPITAL"),
  "/discover": cap("navigate.DISCOVER"),
  "/explore": cap("navigate.DISCOVER"),
  "/dev/explore": exempt("development-only page"),
  "/discover/saved": cap("navigate.SAVED"),
  // Your companies (2026-10-02): reached from Discover's row.
  "/discover/yours": cap("navigate.DISCOVER"),
  "/discover/passed": exempt(
    "the Passed list (doc 19 §68): its one action, Undo pass, is unpass_company by name from any page; opening the list itself needs a navigate destination in the turn reader, whose versions HARDEN owns",
  ),
  "/company/visibility": cap("navigate.COMPANY_VISIBILITY"),
  "/company/interest": cap("navigate.COMPANY_INTEREST"),
  "/relationships": cap("navigate.RELATIONSHIPS"),
  "/settings": cap("navigate.SETTINGS"),
  "/settings/plan": cap("tool.get_my_plan"),
  // AUTO (ADR 0030): Q's work; Q reads the same with list_q_work.
  "/work": cap("navigate.WORK"),
  "/work/[delegationId]": cap("tool.list_q_work"),
  "/work/[delegationId]/report/[laneId]": DOWNLOAD,
  // DOCS: their documents and brand kit.
  "/documents": cap("navigate.DOCUMENTS"),
  // DAILY block: The Q Daily (navigate.DAILY; an edition via get_q_daily).
  "/daily": cap("navigate.DAILY"),
  "/daily/[editionId]": cap("tool.get_q_daily"),
  "/settings/team": cap("tool.read_my"),
  "/join/[token]": cap("offer.team_join"),
  "/settings/memory": cap("navigate.MEMORY"),
  "/settings/usage": cap("navigate.USAGE"),
  "/settings/billing": cap("tool.get_my_plan"),
  // meetfix-57: the reconnect link in Q's answers and notices; it only
  // redirects to Settings (navigate.SETTINGS), where Q already takes them.
  "/settings/reconnect/google": cap("navigate.SETTINGS"),
  "/verification": cap("navigate.VERIFICATION"),
  "/pitch": cap("navigate.PITCH"),
  // One video's page and a new video's, both opened from Pitch & media (ADR 0022).
  "/pitch/new": cap("navigate.PITCH"),
  // ADR 0023: investors for a founder, founders' requests for an investor.
  "/investors": cap("offer.connection_request"),
  "/investors/top": cap("tool.fit_top_candidates"),
  // Q.10: 2-4 picked from Saved, side by side.
  "/discover/saved/compare": cap("tool.fit_compare"),
  // Founder design 2026-09-28: a Q Card by its whole @handle.
  "/find": exempt("the old address of Search; it only redirects"),
  "/search": exempt(
    "search by @handle and founders' videos; the People tab opens public Q Cards and Q links them directly",
  ),
  "/investors/[investorOrganisationId]": cap("offer.connection_request"),
  "/investors/[investorOrganisationId]/rehearse": exempt(
    "the old address of a founder's rehearsal with an investor; it only redirects",
  ),
  // REHEARSE block
  "/rehearsals": cap("navigate.REHEARSALS"),
  "/rehearsals/investor/[investorOrganisationId]": cap("tool.open_page"),
  "/rehearsals/company/[companyId]": cap("tool.open_page"),
  "/rehearsals/meeting/[meetingId]": exempt(
    "the rehearsal suggested when a call was booked; it resolves to the lobby Q opens with open_page",
  ),
  "/rehearsals/r/[rehearsalId]": exempt(
    "the person's own review of one rehearsal, reached from the room and Rehearsals",
  ),
  // end REHEARSE block
  "/pitch/[mediaAssetId]": cap("navigate.PITCH"),
  "/company/[companyId]": cap("tool.open_page"),
  // Overnight A7: a founder as a person, from the Team tab.
  "/company/[companyId]/founder/[position]": cap("tool.open_page"),
  "/relationships/company/[companyId]": cap("tool.open_page"),
  "/relationships/investor/[investorOrganisationId]": cap("tool.open_page"),
  "/relationships/company/[companyId]/messages": cap("tool.open_page"),
  "/relationships/investor/[investorOrganisationId]/messages":
    cap("tool.open_page"),
  // 2026-10-04: a relationship's Diligence and Calls tabs, reached from the
  // relationship page Q opens; Q shares and asks through diligence_documents
  // and books through the schedule tools.
  "/relationships/company/[companyId]/diligence": cap("tool.open_page"),
  "/relationships/investor/[investorOrganisationId]/diligence":
    cap("tool.open_page"),
  "/relationships/company/[companyId]/calls": cap("tool.open_page"),
  "/relationships/investor/[investorOrganisationId]/calls":
    cap("tool.open_page"),
};

const APPS = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function files(dir: string, suffix: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, suffix);
    return name.endsWith(suffix) ? [path] : [];
  });
}

const ROUTE_CALL =
  /\b(?:app|server|instance|fastify|scope)\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*([`'"][^`'"]+[`'"]|[A-Za-z_$][\w$.]*)/g;

/** Every route call site in the two services' HTTP sources. */
function routeKeys(): string[] {
  const keys: string[] = [];
  for (const [app, dirs] of [
    ["api", ["src/app.ts", "src/http"]],
    ["q-api", ["src/app.ts", "src/http", "src/voice"]],
  ] as const) {
    const root = join(APPS, app);
    for (const dir of dirs) {
      const path = join(root, dir);
      const sources = dir.endsWith(".ts") ? [path] : files(path, ".ts");
      for (const source of sources) {
        const text = readFileSync(source, "utf8");
        const file = relative(join(root, "src"), source).split("\\").join("/");
        for (const match of text.matchAll(ROUTE_CALL)) {
          const [, method, path] = match;
          if (method === undefined || path === undefined) continue;
          // `headers.get("content-type")` and the like are not routes.
          if (/^["']/.test(path) && !path.slice(1).startsWith("/")) continue;
          keys.push(`${app}/${file} ${method.toUpperCase()} ${path}`);
        }
      }
    }
  }
  return keys;
}

function pageRoutes(): string[] {
  const appDir = join(APPS, "web", "app");
  return files(appDir, "page.tsx").map((page) => {
    const route = relative(appDir, dirname(page))
      .split("\\")
      .join("/")
      .split("/")
      .filter((segment) => !/^\(.*\)$/.test(segment) && segment !== "")
      .join("/");
    return `/${route}`;
  });
}

const CAPABILITY_IDS = new Set(Q_CAPABILITIES.map((c) => c.id));

/**
 * ADR 0040: hand-written mutation routes may only shrink. A new action is
 * declared once in @capital-q/app-actions, which generates its route and
 * its Q tool; this count is the legacy that has not migrated yet.
 */
// P5 (2026-10-05): 92 counted the operations console's 15 writes, which
// ADR 0040 keeps exempt; they are now excluded by classification instead.
const LEGACY_MUTATION_ROUTES_MAX = 77;

/**
 * Q room W5 (R8): a picture dropped on a document's placeholder in the Q
 * room. The artifact context lives in q-api, where the action registry's
 * generated routes (apps/api) cannot reach it; the drop writes exactly the
 * edit `edit_my_document` USE_PICTURE writes (same instruction, so they
 * replay each other), so Q and the page already have one capability.
 * Named here rather than lifting the legacy ceiling; pending the lead's
 * decision on declaring q-api artifact actions in the registry.
 */
const Q_ROOM_DOCUMENT_DROPS: ReadonlySet<string> = new Set([
  "q-api/http/q-artifacts.ts POST `${artifactPath}${Q_ARTIFACT_PLACEHOLDERS_SUFFIX}`",
]);

/**
 * DUPLEX (flag CQ_VOICE_REALTIME): the full-duplex line's own transport —
 * a relay of the model's tool calls into the Tool Registry, its usage
 * reports for the spend cap, and its end. Q transport, exempt under ADR
 * 0040 ("Exempt routes stay exempt ... Q transport"); not a person's
 * action, so never declarable as one. Named here one by one rather than
 * lifting the legacy ceiling; pending the lead's decision.
 */
/**
 * F1 (2026-10-06): the GateQ form's two writes. Both are authorised by an
 * applicant's guest credential that exists only in the founder's browser
 * memory (the embed is a third-party frame): no actor holds it, so neither
 * Q nor a declared action can ever carry it. Named one by one rather than
 * lifting the legacy ceiling; pending the lead's decision.
 */
const GATEQ_GUEST_NOT_ACTIONS: ReadonlySet<string> = new Set([
  "api/http/gateq-apply.ts POST GATEQ_APPLY_ANSWERS_PATH",
  "api/http/gateq.ts POST GATEQ_APPLY_MATERIALS_PATH",
  // P14: authorised by a one-time code only the claimant's inbox holds; no
  // actor carries it, so no declared action can. Pending the lead's decision.
  "api/http/gateq.ts POST COMPANY_CLAIM_CONFIRM_PATH",
]);

const Q_TRANSPORT_NOT_ACTIONS: ReadonlySet<string> = new Set([
  "q-api/voice/duplex/routes.ts POST Q_VOICE_DUPLEX_TOOL_PATH",
  "q-api/voice/duplex/routes.ts POST Q_VOICE_DUPLEX_USAGE_PATH",
  "q-api/voice/duplex/routes.ts POST Q_VOICE_DUPLEX_END_PATH",
  "q-api/voice/duplex/routes.ts POST Q_VOICE_DUPLEX_REJOIN_PATH",
  "q-api/voice/duplex/routes.ts POST Q_VOICE_DUPLEX_NARRATION_PATH",
]);

/**
 * Zino 2026-10-08: "Ask Q to try again" on a held message. The rewrite
 * runs inside the instruction engine and the reviewer, which live in
 * q-api, where the registry's generated routes (apps/api) cannot reach
 * them; it changes nothing outward (a pass becomes an approval card the
 * Approval Engine decides). Named here rather than lifting the legacy
 * ceiling; pending the lead's decision on declaring q-api actions.
 */
const HELD_RETRY: ReadonlySet<string> = new Set([
  "q-api/http/workforce.ts POST Q_WORKFORCE_DRAFT_RETRY_PATH",
  // A POST that only reads the person's words into verbs; changes nothing.
  "q-api/http/briefing-command.ts POST Q_BRIEFING_COMMAND_PATH",
]);

/** POST routes that only read (a search with a body), mapped to a read tool. */
const READS_BY_POST: ReadonlySet<string> = new Set([
  "api/http/schedule.ts POST RELATIONSHIP_MEETING_SLOTS_PATH",
]);

describe("every route and page is something Q can do, or exempt with a reason (R20/R33)", () => {
  it("every API route call site is classified", () => {
    const keys = routeKeys();
    expect(keys.length).toBeGreaterThan(100);
    expect(keys.filter((key) => ROUTE_COVERAGE[key] === undefined)).toEqual([]);
  });

  it("every classified route still exists", () => {
    const keys = new Set(routeKeys());
    expect(Object.keys(ROUTE_COVERAGE).filter((key) => !keys.has(key))).toEqual(
      [],
    );
  });

  it("every web page is classified, and every classified page exists", () => {
    const pages = pageRoutes();
    expect(pages.filter((page) => PAGE_COVERAGE[page] === undefined)).toEqual(
      [],
    );
    const real = new Set(pages);
    expect(
      Object.keys(PAGE_COVERAGE).filter((page) => !real.has(page)),
    ).toEqual([]);
  });

  it("nothing a person does is left as backlog", () => {
    const backlog = [
      ...Object.entries(ROUTE_COVERAGE),
      ...Object.entries(PAGE_COVERAGE),
    ].filter(
      ([, coverage]) =>
        "exempt" in coverage && /backlog/i.test(coverage.exempt),
    );
    expect(backlog.map(([key]) => key)).toEqual([]);
  });

  it("no new hand-written mutation route: declare it in the app's action registry (ADR 0040)", () => {
    const handWritten = routeKeys().filter(
      (key) =>
        / (POST|PUT|PATCH|DELETE) /.test(key) &&
        !Q_TRANSPORT_NOT_ACTIONS.has(key) &&
        !GATEQ_GUEST_NOT_ACTIONS.has(key) &&
        !Q_ROOM_DOCUMENT_DROPS.has(key) &&
        !HELD_RETRY.has(key) &&
        // ADR 0040: the operations console stays exempt (never Q's to act
        // on), so its writes are not legacy waiting to migrate.
        ROUTE_COVERAGE[key] !== OPERATIONS_CONSOLE,
    );
    expect(
      handWritten.length,
      "declare the new action in @capital-q/app-actions: its route and Q tool are generated",
    ).toBeLessThanOrEqual(LEGACY_MUTATION_ROUTES_MAX);
  });

  it("every declared action is a route and a Q tool, from one declaration (ADR 0040)", () => {
    for (const action of [...APP_ACTIONS, ...PERSON_ACTIONS]) {
      expect(
        CAPABILITY_IDS.has(qCapabilityId(action) ?? ""),
        `${action.name}: no capability for its generated tool`,
      ).toBe(true);
    }
    const paths = APP_ACTIONS.flatMap((action) =>
      action.http === undefined ? [] : [action.http.path],
    );
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("a route that changes something maps to something Q does, never only a read (action parity 2026-10-02)", () => {
    const byId = new Map(Q_CAPABILITIES.map((c) => [c.id, c]));
    const readOnly = Object.entries(ROUTE_COVERAGE).filter(
      ([key, coverage]) => {
        if (!/ (POST|PUT|PATCH|DELETE) /.test(key)) return false;
        if (!("capability" in coverage)) return false;
        if (READS_BY_POST.has(key)) return false;
        const capability = byId.get(coverage.capability);
        // An offer takes them to the control with its reason; a document
        // hand makes the thing. A tool must act (Prepare -> Approve, or the
        // person's own instant action), except the onboarding loop's own.
        return (
          capability !== undefined &&
          capability.performedBy.kind === "TOOL" &&
          !capability.acts &&
          !capability.surfaces.includes("ONBOARDING")
        );
      },
    );
    expect(readOnly.map(([key]) => key)).toEqual([]);
  });

  it("every capability named is in the registry, and every exemption says why", () => {
    for (const [key, coverage] of [
      ...Object.entries(ROUTE_COVERAGE),
      ...Object.entries(PAGE_COVERAGE),
    ]) {
      if ("capability" in coverage) {
        expect(CAPABILITY_IDS.has(coverage.capability), key).toBe(true);
      } else {
        expect(coverage.exempt.length, key).toBeGreaterThan(20);
      }
    }
  });
});
