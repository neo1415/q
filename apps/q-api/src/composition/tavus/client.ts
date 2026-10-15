// The Tavus adapter moved to @capital-q/integrations so the GateQ video
// interview (apps/api) uses the same client and caps. Re-exported here so
// the rehearsal composition keeps its imports.
export {
  createTavusClient,
  TavusError,
  tavusFailureKind,
  type TavusClient,
  type TavusConversation,
  type TavusCreatedConversation,
  type TavusFace,
  type TavusFailureKind,
  type TavusPalLayers,
  type TavusVoice,
} from "@capital-q/integrations";
