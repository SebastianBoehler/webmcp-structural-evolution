import type { ReactNode } from "react";

export type DrawerView = "evidence" | "branches" | "history" | "agents";

export interface DrawerItem {
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
  const selected = items.find(({ id }) => id === active) ?? items[0];
  return (
    <div className="workbench-drawer">
      <nav className="drawer-tabs" aria-label="Workbench panels">
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={selected?.id === item.id}
            onClick={() => onChange(item.id)}
          >
            {item.label}{item.count !== undefined && <span>{item.count}</span>}
          </button>
        ))}
      </nav>
      {items.map((item) => <section
        className="drawer-content"
        aria-label={item.label}
        hidden={selected?.id !== item.id}
        key={item.id}
      >
        <div className="drawer-heading"><h2>{item.label}</h2></div>
        <div className="drawer-scroll">{item.content}</div>
      </section>)}
    </div>
  );
}
