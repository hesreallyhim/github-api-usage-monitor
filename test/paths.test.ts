/**
 * Paths Module Tests
 *
 * Tests for path resolution functions that depend on RUNNER_TEMP environment variable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getStateDir,
  getStatePath,
  getPidPath,
  getPollLogPath,
  getStateTmpPath,
} from '../src/paths';

describe('paths', () => {
  let originalRunnerTemp: string | undefined;

  beforeAll((): void => {
    // Save original RUNNER_TEMP
    originalRunnerTemp = process.env['RUNNER_TEMP'];
  });

  afterAll((): void => {
    // Restore original RUNNER_TEMP
    if (originalRunnerTemp !== undefined) {
      process.env['RUNNER_TEMP'] = originalRunnerTemp;
    } else {
      delete process.env['RUNNER_TEMP'];
    }
  });

  it('getStateDir returns correct path when RUNNER_TEMP is set', (): void => {
    process.env['RUNNER_TEMP'] = '/tmp/test-runner';

    const result = getStateDir();

    expect(result).toBe('/tmp/test-runner/github-api-usage-monitor');
  });

  it('getStateDir throws when RUNNER_TEMP is not set', (): void => {
    delete process.env['RUNNER_TEMP'];

    expect(() => getStateDir()).toThrow('RUNNER_TEMP environment variable is not set');
  });

  it('getStatePath joins state dir + state.json', (): void => {
    process.env['RUNNER_TEMP'] = '/tmp/test-runner';

    const result = getStatePath();

    expect(result).toBe('/tmp/test-runner/github-api-usage-monitor/state.json');
  });

  it('getPidPath joins state dir + poller.pid', (): void => {
    process.env['RUNNER_TEMP'] = '/tmp/test-runner';

    const result = getPidPath();

    expect(result).toBe('/tmp/test-runner/github-api-usage-monitor/poller.pid');
  });

  it('getPollLogPath joins state dir + poll-log.jsonl', (): void => {
    process.env['RUNNER_TEMP'] = '/tmp/test-runner';

    const result = getPollLogPath();

    expect(result).toBe('/tmp/test-runner/github-api-usage-monitor/poll-log.jsonl');
  });

  it('getStateTmpPath joins state dir + state.json.tmp', (): void => {
    process.env['RUNNER_TEMP'] = '/tmp/test-runner';

    const result = getStateTmpPath();

    expect(result).toBe('/tmp/test-runner/github-api-usage-monitor/state.json.tmp');
  });
});
