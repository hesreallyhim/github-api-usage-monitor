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
 * Parses a string flag value as boolean.
 * Recognises 'true', '1', 'yes', 'on' (case-insensitive, trimmed).
 */
export declare function parseBooleanFlag(raw: string | undefined): boolean;
/**
 * Returns a promise that resolves after the given milliseconds.
 */
export declare function sleep(ms: number): Promise<void>;
