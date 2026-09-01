export interface WorkspaceMutationQueue {
  run<Value>(operation: () => Promise<Value>): Promise<Value>;
}

export function createWorkspaceMutationQueue(): WorkspaceMutationQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    run<Value>(operation: () => Promise<Value>): Promise<Value> {
      const result = tail.then(operation);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
