/**
 * Platform Detection Tests
 *
 * Tests for OS detection and support validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';

// We need to mock os.platform before importing the module
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    platform: vi.fn(),
  };
});

import { detect, isSupported, assertSupported } from '../src/platform';

describe('detect', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns linux for linux platform', () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    expect(detect()).toBe('linux');
  });

  it('returns darwin for macOS platform', () => {
    vi.mocked(os.platform).mockReturnValue('darwin');
    expect(detect()).toBe('darwin');
  });

  it('returns win32 for Windows platform', () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    expect(detect()).toBe('win32');
  });

  it('returns unknown for unrecognized platform', () => {
    vi.mocked(os.platform).mockReturnValue('freebsd' as NodeJS.Platform);
    expect(detect()).toBe('unknown');
  });
});

describe('isSupported', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns supported=true for linux', () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    const info = isSupported();

    expect(info.supported).toBe(true);
    expect(info.platform).toBe('linux');
    expect(info.reason).toBeUndefined();
  });

  it('returns supported=true for darwin', () => {
    vi.mocked(os.platform).mockReturnValue('darwin');
    const info = isSupported();

    expect(info.supported).toBe(true);
    expect(info.platform).toBe('darwin');
  });

  it('returns supported=false for win32 with reason', () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    const info = isSupported();

    expect(info.supported).toBe(false);
    expect(info.platform).toBe('win32');
    expect(info.reason).toContain('Windows');
  });

  it('returns supported=false for unknown with reason', () => {
    vi.mocked(os.platform).mockReturnValue('freebsd' as NodeJS.Platform);
    const info = isSupported();

    expect(info.supported).toBe(false);
    expect(info.platform).toBe('unknown');
    expect(info.reason).toContain('Unknown platform');
  });
});

describe('assertSupported', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('does not throw for linux', () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    expect(() => assertSupported()).not.toThrow();
  });

  it('does not throw for darwin', () => {
    vi.mocked(os.platform).mockReturnValue('darwin');
    expect(() => assertSupported()).not.toThrow();
  });

  it('throws for win32', () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    expect(() => assertSupported()).toThrow('Unsupported platform');
  });

  it('throws for unknown platform', () => {
    vi.mocked(os.platform).mockReturnValue('freebsd' as NodeJS.Platform);
    expect(() => assertSupported()).toThrow('Unsupported platform');
  });
});
