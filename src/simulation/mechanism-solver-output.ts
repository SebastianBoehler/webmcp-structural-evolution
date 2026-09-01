import { z } from "zod";

import {
  MechanismReplayEvidenceSchema, MechanismWorkerResultEvidenceCandidateSchema,
} from "./mechanism-contract";

export const MechanismWorkerEvidencePayloadSchema = MechanismWorkerResultEvidenceCandidateSchema
  .omit({ replayDigest: true });

export const MechanismWorkerOutputSchema = z.object({
  replay: MechanismReplayEvidenceSchema,
  evidence: MechanismWorkerEvidencePayloadSchema,
}).strict();

export type MechanismWorkerOutput = z.infer<typeof MechanismWorkerOutputSchema>;
