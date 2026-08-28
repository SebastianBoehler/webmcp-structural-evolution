import type { AssemblyTopologyInput } from "../optimization/assembly-topology-input";
import { FlightSimulationPanel, type FlightSimulationPanelProps } from "../simulation/FlightSimulationPanel";

interface FixtureSimulationDockProps extends Omit<FlightSimulationPanelProps, "massKg" | "componentCount" | "batteryMassKg"> {
  readonly supportsFlightReplay: boolean;
  readonly topology: AssemblyTopologyInput;
}

export function FixtureSimulationDock({ supportsFlightReplay, topology, ...flight }: FixtureSimulationDockProps) {
  return <aside className="analysis-dock" aria-label="Simulation controls">
    {supportsFlightReplay ? <FlightSimulationPanel
      {...flight}
      massKg={topology.assemblyMassKg}
      componentCount={topology.inertialMasses.length}
      batteryMassKg={topology.inertialMasses.find(({ id }) => id === "battery")?.massKg ?? 0}
    /> : <div className="simulation-unavailable" role="status">
      <h2>Structural load cases</h2>
      <p>Flight replay does not apply to this assembly. Generate a topology to inspect its named structural load cases.</p>
      <ul>{topology.loadCases.map(({ id }) => <li key={id}>{id}</li>)}</ul>
    </div>}
  </aside>;
}
