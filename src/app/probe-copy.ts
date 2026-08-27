import type { ProbeVariant } from "../webmcp/schemas";

export const probeCopy: Readonly<Record<ProbeVariant, { hypothesis: string; prediction: string }>> = {
  balanced: {
    hypothesis: "Balance a spatial truss across hover agility and torsion loads",
    prediction: "Retain 26 percent material plus every must-pass path and keep-out",
  },
  lightweight: {
    hypothesis: "Reduce frame mass while preserving continuous motor-to-core load paths",
    prediction: "Material should fall to 20 percent with higher but finite compliance",
  },
  stiffness: {
    hypothesis: "Prioritize stiffness for aggressive roll pitch and torsion load cases",
    prediction: "Compliance and displacement should improve using a 34 percent material budget",
  },
};
