export const STRUCTURAL_LOAD_CASES = [
  "collective-thrust",
  "roll-differential",
  "pitch-differential",
  "yaw-torsion",
] as const;

export type StructuralLoadCase = (typeof STRUCTURAL_LOAD_CASES)[number];
