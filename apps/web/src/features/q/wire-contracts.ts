/**
 * Q room W7: the contracts the browser checks Q's wire against, in one
 * module that is loaded after the first paint (wire.ts), never with it.
 *
 * Every name is imported by name, so the bundler keeps only these schemas
 * (and Zod, which they need) in this module's chunk; a dynamic import of
 * the contracts package itself would bring all of it. The server keeps
 * the full validation; these are the browser's second look, because an
 * answer is data, never authority.
 */
export {
  QClientActionIntentSchema,
  QConversationDetailSchema,
  QDocumentActIntentSchema,
  QManifestRefSchema,
  QPageManifestSchema,
  QSentenceGesturesSchema,
  QShowInQRoomIntentSchema,
  QVoiceDuplexNarrationResultSchema,
  QWebsiteUrlSchema,
  Q_VISIBLE_STAGE_LABELS,
  Q_VOICE_THINKING_BEATS,
  stripSilenceBeats,
} from "@capital-q/contracts";
