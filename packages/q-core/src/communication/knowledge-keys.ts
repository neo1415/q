/**
 * The knowledge keys a model may propose for something a person said
 * about their own company.
 *
 * A closed namespace, for the same reason the presence build has one: this
 * is the seam where a sentence in a conversation becomes something Capital
 * Q holds, and a key nobody defined is a category of understanding nobody
 * defined, which the Write Gate has no policy for and no reader can find.
 *
 * It was open, and the consequence is on record. Against a live company
 * the model proposed `user.request`, `user.message` and `user.statement`,
 * and three rows were written whose content was the conversation itself:
 * "What do you want to know?", "This is what I told you to do now.", "He
 * is the president of Nigeria." None of that is a fact about a company,
 * and none of it could ever be read back, because nothing looks under a
 * key the model invented that turn.
 *
 * The namespaces are the ones the company specialist already maps to its
 * dimensions, so a key accepted here is a key some reader can reach.
 */

export const RECORDABLE_KNOWLEDGE_NAMESPACES = [
  "company",
  "business_model",
  "product",
  "market",
  "customer",
  "traction",
  "commercial",
  // Where and how the company runs. Not mapped to a dimension today, and
  // that is fine: the specialist's mapper is explicit that an unmapped key
  // still travels. What matters here is that it is a fact about a company.
  "operations",
  "financial",
  "team",
  "founder",
  "strategy",
  "capital",
] as const;

export type RecordableKnowledgeNamespace =
  (typeof RECORDABLE_KNOWLEDGE_NAMESPACES)[number];

/**
 * A key is recordable when it is `namespace.something`: a known namespace
 * and at least one segment under it.
 *
 * The namespace is closed; what sits under it is not, because the facts a
 * founder states about revenue or a customer are open-ended and the gate's
 * policies attach to the namespace. `financial` on its own is refused —
 * a fact has to be about something more particular than a whole dimension.
 */
export function isRecordableKnowledgeKey(key: string): boolean {
  // Judged exactly as written, because what is written is what is stored:
  // silently accepting "Financial.ARR" would make a second key for a thing
  // that already has one, and no reader would find both.
  const trimmed = key.trim();
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(trimmed)) {
    return false;
  }
  const namespace = trimmed.slice(0, trimmed.indexOf("."));
  return (RECORDABLE_KNOWLEDGE_NAMESPACES as readonly string[]).includes(
    namespace,
  );
}

/** The namespaces, as a sentence for a prompt. */
export function recordableNamespacesSentence(): string {
  return RECORDABLE_KNOWLEDGE_NAMESPACES.join(", ");
}
