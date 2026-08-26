import type { ReactNode } from "react";

export type DrawerView = "evidence" | "branches" | "history" | "agents";

interface DrawerItem {
  readonly id: DrawerView;
  readonly label: string;
  readonly count?: number;
  readonly content: ReactNode;
}

export interface WorkbenchDrawerProps {
  readonly active?: DrawerView;
  readonly items: readonly DrawerItem[];
  readonly onChange: (view: DrawerView | undefined) => void;
}

export function WorkbenchDrawer({ active, items, onChange }: WorkbenchDrawerProps) {
  return (
    <div className="workbench-drawer" data-expanded={Boolean(active)}>
      <nav className="drawer-tabs" aria-label="Workbench panels">
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={active === item.id}
            onClick={() => onChange(active === item.id ? undefined : item.id)}
          >
            {item.label}{item.count !== undefined && <span>{item.count}</span>}
          </button>
        ))}
      </nav>
      {items.map((item) => (
        <section
          className="drawer-content"
          aria-label={item.label}
          hidden={active !== item.id}
          key={item.id}
        >
          <div className="drawer-heading">
            <h2>{item.label}</h2>
            <button className="icon-button" type="button" onClick={() => onChange(undefined)} aria-label={`Close ${item.label}`}>×</button>
          </div>
          <div className="drawer-scroll">{item.content}</div>
        </section>
      ))}
    </div>
  );
}
