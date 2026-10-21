/**
 * Runs tasks at most `limit` at a time, in the order they come. The first failure stops it: no task
 * starts after it, and `done` rejects with it.
 */
export function pool(limit: number) {
  let running = 0;
  let failure: { error: unknown } | undefined;
  const waiting: (() => void)[] = [];
  const tasks: Promise<unknown>[] = [];
  const next = () => {
    while (running < limit && waiting.length > 0) {
      running++;
      waiting.shift()!();
    }
  };
  return {
    /** Schedules the task; its result. A failure is `done`'s to report, so it is never left unhandled. */
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = new Promise<T>((resolve, reject) => {
        waiting.push(() => {
          (failure ? Promise.reject(failure.error) : task())
            .then(resolve, (error: unknown) => {
              failure ??= { error };
              reject(error);
            })
            .finally(() => {
              running--;
              next();
            });
        });
      });
      result.catch(() => {});
      tasks.push(result);
      next();
      return result;
    },
    get failed(): boolean {
      return failure !== undefined;
    },
    /** Once every task scheduled, even while waiting, is done; the first failure, if any. */
    async done(): Promise<void> {
      for (let seen = -1; seen !== tasks.length;) {
        seen = tasks.length;
        await Promise.allSettled(tasks);
      }
      if (failure) throw failure.error;
    },
  };
}

/**
 * At most `limit` tasks at a time, the others waiting their turn; unlike `pool`, one failing stops nothing.
 * Wraps each task: `const limited = limit(32); await limited(() => fetch(url))`.
 */
export function limit(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
    try {
      return await task();
    } finally {
      // The slot goes to the next one waiting, or is free again.
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}
