import { Component, useEffect, useState, type ErrorInfo, type JSX, type ReactNode } from "react";

import { detectWebGpuSingleFlight, type GpuCapability } from "../gpu/capabilities";
import { FoundationJourney } from "./FoundationJourney";

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

export function App(): JSX.Element {
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
      <FoundationJourney capability={capability} />
    </ErrorBoundary>
  );
}
