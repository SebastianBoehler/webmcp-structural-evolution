import type { FoundationBranch } from "../webmcp/schemas";

export interface AlternativeSelectorProps {
  readonly alternatives: readonly FoundationBranch[];
  readonly selected?: string;
  readonly onSelect: (revision: string) => void;
}

export function AlternativeSelector({ alternatives, selected, onSelect }: AlternativeSelectorProps) {
  if (alternatives.length === 0) return null;
  return (
    <div className="alternative-selector" aria-label="Rendered alternatives">
      {alternatives.map((branch, index) => (
        <button
          type="button"
          key={branch.branchRevision}
          aria-pressed={selected === branch.branchRevision}
          onClick={() => onSelect(branch.branchRevision)}
        >Alternative {index + 1}</button>
      ))}
    </div>
  );
}
