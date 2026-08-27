export type WorkbenchMode = "assembly" | "optimize" | "simulate" | "review";

export const WORKBENCH_MODES: readonly {
  readonly id: WorkbenchMode;
  readonly step: number;
  readonly label: string;
}[] = [
  { id: "assembly", step: 1, label: "Assemble" },
  { id: "optimize", step: 2, label: "Optimize" },
  { id: "simulate", step: 3, label: "Simulate" },
  { id: "review", step: 4, label: "Review" },
];

export type AssemblyPanel = "components" | "inspector";
