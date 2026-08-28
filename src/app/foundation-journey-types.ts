import type { GpuCapability } from "../gpu/capabilities";
import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import type { FieldViewerEnvironment } from "../viewer/FieldViewer";
import type { DemoFixtureId } from "../samples/demo-fixtures";

export interface FoundationJourneyProps {
  readonly capability: GpuCapability;
  readonly compute?: (input: ProbeInput, signal?: AbortSignal) => Promise<ProbeResult>;
  readonly viewerEnvironment?: FieldViewerEnvironment;
  readonly fixtureId?: DemoFixtureId;
  readonly onFixtureChange?: (fixture: DemoFixtureId) => void;
}
