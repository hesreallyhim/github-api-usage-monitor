/**
 * Checks if input is an object and not null.
 */
export declare const isARealObject: (value: unknown) => value is Record<string, unknown>;
/**
 * Checks if input is a string or null.
 * Used for validating optional string fields in state.
 */
export declare const isStringOrNull: (value: unknown) => value is string | null;
/**
 * Returns a promise that resolves after the given milliseconds.
 */
export declare function sleep(ms: number): Promise<void>;
