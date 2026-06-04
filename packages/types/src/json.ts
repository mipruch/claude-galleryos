/**
 * `Jsonify<T>` — the shape a value takes after `JSON.stringify` → `JSON.parse`.
 *
 * The server returns Drizzle rows from its REST handlers via `JSON.stringify`,
 * which turns `Date` columns into ISO strings. The UI therefore receives a
 * *serialized* view of each row, not the in-memory row. Applying `Jsonify` to a
 * row type gives the exact wire shape, so FE and BE share one definition while
 * still being honest about `Date → string`.
 */
export type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;
