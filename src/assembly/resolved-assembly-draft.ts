import { solveAssemblyConstraints, type AssemblyAuthoringState } from "./assembly-authoring";

const m = (value: number) => ({ value: value / 1_000, unit: "m" as const });
const rad = (value: number) => ({ value, unit: "rad" as const });

export function resolvedAssemblyDraft(state: AssemblyAuthoringState) {
  const solved = solveAssemblyConstraints(state);
  return {
    ...state.draft,
    components: state.draft.components.map((instance) => {
      const transform = solved.instances[instance.instanceId]?.transform;
      return transform ? { ...instance, transform: {
        position: { x: m(transform.positionMm[0]), y: m(transform.positionMm[1]), z: m(transform.positionMm[2]) },
        orientation: { roll: rad(transform.orientationRad[0]), pitch: rad(transform.orientationRad[1]), yaw: rad(transform.orientationRad[2]) },
      } } : instance;
    }),
  };
}
