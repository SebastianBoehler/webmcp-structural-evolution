import { useEffect, useState } from "react";

import type { ModelContextTool } from "./protocol";
import type { FoundationToolDefinition } from "./register-tools";

interface RegistrationState {
  readonly supported: boolean;
  readonly registered: number;
  readonly errors: readonly string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useFoundationTools(
  definitions: readonly FoundationToolDefinition[],
): RegistrationState {
  const [state, setState] = useState<RegistrationState>(() => ({
    supported: document.modelContext !== undefined,
    registered: 0,
    errors: [],
  }));

  useEffect(() => {
    const context = document.modelContext;
    if (!context) {
      setState({ supported: false, registered: 0, errors: [] });
      return;
    }
    let disposed = false;
    const registered = new Set<string>();
    const controllers: AbortController[] = [];
    setState({ supported: true, registered: 0, errors: [] });

    for (const definition of definitions.filter(({ enabled }) => enabled)) {
      const controller = new AbortController();
      controllers.push(controller);
      const { enabled: _enabled, ...tool } = definition;
      let registration: Promise<void>;
      try {
        registration = context.registerTool(tool as ModelContextTool, { signal: controller.signal });
      } catch (error) {
        registration = Promise.reject(error);
      }
      void registration.then(() => {
        if (disposed) return;
        registered.add(definition.name);
        setState((current) => ({ ...current, registered: registered.size }));
      }).catch((error: unknown) => {
        if (disposed || controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          errors: [...current.errors, `${definition.name}: ${errorMessage(error)}`],
        }));
      });
    }

    return () => {
      disposed = true;
      for (const controller of controllers) controller.abort();
    };
  }, [definitions]);

  return state;
}
