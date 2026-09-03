import { useMemo } from "react";

import {
  ComponentImportSchema,
  componentImportJsonSchema,
  type ComponentImport,
  type ImportedComponent,
  type PendingComponentImport,
} from "../assembly/component-import";
import type { FoundationToolDefinition } from "./register-tools";
import { useFoundationTools } from "./use-foundation-tools";
import type { AssemblyVisualPart } from "../viewer/render-envelope";
import type { CompiledAssembly } from "../assembly/assembly-compile";
import type { LayoutState } from "../assembly/use-assembly-workspace";

export interface ComponentImportToolsProps {
  readonly imports: readonly ImportedComponent[];
  readonly pending?: PendingComponentImport;
  readonly parts: readonly AssemblyVisualPart[];
  readonly layoutVersion: number;
  readonly layoutState?: LayoutState;
  readonly onStage: (component: ComponentImport) => PendingComponentImport;
  readonly onMove: (id: string, center: readonly [number, number, number], expectedVersion?: number) => void;
  readonly onValidate?: (expectedVersion: number) => Promise<Pick<CompiledAssembly, "revision" | "conflicts">>;
}

const response = (value: unknown, isError = false) => Promise.resolve({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});

export function ComponentImportTools({ imports, pending, parts, layoutVersion, layoutState = "verified", onStage, onMove, onValidate }: ComponentImportToolsProps) {
  const movableParts = parts.filter(({ movable }) => movable);
  const hasMovableParts = movableParts.length > 0;
  const canValidateLayout = onValidate !== undefined;
  const signature = `${imports.map(({ id }) => id).join(":")}:${pending?.id ?? "none"}:${layoutVersion}:${layoutState}:${canValidateLayout}:${movableParts.map(({ selectionId }) => selectionId).join(":")}`;
  const expectedToolCount = 1 + (pending ? 0 : 1) + (hasMovableParts ? 1 : 0) + (canValidateLayout && layoutState === "changed" ? 1 : 0);
  const definitions = useMemo<readonly FoundationToolDefinition[]>(() => [
    {
      name: "inspect_component_library",
      description: "Inspect the component assets already in the assembly and any import awaiting human review.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      enabled: true,
      execute: async () => response({
        imported: imports.map(({ id, name, manufacturer, partNumber, validation }) => ({
          id, name, manufacturer, partNumber, validation,
        })),
        pending: pending ? {
          id: pending.id,
          name: pending.name,
          manufacturer: pending.manufacturer,
          partNumber: pending.partNumber,
        } : null,
        layoutVersion,
        layoutState,
        topologyEvidence: layoutState === "verified" ? "current" : "stale",
        movable: movableParts.map(({ selectionId, label, center }) => ({
          componentId: selectionId, label, centerMm: center,
        })),
        nextAction: layoutState === "changed" ? "validate_assembly_layout"
          : layoutState === "validating" ? "wait_for_layout_validation"
            : pending ? "Wait for the human to approve or reject the staged import." : "stage_component_import",
      }),
    },
    {
      name: "validate_assembly_layout",
      description: "Compile and validate the exact current shared assembly layout. Topology remains blocked until this reports no blocking conflicts.",
      inputSchema: {
        type: "object",
        properties: { expectedLayoutVersion: { type: "integer", minimum: 1 } },
        required: ["expectedLayoutVersion"], additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      enabled: canValidateLayout && layoutState === "changed",
      execute: async (input) => {
        try {
          const expectedLayoutVersion = input && typeof input === "object"
            ? (input as Record<string, unknown>).expectedLayoutVersion : undefined;
          if (!Number.isInteger(expectedLayoutVersion)) throw new Error("expectedLayoutVersion must be an integer");
          const compiled = await onValidate!(expectedLayoutVersion as number);
          return response({ status: "layout-verified", layoutVersion: expectedLayoutVersion, revision: compiled.revision, conflictCount: compiled.conflicts.length, nextAction: "generate_topology_candidate" });
        } catch (error) {
          return response({ error: error instanceof Error ? error.message : String(error), nextAction: "inspect_component_library" }, true);
        }
      },
    },
    {
      name: "stage_component_import",
      description: "Stage one sourced GLB or glTF component with exact manufacturer metadata for human review. This never inserts the component without approval.",
      inputSchema: componentImportJsonSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      enabled: pending === undefined,
      execute: async (input) => {
        try {
          const staged = onStage(ComponentImportSchema.parse(input));
          return response({
            stagedImportId: staged.id,
            status: "awaiting-human-review",
            component: `${staged.manufacturer} ${staged.partNumber}`,
          });
        } catch (error) {
          return response({ error: error instanceof Error ? error.message : String(error) }, true);
        }
      },
    },
    {
      name: "move_assembly_component",
      description: "Move one movable component in the shared assembly plane using the exact current layout version.",
      inputSchema: {
        type: "object",
        properties: {
          componentId: { type: "string", minLength: 1, maxLength: 100 },
          expectedLayoutVersion: { type: "integer", minimum: 1 },
          xMm: { type: "number", minimum: -500, maximum: 500 },
          yMm: { type: "number", minimum: -500, maximum: 500 },
        },
        required: ["componentId", "expectedLayoutVersion", "xMm", "yMm"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      enabled: hasMovableParts,
      execute: async (input) => {
        try {
          if (!input || typeof input !== "object") throw new Error("Expected a component move object");
          const value = input as Record<string, unknown>;
          if (typeof value.componentId !== "string" || !value.componentId) throw new Error("componentId is required");
          if (!Number.isInteger(value.expectedLayoutVersion)) throw new Error("expectedLayoutVersion must be an integer");
          if (typeof value.xMm !== "number" || typeof value.yMm !== "number") throw new Error("xMm and yMm must be numbers");
          const part = parts.find(({ selectionId, movable }) => movable && selectionId === value.componentId);
          if (!part) throw new Error("Component is not movable in the current assembly");
          onMove(part.selectionId, [value.xMm, value.yMm, part.center[2]], value.expectedLayoutVersion as number);
          return response({
            componentId: part.selectionId,
            status: "moved-visible-layout-stale",
            nextAction: "inspect_component_library",
          });
        } catch (error) {
          return response({ error: error instanceof Error ? error.message : String(error) }, true);
        }
      },
    },
  ], [onMove, onStage, onValidate, signature]);
  const state = useFoundationTools(definitions);
  return (
    <section aria-labelledby="component-tool-status">
      <h2 id="component-tool-status">Component sourcing tools</h2>
      <p role="status">
        {state.supported
          ? `${state.registered} of ${expectedToolCount} component tools registered.`
          : "WebMCP is unavailable in this browser context."}
      </p>
      <p>Agents can stage sourced assets and specifications; you approve the assembly change.</p>
      {state.errors.map((error) => <p role="alert" key={error}>{error}</p>)}
    </section>
  );
}
