export class FileOperationQueue {
  private current: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const ready = this.current.catch(() => undefined);
    const next = ready.then(operation);
    this.current = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}
