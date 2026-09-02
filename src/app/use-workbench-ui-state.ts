import { useEffect, useState } from "react";

import type { AlternativeMode } from "../viewer/alternative-instances";
import type { DrawerView } from "./WorkbenchDrawer";
import type { AnalysisLayer } from "./ViewportModeToolbar";
import type { AssemblyPanel, WorkbenchMode } from "./workbench-mode";

type OperationStatus = "idle" | "running" | "canceling";
type Receipt = { readonly createdAt: string; readonly action: string };

export function deriveResponsivePanelState(
  workspaceMode: WorkbenchMode,
  dockVisible: boolean,
  hasCandidate: boolean,
  projectReceipts: readonly Receipt[],
  workspaceReceipts: readonly Receipt[],
) {
  const dockAvailable = workspaceMode === "simulate"
    || workspaceMode === "review"
    || (workspaceMode === "optimize" && hasCandidate);
  return {
    dockAvailable,
    dockOpen: dockVisible && dockAvailable,
    receipts: [...projectReceipts, ...workspaceReceipts]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  };
}

export function useWorkbenchUiState(operationStatus: OperationStatus) {
  const [workspaceMode, setWorkspaceMode] = useState<WorkbenchMode>("assembly");
  const [assemblyPanel, setAssemblyPanel] = useState<AssemblyPanel | undefined>("components");
  const [comparisonMode, setComparisonMode] = useState<AlternativeMode>("overlay");
  const [analysisLayer, setAnalysisLayer] = useState<AnalysisLayer>("density");
  const [selectedAlternative, setSelectedAlternative] = useState<string>();
  const [showConstraints, setShowConstraints] = useState(false);
  const [showComponents, setShowComponents] = useState(true);
  const [simulationActive, setSimulationActive] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<DrawerView>("evidence");
  const [dockVisible, setDockVisible] = useState(true);

  useEffect(() => {
    if (operationStatus === "running") setWorkspaceMode("optimize");
  }, [operationStatus]);

  const changeWorkspaceMode = (next: WorkbenchMode, hasPendingPromotion: boolean) => {
    setWorkspaceMode(next);
    if (next === "assembly" && assemblyPanel === undefined) setAssemblyPanel("components");
    if (next === "simulate") {
      setAnalysisLayer("stress");
      setShowConstraints(false);
    }
    if (next === "review") setActiveDrawer(hasPendingPromotion ? "branches" : "evidence");
    if (next !== "assembly") setDockVisible(true);
  };
  const openActivity = () => {
    setActiveDrawer("history");
    setWorkspaceMode("review");
    setDockVisible(true);
  };
  const setSimulationActivity = (active: boolean) => {
    setSimulationActive(active);
    if (active) {
      setAnalysisLayer("stress");
      setShowConstraints(false);
    }
  };

  return {
    workspaceMode, setWorkspaceMode,
    assemblyPanel, setAssemblyPanel,
    comparisonMode, setComparisonMode,
    analysisLayer, setAnalysisLayer,
    selectedAlternative, setSelectedAlternative,
    showConstraints, setShowConstraints,
    showComponents, setShowComponents,
    simulationActive,
    activeDrawer, setActiveDrawer,
    dockVisible, setDockVisible,
    changeWorkspaceMode,
    openActivity,
    setSimulationActivity,
  };
}
