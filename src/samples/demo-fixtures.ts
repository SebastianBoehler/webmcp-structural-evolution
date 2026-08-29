import { INITIAL_DRONE_INVENTORY, initialDroneWorkspace } from "../assembly/drone-workspace";
import type { AssemblyAuthoringState } from "../assembly/assembly-authoring";
import type { AssemblyVisualRenderer } from "../assembly/assembly-workspace-model";
import { freezeSnapshot, type InventoryItem } from "../domain/design";
import type { FoundationContextSnapshot } from "../domain/foundation-context";
import { compileAssemblyTopologyContext } from "../optimization/assembly-study-compiler";
import { compileLiveTopologyContext, type LiveTopologyContext } from "../optimization/assembly-topology-input";
import { DRONE_ARM_FOUNDATION_CONTEXT, DRONE_ARM_FOUNDATION_STUDY } from "./drone-arm-foundation";
import { SE6_COBOT_FIXTURE } from "./cobot/cobot-fixture";

export type DemoFixtureId = "reference-drone" | "se6-cobot";

export interface DemoFixture {
  readonly id: DemoFixtureId;
  readonly label: string;
  readonly tagline: string;
  readonly initialState: AssemblyAuthoringState;
  readonly inventory: readonly InventoryItem[];
  readonly context: FoundationContextSnapshot;
  readonly acceptedRevision: string;
  readonly supportsFlightReplay: boolean;
  readonly topologySubject: string;
  readonly materialLabel: string;
  readonly renderParts?: AssemblyVisualRenderer;
  readonly compileTopology: (state: AssemblyAuthoringState) => LiveTopologyContext;
}

function exactContext(
  context: FoundationContextSnapshot,
  topology: LiveTopologyContext,
  locks = context.locks,
): FoundationContextSnapshot {
  const { width, height, depth } = topology.grid.dimensions;
  return freezeSnapshot({
    ...context,
    locks,
    selection: { ...context.selection, maxExclusive: [width, height, depth] },
    grid: topology.grid,
  });
}

const droneTopology = compileLiveTopologyContext(initialDroneWorkspace);
const cobotTopology = compileAssemblyTopologyContext(SE6_COBOT_FIXTURE.workspace, SE6_COBOT_FIXTURE.study);

export const DEMO_FIXTURES: Readonly<Record<DemoFixtureId, DemoFixture>> = Object.freeze({
  "reference-drone": {
    id: "reference-drone",
    label: "Reference FPV drone",
    tagline: "Human-agent physical engineering",
    initialState: initialDroneWorkspace,
    inventory: INITIAL_DRONE_INVENTORY,
    context: exactContext(DRONE_ARM_FOUNDATION_CONTEXT, droneTopology),
    acceptedRevision: DRONE_ARM_FOUNDATION_STUDY.assembly.revision,
    supportsFlightReplay: true,
    topologySubject: "frame",
    materialLabel: "PLA",
    compileTopology: compileLiveTopologyContext,
  },
  "se6-cobot": {
    id: "se6-cobot",
    label: "SE-6 six-axis cobot",
    tagline: "A complete robot, one solver-owned upper arm",
    initialState: SE6_COBOT_FIXTURE.workspace,
    inventory: SE6_COBOT_FIXTURE.inventory,
    context: exactContext(SE6_COBOT_FIXTURE.context, cobotTopology, ["j2-upper-arm-support"]),
    acceptedRevision: SE6_COBOT_FIXTURE.assembly.revision,
    supportsFlightReplay: false,
    topologySubject: "upper arm",
    materialLabel: "PA12",
    renderParts: SE6_COBOT_FIXTURE.renderParts,
    compileTopology: (state) => compileAssemblyTopologyContext(state, SE6_COBOT_FIXTURE.study),
  },
});
