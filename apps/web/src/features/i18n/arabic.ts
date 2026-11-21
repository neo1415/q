import { ANSWERS_AR } from "./catalog/answers";
import { BOARD_AR } from "./catalog/board";
import { ADMIN_AR } from "./catalog/admin";
import { ANALYTICS_AR } from "./catalog/analytics";
import { COMPANY_AR } from "./catalog/company";
import { CORE_AR } from "./catalog/core";
import { ACCOUNT_AR } from "./catalog/account";
import { ORGANISATION_AR } from "./catalog/organisation";
import { CRM_DESIGN_AR } from "./catalog/crm-design";
import { CRM_IMPORT_AR } from "./catalog/crm-import";
import { WORK_DESIGN_AR } from "./catalog/work-design";
import { CRM_RECORD_AR } from "./catalog/crm-record";
import { DAILY_AR } from "./catalog/daily";
import { DISCOVER_AR } from "./catalog/discover";
import { DISCOVERY_PAGES_AR } from "./catalog/discovery-pages";
import { DOCUMENTS_AR } from "./catalog/documents";
import { GATEQ_AR } from "./catalog/gateq";
import { LANGUAGE_AR } from "./catalog/language";
import { Q_AR } from "./catalog/q";
import { RELATIONSHIPS_AR } from "./catalog/relationships";
import { SCORES_AR } from "./catalog/scores";
import { SETUP_AR } from "./catalog/setup";
import { SHELL_AR } from "./catalog/shell";
import { SITE_CONTENT_AR } from "./catalog/site-content";
import { SWEEP_AR } from "./catalog/sweep";
import { TAXONOMY_AR } from "./catalog/taxonomy";
import { WORK_AR } from "./catalog/work";
import { WORK_CHOSEN_AR } from "./catalog/work-chosen";

/**
 * Every area's Arabic, merged. An area adds `catalog/<area>.ts` and one
 * line here; the same English string means the same thing everywhere.
 */
export const ARABIC: Readonly<Record<string, string>> = {
  // First: what the live check of 2026-10-16 found; an area's own entry
  // for the same words wins. The Work designs' short words ("Save",
  // "Share") only fill gaps.
  ...WORK_CHOSEN_AR,
  // The work board (2026-10-23): first too, so an area's own word for a
  // shared one ("Add", "Done", "Move") still wins.
  ...BOARD_AR,
  // Organisation roles and activity (2026-10-21): first, so every area's
  // own word for a shared one ("Admin", "Team") still wins.
  ...ORGANISATION_AR,
  // Decision 107: the site content editor; first, so a shared word
  // ("Publish", "History") keeps its area's own Arabic.
  ...SITE_CONTENT_AR,
  // Decision 106: the CRM import; first too, so an area's own word for a
  // shared one ("Import", "Stage") keeps its Arabic.
  ...CRM_IMPORT_AR,
  ...ACCOUNT_AR,
  ...CRM_DESIGN_AR,
  ...DISCOVERY_PAGES_AR,
  ...WORK_DESIGN_AR,
  ...SWEEP_AR,
  ...CORE_AR,
  ...RELATIONSHIPS_AR,
  ...CRM_RECORD_AR,
  ...DOCUMENTS_AR,
  ...GATEQ_AR,
  ...WORK_AR,
  ...DAILY_AR,
  ...ADMIN_AR,
  ...ANALYTICS_AR,
  ...Q_AR,
  ...DISCOVER_AR,
  ...COMPANY_AR,
  ...SETUP_AR,
  ...SHELL_AR,
  ...ANSWERS_AR,
  ...LANGUAGE_AR,
  ...SCORES_AR,
  // Last: a taxonomy name reads the same on every screen (one term for
  // "Series A" everywhere), whatever an area catalogue says.
  ...TAXONOMY_AR,
};
