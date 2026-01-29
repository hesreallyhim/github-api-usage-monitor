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

import * as os from 'os';
import type { Platform, PlatformInfo } from './types';

// -----------------------------------------------------------------------------
// Port: platform.detect
// -----------------------------------------------------------------------------

/**
 * Detects the current platform.
 */
export function detect(): Platform {
  const platform = os.platform();
  switch (platform) {
    case 'linux':
      return 'linux';
    case 'darwin':
      return 'darwin';
    case 'win32':
      return 'win32';
    default:
      return 'unknown';
  }
}

// -----------------------------------------------------------------------------
// Port: platform.isSupported
// -----------------------------------------------------------------------------

/**
 * Checks if the current platform is supported for v1.
 * Returns detailed info including reason if unsupported.
 */
export function isSupported(): PlatformInfo {
  const platform = detect();

  switch (platform) {
    case 'linux':
      return { platform, supported: true };

    case 'darwin':
      return { platform, supported: true };

    case 'win32':
      return {
        platform,
        supported: false,
        reason:
          'Windows is not supported in v1. Background process lifecycle differs from POSIX systems.',
      };

    default:
      return {
        platform,
        supported: false,
        reason: `Unknown platform: ${os.platform()}. Only Linux and macOS are supported.`,
      };
  }
}

/**
 * Validates platform and throws if unsupported.
 * Use this for fail-fast behavior in start mode.
 */
export function assertSupported(): void {
  const info = isSupported();
  if (!info.supported) {
    throw new Error(`Unsupported platform: ${info.reason}`);
  }
}
