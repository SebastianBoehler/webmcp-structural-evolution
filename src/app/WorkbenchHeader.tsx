import type { GpuCapability } from "../gpu/capabilities";
import type { ThemePreference } from "./useTheme";
import { WORKBENCH_MODES, type WorkbenchMode } from "./workbench-mode";

export interface WorkbenchHeaderProps {
  readonly capability: GpuCapability;
  readonly theme: ThemePreference;
  readonly mode: WorkbenchMode;
  readonly onModeChange: (mode: WorkbenchMode) => void;
  readonly onThemeChange: (theme: ThemePreference) => void;
}

export function WorkbenchHeader({
  capability,
  theme,
  mode,
  onModeChange,
  onThemeChange,
}: WorkbenchHeaderProps) {
  return (
    <header className="workbench-header">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">SE</span>
        <div><h1>Structural Evolution</h1><p>Agentic quadrotor engineering</p></div>
      </div>
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
      <label className="appearance-select"><span className="visually-hidden">Appearance</span><select
        aria-label="Appearance"
        value={theme}
        onChange={(event) => onThemeChange(event.target.value as ThemePreference)}
      >
        <option value="system">System theme</option>
        <option value="light">Light theme</option>
        <option value="dark">Dark theme</option>
      </select></label>
    </header>
  );
}
