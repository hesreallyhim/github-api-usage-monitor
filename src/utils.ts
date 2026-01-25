/**
 * Checks if input is an object and not null.
 */
export const isARealObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

/**
 * Checks if input is a string or null.
 * Used for validating optional string fields in state.
 */
export const isStringOrNull = (value: unknown): value is string | null => {
  return value === null || typeof value === 'string';
};
