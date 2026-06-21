/** Normalise any thrown value to a message string. */
export const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
