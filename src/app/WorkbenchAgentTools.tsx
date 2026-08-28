import type { ComponentImport, ImportedComponent, PendingComponentImport } from "../assembly/component-import";
import type { FoundationServices } from "../webmcp/executors";
import type { FoundationProjectState } from "../webmcp/schemas";
import type { AssemblyVisualPart } from "../viewer/render-envelope";
import type { DemoFixtureId } from "../samples/demo-fixtures";
import { AssemblyTemplateTools } from "../webmcp/assembly-template-tools";
import { FoundationTools } from "../webmcp/FoundationTools";
import { ComponentImportTools } from "../webmcp/component-tools";

export interface WorkbenchAgentToolsProps {
  readonly state: FoundationProjectState;
  readonly services: FoundationServices;
  readonly imports: readonly ImportedComponent[];
  readonly pending?: PendingComponentImport;
  readonly parts: readonly AssemblyVisualPart[];
  readonly layoutVersion: number;
  readonly fixtureId: DemoFixtureId;
  readonly onGenerateFixture: (fixture: DemoFixtureId) => void;
  readonly onStage: (component: ComponentImport) => PendingComponentImport;
  readonly onMove: (id: string, center: readonly [number, number, number], expectedVersion?: number) => void;
}

export function WorkbenchAgentTools(props: WorkbenchAgentToolsProps) {
  return (
    <div className="agent-tool-grid">
      <AssemblyTemplateTools current={props.fixtureId} onGenerate={props.onGenerateFixture} />
      <FoundationTools state={props.state} services={props.services} />
      <ComponentImportTools
        imports={props.imports}
        pending={props.pending}
        parts={props.parts}
        layoutVersion={props.layoutVersion}
        onStage={props.onStage}
        onMove={props.onMove}
      />
    </div>
  );
}
