import type { OcctWorkerFailureCode } from "./occt-worker-contract";

export const cadFailureCode = (code: OcctWorkerFailureCode) => {
  switch (code) {
    case "memory-exhausted": return "resource-limit" as const;
    case "feature-failed": return "feature-failed" as const;
    case "invalid-solid": return "invalid-solid" as const;
    case "reference-requires-repair": return "reference-requires-repair" as const;
    case "resource-limit": return "resource-limit" as const;
    case "sketch-constraint-unsatisfied": return "sketch-constraint-unsatisfied" as const;
    case "sketch-under-constrained": return "sketch-under-constrained" as const;
    case "sketch-over-constrained": return "sketch-over-constrained" as const;
    default: return "internal-error" as const;
  }
};

export const isFatalOcctFailure = (code: OcctWorkerFailureCode) =>
  code === "protocol-mismatch" || code === "device-error";
