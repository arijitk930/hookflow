/**
 * Stops waiting for `work` after `ms`. The work itself is not cancelled and may
 * still finish later, so only use this where that is harmless.
 */
export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  try {
    // race() also handles a later rejection of `work`
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
