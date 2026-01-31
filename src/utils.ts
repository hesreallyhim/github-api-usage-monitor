/**
 * Checks if input is an object and not null.
 */
export const isARealObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * Checks if input is a string or null.
 * Used for validating optional string fields in state.
 */
export const isStringOrNull = (value: unknown): value is string | null => {
  return value === null || typeof value === 'string';
};

/**
 * Returns a promise that resolves after the given milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
