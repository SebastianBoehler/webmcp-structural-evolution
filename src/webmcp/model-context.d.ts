import type { WebMCPToolResponse } from "use-webmcp-tool";

interface ModelContextTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: object;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly untrustedContentHint?: boolean;
  };
  readonly execute: (args: unknown) => Promise<WebMCPToolResponse>;
}

interface ModelContext {
  registerTool(tool: ModelContextTool, options: { readonly signal: AbortSignal }): void;
}

declare global {
  interface Document {
    readonly modelContext?: ModelContext;
  }
}

export {};
