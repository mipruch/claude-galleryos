export class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.chain;
    this.chain = previous.then(() => next);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class MutexMap {
  private map = new Map<string, AsyncMutex>();

  for(key: string): AsyncMutex {
    let m = this.map.get(key);
    if (!m) {
      m = new AsyncMutex();
      this.map.set(key, m);
    }
    return m;
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}
