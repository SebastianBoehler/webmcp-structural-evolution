import { z } from "zod";

export const MechanismSolverWorkSchema = z.object({
  solverIterations: z.literal(64),
  internalPgsIterations: z.union([z.literal(1), z.literal(8)]),
}).strict();

export type MechanismSolverWork = z.infer<typeof MechanismSolverWorkSchema>;

export const DEFAULT_MECHANISM_SOLVER_WORK = Object.freeze({
  solverIterations: 64,
  internalPgsIterations: 1,
} as const satisfies MechanismSolverWork);

export const COMPONENT_MECHANISM_SOLVER_WORK = Object.freeze({
  solverIterations: 64,
  internalPgsIterations: 8,
} as const satisfies MechanismSolverWork);
