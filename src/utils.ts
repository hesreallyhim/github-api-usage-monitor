/**
 * Checks if input is an object and not null.
 */
export const isARealObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};
