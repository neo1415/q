/**
 * @capital-q/data-rights
 *
 * Owns: the personal-data inventory, "download my data", and account
 * deletion with anonymisation of what other parties' records keep (owner
 * decision 107; GDPR, UK GDPR and Nigeria's NDPA). Its two request ledgers
 * are identity.data_export_requests and identity.account_deletion_requests.
 *
 * Does not own: the records it reads and erases. It reaches them only
 * through the inventory, by the person's profile id, inside one erasure
 * transaction; each owning context's invariants (append-only history,
 * the keep-an-owner rule, claim and knowledge revisions, the memory
 * lifecycle) are respected or, for the few named append-only tables that
 * hold a person's name in text, passed only in erasure mode.
 */

export {
  DATA_CLASSES,
  FORMER_USER,
  INVENTORY_SCHEMAS,
  KEPT_AFTER_DELETION,
  PERSONAL_DATA_INVENTORY,
  inventoryCounts,
  inventoryEntry,
  type DataClass,
  type ErasurePerson,
  type InventoryEntry,
} from "./inventory.js";
export {
  buildExportArchive,
  collectPersonData,
  EXPORT_LIMITS,
  exportableColumn,
  exportEntries,
  safeFileName,
  type ExportManifest,
} from "./export-builder.js";
export {
  ERASED,
  eraseInDatabase,
  executeAccountDeletion,
  storageObjectsForDeletion,
  type DeletionOutcome,
  type DeletionReport,
} from "./deletion.js";
export {
  organisationsForDeletion,
  type OrganisationForDeletion,
  type OrganisationOutcome,
} from "./organisations.js";
export {
  createDataRightsJobs,
  createDataRightsService,
  dataExportPort,
  DATA_RIGHTS_POLICY,
  type CancelDeletionOutcome,
  type DataRightsJobs,
  type DataRightsOverview,
  type DataRightsService,
  type DeletionStatus,
  type DeletionView,
  type DownloadOutcome,
  type ExportStatus,
  type ExportView,
  type RequestDeletionOutcome,
  type RequestExportOutcome,
  type StepUpProof,
} from "./service.js";
export {
  createSupabaseAuthAccountRemover,
  DATA_EXPORT_BUCKET,
  type AuthAccountRemover,
  type DataRightsLogger,
  type DataRightsObjectRef,
  type DataRightsStorage,
} from "./ports.js";
export { buildZip, type ZipEntry } from "./zip.js";

export const PACKAGE_NAME = "@capital-q/data-rights" as const;
