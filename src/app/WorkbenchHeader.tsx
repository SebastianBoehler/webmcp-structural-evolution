import type { GpuCapability } from "../gpu/capabilities";
import { DEMO_FIXTURES, type DemoFixtureId } from "../samples/demo-fixtures";
import type { ThemePreference } from "./useTheme";
import { WORKBENCH_MODES, type WorkbenchMode } from "./workbench-mode";

const THEMES: readonly ThemePreference[] = ["system", "light", "dark"];

function ThemeIcon({ theme, active }: Readonly<{ theme: ThemePreference; active: boolean }>) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5 } as const;
  if (theme === "system") return <svg {...common} aria-hidden="true">
    <rect x="3.25" y="4.25" width="17.5" height="12.5" rx="2" fill={active ? "currentColor" : "none"} />
    <path d="M8.5 20h7M12 16.75V20" />
  </svg>;
  if (theme === "light") return <svg {...common} aria-hidden="true">
    <circle cx="12" cy="12" r="3.5" fill={active ? "currentColor" : "none"} />
    <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.72 5.28l-1.42 1.42M6.7 17.3l-1.42 1.42M18.72 18.72l-1.42-1.42M6.7 6.7 5.28 5.28" />
  </svg>;
  return <svg {...common} aria-hidden="true">
    <path d="M20.25 15.35A8.5 8.5 0 0 1 8.65 3.75a8.5 8.5 0 1 0 11.6 11.6Z" fill={active ? "currentColor" : "none"} />
  </svg>;
}

export interface WorkbenchHeaderProps {
  readonly capability: GpuCapability;
  readonly theme: ThemePreference;
  readonly mode: WorkbenchMode;
  readonly fixtureId: DemoFixtureId;
  readonly onModeChange: (mode: WorkbenchMode) => void;
  readonly onFixtureChange: (fixture: DemoFixtureId) => void;
  readonly onThemeChange: (theme: ThemePreference) => void;
}

export function WorkbenchHeader({
  capability,
  theme,
  mode,
  fixtureId,
  onModeChange,
  onFixtureChange,
  onThemeChange,
}: WorkbenchHeaderProps) {
  return (
    <header className="workbench-header">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">SE</span>
        <div><h1>Structural Evolution</h1><p>{DEMO_FIXTURES[fixtureId].tagline}</p></div>
      </div>
      <label className="fixture-select">
        <span>Demo assembly</span>
        <select
          aria-label="Demo assembly"
          value={fixtureId}
          onChange={(event) => onFixtureChange(event.target.value as DemoFixtureId)}
        >
          {Object.values(DEMO_FIXTURES).map((fixture) => (
            <option key={fixture.id} value={fixture.id}>{fixture.label}</option>
          ))}
        </select>
      </label>
      <nav className="workflow-navigation" aria-label="Engineering workflow">
        {WORKBENCH_MODES.map((item) => <button
          type="button"
          key={item.id}
          aria-current={mode === item.id ? "step" : undefined}
          onClick={() => onModeChange(item.id)}
        ><span aria-hidden="true">{item.step}</span>{item.label}</button>)}
      </nav>
      <div className="header-status" role="status">
        <span className={`status-dot status-dot--${capability.status}`} aria-hidden="true" />
        <span>Compute {capability.status}</span>
      </div>
      <div className="theme-switch" role="group" aria-label="Appearance">
        {THEMES.map((item) => <button
          type="button"
          key={item}
          aria-label={`Use ${item} theme`}
          aria-pressed={theme === item}
          title={`${item[0]!.toUpperCase()}${item.slice(1)} theme`}
          onClick={() => onThemeChange(item)}
        ><ThemeIcon theme={item} active={theme === item} /></button>)}
      </div>
    </header>
  );
}
