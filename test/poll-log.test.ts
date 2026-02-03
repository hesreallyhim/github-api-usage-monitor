import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { PollLogEntry } from '../src/types';

function makeEntry(overrides: Partial<PollLogEntry> = {}): PollLogEntry {
  return {
    timestamp: '2026-01-25T12:00:00.000Z',
    poll_number: 1,
    buckets: {},
    ...overrides,
  };
}

describe('poll-log', (): void => {
  let testDir: string;
  let originalRunnerTemp: string | undefined;

  beforeAll((): void => {
    originalRunnerTemp = process.env['RUNNER_TEMP'];
  });

  afterAll((): void => {
    if (originalRunnerTemp !== undefined) {
      process.env['RUNNER_TEMP'] = originalRunnerTemp;
    } else {
      delete process.env['RUNNER_TEMP'];
    }
  });

  beforeEach((): void => {
    vi.resetModules();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poll-log-test-'));
    process.env['RUNNER_TEMP'] = testDir;
  });

  afterEach((): void => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('appendPollLogEntry writes a single entry as JSONL', async (): Promise<void> => {
    const stateDir = path.join(testDir, 'github-api-usage-monitor');
    fs.mkdirSync(stateDir, { recursive: true });

    const { appendPollLogEntry } = await import('../src/poll-log');
    const entry = makeEntry({ poll_number: 42 });

    appendPollLogEntry(entry);

    const logPath = path.join(stateDir, 'poll-log.jsonl');
    expect(fs.existsSync(logPath)).toBe(true);

    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content).toBe(JSON.stringify(entry) + '\n');
  });

  it('appendPollLogEntry appends multiple entries', async (): Promise<void> => {
    const stateDir = path.join(testDir, 'github-api-usage-monitor');
    fs.mkdirSync(stateDir, { recursive: true });

    const { appendPollLogEntry } = await import('../src/poll-log');
    const entry1 = makeEntry({ poll_number: 1 });
    const entry2 = makeEntry({ poll_number: 2, timestamp: '2026-01-25T12:01:00.000Z' });

    appendPollLogEntry(entry1);
    appendPollLogEntry(entry2);

    const logPath = path.join(stateDir, 'poll-log.jsonl');
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(JSON.stringify(entry1));
    expect(lines[1]).toBe(JSON.stringify(entry2));
  });

  it('readPollLog returns entries from valid JSONL file', async (): Promise<void> => {
    const stateDir = path.join(testDir, 'github-api-usage-monitor');
    fs.mkdirSync(stateDir, { recursive: true });

    const entry1 = makeEntry({ poll_number: 1 });
    const entry2 = makeEntry({ poll_number: 2, timestamp: '2026-01-25T12:01:00.000Z' });

    const logPath = path.join(stateDir, 'poll-log.jsonl');
    fs.writeFileSync(
      logPath,
      JSON.stringify(entry1) + '\n' + JSON.stringify(entry2) + '\n',
      'utf-8',
    );

    const { readPollLog } = await import('../src/poll-log');
    const entries = readPollLog();

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(entry1);
    expect(entries[1]).toEqual(entry2);
  });

  it('readPollLog returns empty array when file does not exist', async (): Promise<void> => {
    const stateDir = path.join(testDir, 'github-api-usage-monitor');
    fs.mkdirSync(stateDir, { recursive: true });

    const { readPollLog } = await import('../src/poll-log');
    const entries = readPollLog();

    expect(entries).toEqual([]);
  });

  it('readPollLog returns empty array for corrupt/invalid JSON file', async (): Promise<void> => {
    const stateDir = path.join(testDir, 'github-api-usage-monitor');
    fs.mkdirSync(stateDir, { recursive: true });

    const logPath = path.join(stateDir, 'poll-log.jsonl');
    fs.writeFileSync(logPath, '{ invalid json }\n{ "also": bad }', 'utf-8');

    const { readPollLog } = await import('../src/poll-log');
    const entries = readPollLog();

    expect(entries).toEqual([]);
  });

  it('appendPollLogEntry swallows errors when directory does not exist', async (): Promise<void> => {
    const nonexistentPath = path.join(testDir, 'this-does-not-exist');
    process.env['RUNNER_TEMP'] = nonexistentPath;

    const { appendPollLogEntry } = await import('../src/poll-log');
    const entry = makeEntry({ poll_number: 99 });

    // Should not throw
    expect((): void => {
      appendPollLogEntry(entry);
    }).not.toThrow();
  });
});
