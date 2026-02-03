import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isARealObject, isStringOrNull, parseBooleanFlag, sleep } from '../src/utils';

describe('isARealObject', (): void => {
  it('should return true for plain objects', (): void => {
    expect(isARealObject({})).toBe(true);
    expect(isARealObject({ key: 'value' })).toBe(true);
    expect(isARealObject({ nested: { object: true } })).toBe(true);
  });

  it('should return false for null', (): void => {
    expect(isARealObject(null)).toBe(false);
  });

  it('should return false for undefined', (): void => {
    expect(isARealObject(undefined)).toBe(false);
  });

  it('should return false for arrays', (): void => {
    expect(isARealObject([])).toBe(false);
    expect(isARealObject([1, 2, 3])).toBe(false);
    expect(isARealObject(['a', 'b'])).toBe(false);
  });

  it('should return true for Date objects (typeof object, not null, not array)', (): void => {
    expect(isARealObject(new Date())).toBe(true);
  });

  it('should return false for numbers', (): void => {
    expect(isARealObject(0)).toBe(false);
    expect(isARealObject(42)).toBe(false);
    expect(isARealObject(-1)).toBe(false);
    expect(isARealObject(NaN)).toBe(false);
  });

  it('should return false for strings', (): void => {
    expect(isARealObject('')).toBe(false);
    expect(isARealObject('hello')).toBe(false);
  });

  it('should return false for booleans', (): void => {
    expect(isARealObject(true)).toBe(false);
    expect(isARealObject(false)).toBe(false);
  });
});

describe('isStringOrNull', (): void => {
  it('should return true for null', (): void => {
    expect(isStringOrNull(null)).toBe(true);
  });

  it('should return true for strings', (): void => {
    expect(isStringOrNull('')).toBe(true);
    expect(isStringOrNull('hello')).toBe(true);
    expect(isStringOrNull('   ')).toBe(true);
  });

  it('should return false for undefined', (): void => {
    expect(isStringOrNull(undefined)).toBe(false);
  });

  it('should return false for numbers', (): void => {
    expect(isStringOrNull(0)).toBe(false);
    expect(isStringOrNull(42)).toBe(false);
    expect(isStringOrNull(-1)).toBe(false);
  });

  it('should return false for objects', (): void => {
    expect(isStringOrNull({})).toBe(false);
    expect(isStringOrNull({ key: 'value' })).toBe(false);
  });

  it('should return false for arrays', (): void => {
    expect(isStringOrNull([])).toBe(false);
    expect(isStringOrNull(['a', 'b'])).toBe(false);
  });

  it('should return false for booleans', (): void => {
    expect(isStringOrNull(true)).toBe(false);
    expect(isStringOrNull(false)).toBe(false);
  });
});

describe('parseBooleanFlag', (): void => {
  describe('true cases', (): void => {
    const trueCases: Array<{ input: string | undefined; description: string }> = [
      { input: 'true', description: 'lowercase "true"' },
      { input: 'TRUE', description: 'uppercase "TRUE"' },
      { input: 'True', description: 'mixed case "True"' },
      { input: '1', description: 'string "1"' },
      { input: 'yes', description: 'lowercase "yes"' },
      { input: 'YES', description: 'uppercase "YES"' },
      { input: 'on', description: 'lowercase "on"' },
      { input: 'ON', description: 'uppercase "ON"' },
      { input: '  true  ', description: 'padded "  true  "' },
      { input: '  TRUE  ', description: 'padded "  TRUE  "' },
      { input: '  1  ', description: 'padded "  1  "' },
    ];

    trueCases.forEach(({ input, description }): void => {
      it(`should return true for ${description}`, (): void => {
        expect(parseBooleanFlag(input)).toBe(true);
      });
    });
  });

  describe('false cases', (): void => {
    const falseCases: Array<{ input: string | undefined; description: string }> = [
      { input: undefined, description: 'undefined' },
      { input: '', description: 'empty string' },
      { input: '   ', description: 'whitespace only' },
      { input: 'false', description: 'string "false"' },
      { input: 'False', description: 'string "False"' },
      { input: 'FALSE', description: 'string "FALSE"' },
      { input: '0', description: 'string "0"' },
      { input: 'no', description: 'string "no"' },
      { input: 'NO', description: 'string "NO"' },
      { input: 'off', description: 'string "off"' },
      { input: 'OFF', description: 'string "OFF"' },
      { input: 'random', description: 'random string' },
      { input: 'garbage', description: 'garbage input' },
      { input: '2', description: 'string "2"' },
    ];

    falseCases.forEach(({ input, description }): void => {
      it(`should return false for ${description}`, (): void => {
        expect(parseBooleanFlag(input)).toBe(false);
      });
    });
  });
});

describe('sleep', (): void => {
  beforeEach((): void => {
    vi.useFakeTimers();
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  it('should resolve after the specified time', async (): Promise<void> => {
    const promise = sleep(1000);

    // Should not resolve immediately
    let resolved = false;
    void promise.then((): void => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    // Advance timers by less than the sleep duration
    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toBe(false);

    // Advance timers to complete the sleep
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    expect(resolved).toBe(true);
  });

  it('should resolve with undefined', async (): Promise<void> => {
    const promise = sleep(100);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result).toBeUndefined();
  });

  it('should handle zero milliseconds', async (): Promise<void> => {
    const promise = sleep(0);
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBeUndefined();
  });
});
