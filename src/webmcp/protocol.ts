export interface WebMCPToolResponse {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly isError?: boolean;
}

export interface ToolExecuteOptions {
  readonly signal: AbortSignal;
}

export interface ModelContextTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: object;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly untrustedContentHint?: boolean;
  };
  readonly execute: (args: unknown, options?: ToolExecuteOptions) => Promise<WebMCPToolResponse>;
}

export interface ModelContext {
  registerTool(
    tool: ModelContextTool,
    options?: { readonly signal?: AbortSignal },
  ): Promise<void>;
}
