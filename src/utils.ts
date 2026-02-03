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
 * Parses a string flag value as boolean.
 * Recognises 'true', '1', 'yes', 'on' (case-insensitive, trimmed).
 */
export function parseBooleanFlag(raw: string | undefined): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

/**
 * Returns a promise that resolves after the given milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
