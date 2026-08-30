import { useEffect, useRef, useState } from "react";

import { runExactCadGate, type ExactCadGateResult } from "../cad/kernel/browser-cad-gate";

export type ExactCadProjectGateState =
  | { readonly status: "inactive" }
  | { readonly status: "running" }
  | { readonly status: "passed"; readonly result: ExactCadGateResult }
  | { readonly status: "failed"; readonly message: string };

type GateRunner = (signal: AbortSignal) => Promise<ExactCadGateResult>;

const browserGateRequested = () => typeof globalThis.location !== "undefined"
  && new URLSearchParams(globalThis.location.search).has("exact-cad-gate");

export function useExactCadProjectGate(injected?: GateRunner): ExactCadProjectGateState {
  const runnerRef = useRef(injected ?? (browserGateRequested() ? runExactCadGate : undefined));
  const [state, setState] = useState<ExactCadProjectGateState>(
    runnerRef.current ? { status: "running" } : { status: "inactive" },
  );

  useEffect(() => {
    const runner = runnerRef.current;
    if (!runner) return;
    const controller = new AbortController();
    let active = true;
    void runner(controller.signal).then(
      (result) => { if (active) setState({ status: "passed", result }); },
      (error) => {
        if (active && !controller.signal.aborted) setState({
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => { active = false; controller.abort(); };
  }, []);

  return state;
}
