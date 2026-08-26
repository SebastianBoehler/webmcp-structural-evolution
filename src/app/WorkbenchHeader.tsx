import type { GpuCapability } from "../gpu/capabilities";
import type { ThemePreference } from "./useTheme";

export interface WorkbenchHeaderProps {
  readonly capability: GpuCapability;
  readonly theme: ThemePreference;
  readonly primaryLabel: string;
  readonly primaryDisabled: boolean;
  readonly cancelVisible: boolean;
  readonly onPrimary: () => void;
  readonly onCancel: () => void;
  readonly onThemeChange: (theme: ThemePreference) => void;
  readonly onOpenComponents: () => void;
  readonly onOpenInspector: () => void;
}

export function WorkbenchHeader({
  capability,
  theme,
  primaryLabel,
  primaryDisabled,
  cancelVisible,
  onPrimary,
  onCancel,
  onThemeChange,
  onOpenComponents,
  onOpenInspector,
}: WorkbenchHeaderProps) {
  return (
    <header className="workbench-header">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">SE</span>
        <div><h1>Structural Evolution</h1><p>Quadrotor assembly · East-arm topology study</p></div>
      </div>
      <div className="header-status" role="status">
        <span className={`status-dot status-dot--${capability.status}`} aria-hidden="true" />
        <span>WebGPU {capability.status}</span>
      </div>
      <div className="mobile-panel-actions mobile-only">
        <button type="button" onClick={onOpenComponents}>Components</button>
        <button type="button" onClick={onOpenInspector}>Inspector</button>
      </div>
      <div className="theme-switcher" aria-label="Appearance">
        {(["system", "light", "dark"] as const).map((option) => (
          <button
            type="button"
            key={option}
            aria-pressed={theme === option}
            onClick={() => onThemeChange(option)}
          >{option}</button>
        ))}
      </div>
      {cancelVisible ? (
        <button className="secondary-action" type="button" onClick={onCancel}>Cancel probe</button>
      ) : (
        <button className="primary-action" type="button" disabled={primaryDisabled} onClick={onPrimary}>
          {primaryLabel}
        </button>
      )}
    </header>
  );
}
