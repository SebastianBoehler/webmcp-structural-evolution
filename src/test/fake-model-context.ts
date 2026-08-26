export interface FakeToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: object;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly untrustedContentHint?: boolean;
  };
  readonly execute: (args: unknown) => Promise<unknown>;
}

export class FakeModelContext {
  readonly registrations: FakeToolDefinition[] = [];
  readonly aborted: string[] = [];
  readonly active = new Map<string, FakeToolDefinition>();

  registerTool(tool: FakeToolDefinition, options: { readonly signal: AbortSignal }): void {
    this.registrations.push(tool);
    this.active.set(tool.name, tool);
    options.signal.addEventListener("abort", () => {
      if (this.active.get(tool.name) === tool) this.active.delete(tool.name);
      this.aborted.push(tool.name);
    }, { once: true });
  }

  async execute(name: string, args: unknown): Promise<unknown> {
    const tool = this.active.get(name);
    if (!tool) throw new Error(`Tool ${name} is not registered`);
    return tool.execute(args);
  }
}

export function installFakeModelContext(context: FakeModelContext): () => void {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: context,
  });
  return () => {
    Reflect.deleteProperty(document, "modelContext");
  };
}
