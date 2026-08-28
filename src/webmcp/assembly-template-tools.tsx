import { useMemo } from "react";

import { DEMO_FIXTURES, type DemoFixtureId } from "../samples/demo-fixtures";
import type { FoundationToolDefinition } from "./register-tools";
import { useFoundationTools } from "./use-foundation-tools";

interface AssemblyTemplateToolsProps {
  readonly current: DemoFixtureId;
  readonly onGenerate: (fixture: DemoFixtureId) => void;
}

const response = (value: unknown, isError = false) => Promise.resolve({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});

function isDemoFixtureId(value: unknown): value is DemoFixtureId {
  return typeof value === "string" && Object.hasOwn(DEMO_FIXTURES, value);
}

export function AssemblyTemplateTools({ current, onGenerate }: AssemblyTemplateToolsProps) {
  const definitions = useMemo<readonly FoundationToolDefinition[]>(() => [{
    name: "generate_approved_assembly",
    description: "Replace the shared world with one approved, typed demo assembly. Available templates are the reference FPV drone and robot arm link; this does not generate arbitrary CAD geometry.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: {
          type: "string",
          enum: Object.keys(DEMO_FIXTURES),
          description: "Approved assembly template to generate in the shared editable world.",
        },
      },
      required: ["templateId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    enabled: true,
    execute: async (input) => {
      try {
        const templateId = input && typeof input === "object"
          ? (input as Record<string, unknown>).templateId
          : undefined;
        if (!isDemoFixtureId(templateId)) throw new Error("Select an approved assembly template.");
        onGenerate(templateId);
        return response({
          previousTemplateId: current,
          templateId,
          status: "generated-visible-assembly",
          nextAction: "inspect_design_context",
        });
      } catch (error) {
        return response({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    },
  }], [current, onGenerate]);
  const state = useFoundationTools(definitions);

  return <section aria-labelledby="assembly-template-tool-status">
    <h2 id="assembly-template-tool-status">Assembly generation tool</h2>
    <p role="status">
      {state.supported ? `${state.registered} assembly generation tool registered.` : "WebMCP is unavailable in this browser context."}
    </p>
    <p>Agents can replace this world with an approved typed assembly; the action is visible immediately.</p>
    {state.errors.map((error) => <p role="alert" key={error}>{error}</p>)}
  </section>;
}
