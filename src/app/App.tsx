import { Component, type ErrorInfo, type JSX, type ReactNode } from "react";

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
  return (
    <ErrorBoundary>
      <main className="workbench">
        <header className="workbench__header">
          <p className="eyebrow">WebGPU · Rust/Wasm · WebMCP</p>
          <h1>Structural Evolution</h1>
          <p className="lede">A browser workbench for inspecting and evolving physical-system structure.</p>
        </header>

        <section aria-labelledby="foundation-status" className="capability-panel">
          <div>
            <p className="eyebrow">Foundation status</p>
            <h2 id="foundation-status">Runtime capability probe</h2>
          </div>
          <dl className="capability-list">
            <div><dt>WebGPU</dt><dd>Pending browser probe</dd></div>
            <div><dt>Wasm reference</dt><dd>Awaiting build</dd></div>
            <div><dt>WebMCP</dt><dd>Not connected</dd></div>
          </dl>
          <button type="button" disabled>Run foundation probe</button>
        </section>
      </main>
    </ErrorBoundary>
  );
}
