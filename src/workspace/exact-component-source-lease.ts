import type { DesignDocument } from "../cad/document-schema";
import type { ExactComponentSource } from "./exact-component-source";

export interface ExactComponentSourceLease {
  get(document: DesignDocument): Promise<ExactComponentSource>;
  invalidate(): void;
}

export function createExactComponentSourceLease(
  acquire: (document: DesignDocument, signal: AbortSignal) => Promise<ExactComponentSource>,
  retain: (source: ExactComponentSource, document: DesignDocument) => Promise<void>,
): ExactComponentSourceLease {
  let cache: Readonly<{
    revision: string; controller: AbortController; promise: Promise<ExactComponentSource>;
  }> | undefined;
  return {
    async get(document) {
      if (!cache || cache.revision !== document.revision) {
        cache?.controller.abort();
        const controller = new AbortController();
        cache = { revision: document.revision, controller,
          promise: acquire(document, controller.signal) };
      }
      const source = await cache.promise;
      await retain(source, document);
      return source;
    },
    invalidate() {
      cache?.controller.abort();
      cache = undefined;
    },
  };
}
