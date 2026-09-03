import type { ComponentImport, ImportedComponent, PendingComponentImport } from "../assembly/component-import";
import type { FoundationServices } from "../webmcp/executors";
import type { FoundationProjectState } from "../webmcp/schemas";
import type { AssemblyVisualPart } from "../viewer/render-envelope";
import type { CompiledAssembly } from "../assembly/assembly-compile";
import type { LayoutState } from "../assembly/use-assembly-workspace";
import type { LayoutAuthority } from "../assembly/layout-validation";
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
  readonly layoutState: LayoutState;
  readonly layoutAuthority: LayoutAuthority;
  readonly conflicts: readonly { readonly id: string; readonly kind: string }[];
  readonly fixtureId: DemoFixtureId;
  readonly onGenerateFixture: (fixture: DemoFixtureId) => void;
  readonly onStage: (component: ComponentImport) => PendingComponentImport;
  readonly onMove: (id: string, center: readonly [number, number, number], expectedVersion?: number) => Promise<{ readonly revision: string; readonly layoutVersion: number }>;
  readonly onValidate: (expectedVersion: number) => Promise<CompiledAssembly>;
}

export function WorkbenchAgentTools(props: WorkbenchAgentToolsProps) {
  return (
    <div className="agent-tool-grid">
      <AssemblyTemplateTools current={props.fixtureId} onGenerate={props.onGenerateFixture} />
      <FoundationTools state={props.state} services={props.services} layoutAuthority={props.layoutAuthority} />
      <ComponentImportTools
        imports={props.imports}
        pending={props.pending}
        parts={props.parts}
        layoutVersion={props.layoutVersion}
        layoutState={props.layoutState}
        conflicts={props.conflicts}
        onStage={props.onStage}
        onMove={props.onMove}
        onValidate={props.onValidate}
      />
    </div>
  );
}
