import {
  Component, lazy, Suspense, useEffect, useState,
  type ErrorInfo, type JSX, type ReactNode,
} from "react";

import { detectWebGpuSingleFlight, type GpuCapability } from "../gpu/capabilities";
import type { DemoFixtureId } from "../samples/demo-fixtures";

const ExactCadGateRoute = lazy(async () => {
  const module = await import("./ExactCadGateRoute");
  return { default: module.ExactCadGateRoute };
});
const StructuralTopologyGateRoute = lazy(async () => {
  const module = await import("./StructuralTopologyGateRoute");
  return { default: module.StructuralTopologyGateRoute };
});
const MechanismGateRoute = lazy(async () => {
  const module = await import("./MechanismGateRoute");
  return { default: module.MechanismGateRoute };
});

const FoundationJourney = lazy(async () => {
  const module = await import("./FoundationJourney");
  return { default: module.FoundationJourney };
});

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { hasError: boolean };

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {}

  render(): ReactNode {
    if (this.state.hasError) {
      return <p role="alert">The structural workbench could not start.</p>;
    }

    return this.props.children;
  }
}

function FoundationRoute({ capability }: { readonly capability: GpuCapability }) {
  const [fixtureId, setFixtureId] = useState<DemoFixtureId>("reference-drone");

  return <Suspense fallback={<p role="status">Loading structural workbench…</p>}>
    <FoundationJourney
      key={fixtureId}
      capability={capability}
      fixtureId={fixtureId}
      onFixtureChange={setFixtureId}
    />
  </Suspense>;
}

const exactCadRouteRequested = () => typeof globalThis.location !== "undefined"
  && new URLSearchParams(globalThis.location.search).has("exact-cad-gate");

export function App(): JSX.Element {
  if (typeof globalThis.location !== "undefined"
    && new URLSearchParams(globalThis.location.search).has("mechanism-gate")) {
    return <ErrorBoundary><Suspense fallback={<p role="status">Loading mechanism gate…</p>}>
      <MechanismGateRoute />
    </Suspense></ErrorBoundary>;
  }
  if (typeof globalThis.location !== "undefined"
    && new URLSearchParams(globalThis.location.search).has("structural-topology-gate")) {
    return <ErrorBoundary><Suspense fallback={<p role="status">Loading live gate…</p>}>
      <StructuralTopologyGateRoute />
    </Suspense></ErrorBoundary>;
  }
  return <WorkbenchApp />;
}

function WorkbenchApp(): JSX.Element {
  const [capability, setCapability] = useState<GpuCapability>({
    status: "unavailable",
    code: "api-unavailable",
    message: "Checking the target browser for WebGPU…",
  });

  useEffect(() => {
    let active = true;
    void detectWebGpuSingleFlight().then((result) => {
      if (active) setCapability(result);
    });
    return () => { active = false; };
  }, []);

  return (
    <ErrorBoundary>
      {exactCadRouteRequested()
        ? <Suspense fallback={<p role="status">Loading exact CAD gate…</p>}>
          <ExactCadGateRoute capability={capability} />
        </Suspense>
        : <FoundationRoute capability={capability} />}
    </ErrorBoundary>
  );
}
