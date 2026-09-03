import type { ComponentImport, ImportedComponent, PendingComponentImport } from "../assembly/component-import";
import type { ActionReceipt } from "../domain/receipts";
import type { FoundationServices } from "../webmcp/executors";
import type { FoundationProjectState, ProbeComparisonFacts } from "../webmcp/schemas";
import type { AssemblyVisualPart } from "../viewer/render-envelope";
import type { CompiledAssembly } from "../assembly/assembly-compile";
import type { LayoutState } from "../assembly/use-assembly-workspace";
import type { DemoFixtureId } from "../samples/demo-fixtures";
import { EvidencePanel } from "./EvidencePanel";
import { ExperimentRail } from "./ExperimentRail";
import { ReceiptLedger } from "./ReceiptLedger";
import type { ExperimentRailApi } from "./project-state-types";
import { WorkbenchAgentTools } from "./WorkbenchAgentTools";
import { WorkbenchDrawer, type DrawerItem, type DrawerView } from "./WorkbenchDrawer";

interface WorkbenchReviewDockProps {
  readonly active: DrawerView;
  readonly state: FoundationProjectState;
  readonly services: FoundationServices;
  readonly experimentRail: ExperimentRailApi;
  readonly comparison?: ProbeComparisonFacts;
  readonly initialAcceptedRevision: string;
  readonly workspaceReceipts: readonly ActionReceipt[];
  readonly imports: readonly ImportedComponent[];
  readonly pending?: PendingComponentImport;
  readonly parts: readonly AssemblyVisualPart[];
  readonly layoutVersion: number;
  readonly layoutState: LayoutState;
  readonly fixtureId: DemoFixtureId;
  readonly onGenerateFixture: (fixture: DemoFixtureId) => void;
  readonly onStage: (component: ComponentImport) => PendingComponentImport;
  readonly onMove: (id: string, center: readonly [number, number, number], expectedVersion?: number) => void;
  readonly onValidate: (expectedVersion: number) => Promise<CompiledAssembly>;
  readonly onChange: (view: DrawerView) => void;
}

export function WorkbenchReviewDock(props: WorkbenchReviewDockProps) {
  const receipts = [...props.state.receipts, ...props.workspaceReceipts]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const items: readonly DrawerItem[] = [
    {
      id: "evidence",
      label: "Evidence",
      content: <EvidencePanel
        state={props.state}
        comparison={props.comparison}
        initialAcceptedRevision={props.initialAcceptedRevision}
      />,
    },
    {
      id: "branches",
      label: "Branches",
      count: props.state.stagedBranches.length,
      content: <ExperimentRail state={props.state} api={props.experimentRail} />,
    },
    {
      id: "history",
      label: "History",
      count: receipts.length,
      content: <ReceiptLedger receipts={receipts} />,
    },
    {
      id: "agents",
      label: "Agents",
      content: <WorkbenchAgentTools
        state={props.state}
        services={props.services}
        imports={props.imports}
        pending={props.pending}
        parts={props.parts}
        layoutVersion={props.layoutVersion}
        layoutState={props.layoutState}
        fixtureId={props.fixtureId}
        onGenerateFixture={props.onGenerateFixture}
        onStage={props.onStage}
        onMove={props.onMove}
        onValidate={props.onValidate}
      />,
    },
  ];
  return <WorkbenchDrawer active={props.active} items={items} onChange={(next) => props.onChange(next ?? "evidence")} />;
}
