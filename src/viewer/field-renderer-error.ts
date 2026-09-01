import type { FieldRendererSession } from "./field-renderer";

export class FieldRendererMountError extends Error {
  constructor(cause: unknown, readonly cleanupSession: FieldRendererSession) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "FieldRendererMountError";
  }
}
