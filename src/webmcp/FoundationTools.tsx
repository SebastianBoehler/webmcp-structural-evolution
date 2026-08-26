import { useWebMCP } from "use-webmcp-tool";

import type { FoundationServices } from "./executors";
import { foundationToolDefinitions } from "./register-tools";
import type { FoundationProjectState } from "./schemas";

export interface FoundationToolsProps {
  readonly services: FoundationServices;
  readonly state: FoundationProjectState;
}

export function FoundationTools({ services, state }: FoundationToolsProps) {
  const [inspect, run, compare] = foundationToolDefinitions(services, state);
  const inspectState = useWebMCP(inspect);
  const runState = useWebMCP(run);
  const compareState = useWebMCP(compare);
  const toolStates = [inspectState, runState, compareState];
  const supported = toolStates.some((tool) => tool.supported);
  const registered = toolStates.filter((tool) => tool.registered).length;
  const errors = toolStates.flatMap((tool) => tool.error ? [tool.error.message] : []);

  return (
    <section aria-labelledby="webmcp-foundation-status">
      <h2 id="webmcp-foundation-status">Agent tool status</h2>
      <p role="status">
        {supported
          ? `${registered} of 3 foundation tools registered.`
          : "WebMCP is unavailable in this browser context."}
      </p>
      {errors.map((error) => <p role="alert" key={error}>{error}</p>)}
    </section>
  );
}
