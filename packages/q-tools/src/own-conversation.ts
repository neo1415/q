/**
 * W2-A/W2-B: the own-conversation and own-onboarding checks live with the
 * conversations they guard, in q-runtime (packages/q-runtime/src/domain/
 * own-scopes.ts); the tools import them from here.
 */
export {
  ownsConversation,
  ownsOnboarding,
  type OwnScopeAccess as OwnConversationAccess,
} from "@capital-q/q-runtime";
