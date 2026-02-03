/**
 * Platform Detection
 * Layer: infra
 *
 * Provided ports:
 *   - platform.isSupported
 *   - platform.detect
 *
 * Detects the current platform and validates support for v1.
 * v1 supports Linux and macOS GitHub-hosted runners only.
 */
import type { Platform, PlatformInfo } from './types';
/**
 * Detects the current platform.
 */
export declare function detect(): Platform;
/**
 * Checks if the current platform is supported for v1.
 * Returns detailed info including reason if unsupported.
 */
export declare function isSupported(): PlatformInfo;
/**
 * Validates platform and throws if unsupported.
 * Use this for fail-fast behavior in start mode.
 */
export declare function assertSupported(): void;
