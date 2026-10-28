// Runtime input stays unknown until the operation's contract has been checked.
export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected object");
  return value as Record<string, unknown>;
}
export function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected string");
  return value;
}
export function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Expected finite number");
  return value;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected array");
  return value;
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export const errorStack = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);
export type IfdefLoader = (
  this: {
    query: { BROWSER: string };
    callback(error: unknown, code: string): void;
  },
  source: string,
) => void;
export function loader(value: unknown): IfdefLoader {
  if (typeof value !== "function")
    throw new Error("ifdef-loader must export a function");
  return value as IfdefLoader;
}
