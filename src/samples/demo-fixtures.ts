import { INITIAL_DRONE_INVENTORY, initialDroneWorkspace } from "../assembly/drone-workspace";
import type { AssemblyAuthoringState } from "../assembly/assembly-authoring";
import { freezeSnapshot, type InventoryItem } from "../domain/design";
import type { FoundationContextSnapshot } from "../domain/foundation-context";
import { compileAssemblyTopologyContext } from "../optimization/assembly-study-compiler";
import { compileLiveTopologyContext, type LiveTopologyContext } from "../optimization/assembly-topology-input";
import { DRONE_ARM_FOUNDATION_CONTEXT, DRONE_ARM_FOUNDATION_STUDY } from "./drone-arm-foundation";
import { ROBOT_ARM_LINK_FIXTURE } from "./robot-arm-link";

export type DemoFixtureId = "reference-drone" | "robot-arm-link";

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
const robotTopology = compileAssemblyTopologyContext(ROBOT_ARM_LINK_FIXTURE.workspace, ROBOT_ARM_LINK_FIXTURE.study);

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
  "robot-arm-link": {
    id: "robot-arm-link",
    label: "Robot arm link",
    tagline: "Agent-generated typed assembly",
    initialState: ROBOT_ARM_LINK_FIXTURE.workspace,
    inventory: ROBOT_ARM_LINK_FIXTURE.inventory,
    context: exactContext(ROBOT_ARM_LINK_FIXTURE.context, robotTopology, ["base-support"]),
    acceptedRevision: ROBOT_ARM_LINK_FIXTURE.assembly.revision,
    supportsFlightReplay: false,
    topologySubject: "link",
    materialLabel: "PA12",
    compileTopology: (state) => compileAssemblyTopologyContext(state, ROBOT_ARM_LINK_FIXTURE.study),
  },
});
