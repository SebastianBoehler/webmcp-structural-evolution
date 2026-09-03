export type LayoutState = "verified" | "dragging" | "changed" | "validating";

export interface LayoutAuthority {
  readonly revision: string;
  readonly version: number;
  readonly state: LayoutState;
}

export interface LayoutConflictFact { readonly id: string; readonly kind: string; }

export class LayoutValidationError extends Error {
  constructor(readonly conflicts: readonly LayoutConflictFact[], message = `Assembly validation found ${conflicts.length} blocking conflict(s).`) {
    super(message);
  }
}
