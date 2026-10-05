import { createHash } from "node:crypto";

import type { ActorContext } from "@capital-q/security";

import type { GatewayId } from "../contracts/index.js";
import {
  MANDATE_READER_VERSION,
  readMandate,
  type MandateDimension,
  type MandateVocabularyNode,
  type PolicyProposal,
} from "../domain/mandate-reader.js";
import type { GateQService } from "./use-cases.js";

/**
 * Reading an investor's mandate into a DRAFT gate policy (P7).
 *
 * Authorise (the actor may edit this gateway) → read deterministically →
 * record provenance once per client request → return proposals. Nothing is
 * published and nothing is evaluated: the investor confirms the proposals by
 * publishing a version through the existing draft → publish path, which is
 * where a criterion first becomes a rule.
 */

export type PolicySourceKind = "PASTED_TEXT" | "UPLOADED_FILE";

export type PolicyExtractionRecord = {
  readonly tenantId: string;
  readonly gatewayId: string;
  readonly sourceKind: PolicySourceKind;
  readonly sourceSha256: string;
  readonly sourceChars: number;
  readonly readerVersion: string;
  readonly proposals: readonly PolicyProposal[];
  readonly notFound: readonly MandateDimension[];
  readonly clientRequestId: string;
  readonly createdByUserId: string;
};

export type PolicyExtractionRepository = {
  /** Insert once per (gateway, client request); returns the row's id. */
  readonly record: (
    input: PolicyExtractionRecord,
  ) => Promise<{ readonly id: string; readonly deduplicated: boolean }>;
};

export type PolicyExtraction = {
  readonly extractionId: string;
  readonly readerVersion: string;
  readonly proposals: readonly PolicyProposal[];
  readonly notFound: readonly MandateDimension[];
  readonly excludedPlaces: readonly string[];
  readonly deduplicated: boolean;
};

export class MandateTextEmptyError extends Error {
  constructor() {
    super("There is no mandate text to read.");
    this.name = "MandateTextEmptyError";
  }
}

export function createPolicyExtractionService(dependencies: {
  readonly gateq: Pick<GateQService, "authoriseEdit">;
  readonly repository: PolicyExtractionRepository;
  readonly vocabulary: readonly MandateVocabularyNode[];
}) {
  const { gateq, repository, vocabulary } = dependencies;
  return {
    extract: async (command: {
      readonly actor: ActorContext;
      readonly gatewayId: GatewayId;
      readonly text: string;
      readonly sourceKind: PolicySourceKind;
      readonly clientRequestId: string;
    }): Promise<PolicyExtraction> => {
      // Authority before reading: an unauthorised caller learns nothing,
      // not even whether their text would have parsed.
      const gateway = await gateq.authoriseEdit({
        actor: command.actor,
        gatewayId: command.gatewayId,
      });
      const text = command.text.trim();
      if (text === "") throw new MandateTextEmptyError();
      const reading = readMandate(text, vocabulary);
      const recorded = await repository.record({
        tenantId: gateway.tenantId,
        gatewayId: gateway.id,
        sourceKind: command.sourceKind,
        sourceSha256: createHash("sha256").update(text).digest("hex"),
        sourceChars: Math.min(text.length, 20_000),
        readerVersion: MANDATE_READER_VERSION,
        proposals: reading.proposals,
        notFound: reading.notFound,
        clientRequestId: command.clientRequestId,
        createdByUserId: command.actor.userId,
      });
      return {
        extractionId: recorded.id,
        readerVersion: MANDATE_READER_VERSION,
        proposals: reading.proposals,
        notFound: reading.notFound,
        excludedPlaces: reading.excludedPlaces,
        deduplicated: recorded.deduplicated,
      };
    },
  };
}

export type PolicyExtractionService = ReturnType<
  typeof createPolicyExtractionService
>;
