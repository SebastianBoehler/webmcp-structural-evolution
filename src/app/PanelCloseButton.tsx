interface PanelCloseButtonProps {
  readonly label: string;
  readonly onClick: () => void;
}

export function PanelCloseButton({ label, onClick }: PanelCloseButtonProps) {
  return <button className="icon-button" type="button" onClick={onClick} aria-label={label}>
    <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20" width="18" height="18">
      <path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  </button>;
}
