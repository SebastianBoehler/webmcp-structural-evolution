import { useCallback, useMemo, useState } from "react";

import { createFlightFrameChannel } from "../simulation/flight-frame-channel";
import type { FlightReplayCommand } from "../simulation/FlightSimulationPanel";
import type { FlightMotor } from "../simulation/flight-scenarios";
import type { SimulationViewCommand } from "../webmcp/simulation-tools";
import type { AnalysisLayer } from "./ViewportModeToolbar";
import type { WorkbenchMode } from "./workbench-mode";

interface AgentSimulationOptions {
  readonly motors: readonly { readonly id: string }[];
  readonly motorMounts: readonly { readonly centerM: readonly [number, number, number] }[];
  readonly setWorkspaceMode: (mode: WorkbenchMode) => void;
  readonly setAnalysisLayer: (layer: AnalysisLayer) => void;
  readonly setShowComponents: (visible: boolean) => void;
  readonly setShowConstraints: (visible: boolean) => void;
  readonly setDockVisible: (visible: boolean) => void;
}

export function useAgentSimulation(options: AgentSimulationOptions) {
  const { motors: sourceMotors, motorMounts, setWorkspaceMode, setAnalysisLayer,
    setShowComponents, setShowConstraints, setDockVisible } = options;
  const frameChannel = useMemo(createFlightFrameChannel, []);
  const motors = useMemo<readonly FlightMotor[]>(() => sourceMotors.flatMap((motor, index) => {
    const mount = motorMounts[index];
    return mount ? [{ id: motor.id, centerM: mount.centerM }] : [];
  }), [motorMounts, sourceMotors]);
  const [command, setCommand] = useState<FlightReplayCommand>();
  const showCase = useCallback((next: SimulationViewCommand) => {
    setWorkspaceMode("simulate");
    setAnalysisLayer(next.analysisLayer);
    setShowComponents(next.componentsVisible);
    setShowConstraints(false);
    setDockVisible(true);
    setCommand((current) => ({
      requestId: (current?.requestId ?? 0) + 1,
      scenario: next.scenario,
    }));
  }, [setAnalysisLayer, setDockVisible, setShowComponents, setShowConstraints, setWorkspaceMode]);
  return { frameChannel, motors, command, showCase };
}
