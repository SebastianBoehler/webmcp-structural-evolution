import type { ModelContext } from "./protocol";

declare global {
  interface Document {
    readonly modelContext?: ModelContext;
  }
}

export {};
