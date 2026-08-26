export interface FakeToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: object;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly untrustedContentHint?: boolean;
  };
  readonly execute: (args: unknown, options?: { readonly signal: AbortSignal }) => Promise<unknown>;
}

interface FakeModelContextOptions {
  readonly registrationGate?: Promise<void>;
  readonly registrationError?: Error;
}

export class FakeModelContext {
  readonly registrations: FakeToolDefinition[] = [];
  readonly aborted: string[] = [];
  readonly active = new Map<string, FakeToolDefinition>();

  constructor(private readonly options: FakeModelContextOptions = {}) {}

  registerTool(tool: FakeToolDefinition, options: { readonly signal: AbortSignal }): Promise<void> {
    this.registrations.push(tool);
    if (!this.options.registrationError) this.active.set(tool.name, tool);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const abort = () => {
      if (this.active.get(tool.name) === tool) this.active.delete(tool.name);
      this.aborted.push(tool.name);
        if (!settled) {
          settled = true;
          reject(options.signal.reason);
        }
      };
      options.signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(this.options.registrationGate).then(() => {
        if (settled) return;
        settled = true;
        if (this.options.registrationError) reject(this.options.registrationError);
        else resolve();
      });
    });
  }

  async execute(name: string, args: unknown, signal = new AbortController().signal): Promise<unknown> {
    const tool = this.active.get(name);
    if (!tool) throw new Error(`Tool ${name} is not registered`);
    return tool.execute(args, { signal });
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
