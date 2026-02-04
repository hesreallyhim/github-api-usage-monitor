/**
 * Output Renderer Tests
 *
 * Tests for summary rendering and warning generation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  renderMarkdown,
  renderConsole,
  generateWarnings,
  writeStepSummary,
} from '../src/output';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ReducerState, SummaryData } from '../src/types';

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

function makeState(overrides: Partial<ReducerState> = {}): ReducerState {
  return {
    buckets: {},
    started_at_ts: '2026-01-25T12:00:00.000Z',
    stopped_at_ts: '2026-01-25T12:10:00.000Z',
    poller_started_at_ts: null,
    interval_seconds: 30,
    poll_count: 20,
    poll_failures: 0,
    secondary_rate_limit_hits: 0,
    last_error: null,
    ...overrides,
  };
}

function makeSummaryData(overrides: Partial<SummaryData> = {}): SummaryData {
  return {
    state: makeState(),
    duration_seconds: 600,
    warnings: [],
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// render tests
// -----------------------------------------------------------------------------

describe('render', () => {
  it('returns both markdown and console output', () => {
    const data = makeSummaryData();
    const result = render(data);

    expect(result.markdown).toBeDefined();
    expect(result.console).toBeDefined();
    expect(typeof result.markdown).toBe('string');
    expect(typeof result.console).toBe('string');
  });
});

// -----------------------------------------------------------------------------
// renderMarkdown tests
// -----------------------------------------------------------------------------

describe('renderMarkdown', () => {
  it('includes header', () => {
    const markdown = renderMarkdown(makeSummaryData());

    expect(markdown).toContain('GitHub API Usage (Monitor)');
    expect(markdown).toContain('Job Summary');
  });

  it('includes duration and poll counts', () => {
    const data = makeSummaryData({
      duration_seconds: 600,
      state: makeState({ poll_count: 20, poll_failures: 2 }),
    });
    const markdown = renderMarkdown(data);

    expect(markdown).toContain('10m');
    expect(markdown).toContain('20');
    expect(markdown).toContain('2');
  });

  it('includes bucket table when buckets exist', () => {
    const data = makeSummaryData({
      state: makeState({
        buckets: {
          core: {
            last_reset: 1706230800,
            last_used: 500,
            total_used: 450,
            windows_crossed: 0,
            anomalies: 0,
            last_seen_ts: '2026-01-25T12:10:00.000Z',
            limit: 5000,
            remaining: 4500,
          },
        },
      }),
    });
    const markdown = renderMarkdown(data);

    expect(markdown).toContain('| Bucket |');
    expect(markdown).toContain('core');
    expect(markdown).toContain('450');
    expect(markdown).toContain('4500');
  });

  it('sorts buckets by total_used descending', () => {
    const data = makeSummaryData({
      state: makeState({
        buckets: {
          low: {
            last_reset: 1706230800,
            last_used: 10,
            total_used: 10,
            windows_crossed: 0,
            anomalies: 0,
            last_seen_ts: 'ts',
            limit: 5000,
            remaining: 4990,
          },
          high: {
            last_reset: 1706230800,
            last_used: 500,
            total_used: 500,
            windows_crossed: 0,
            anomalies: 0,
            last_seen_ts: 'ts',
            limit: 5000,
            remaining: 4500,
          },
        },
      }),
    });
    const markdown = renderMarkdown(data);

    const highIndex = markdown.indexOf('high');
    const lowIndex = markdown.indexOf('low');
    expect(highIndex).toBeLessThan(lowIndex);
  });

  it('includes warnings section when warnings exist', () => {
    const data = makeSummaryData({
      warnings: ['Warning 1', 'Warning 2'],
    });
    const markdown = renderMarkdown(data);

    expect(markdown).toContain('### Warnings');
    expect(markdown).toContain('Warning 1');
    expect(markdown).toContain('Warning 2');
  });

  it('omits warnings section when no warnings', () => {
    const data = makeSummaryData({ warnings: [] });
    const markdown = renderMarkdown(data);

    expect(markdown).not.toContain('### Warnings');
  });

  it('shows message when no bucket data', () => {
    const data = makeSummaryData({ state: makeState({ buckets: {} }) });
    const markdown = renderMarkdown(data);

    expect(markdown).toContain('No API usage detected');
  });

  it('only shows active buckets (total_used > 0) in table', () => {
    const idleBucket = {
      last_reset: 1706230800,
      last_used: 0,
      total_used: 0,
      windows_crossed: 0,
      anomalies: 0,
      last_seen_ts: 'ts',
      limit: 5000,
      remaining: 5000,
    };
    const activeBucket = {
      last_reset: 1706230800,
      last_used: 50,
      total_used: 50,
      windows_crossed: 0,
      anomalies: 0,
      last_seen_ts: 'ts',
      limit: 5000,
      remaining: 4950,
    };
    const data = makeSummaryData({
      state: makeState({
        buckets: {
          core: activeBucket,
          search: activeBucket,
          graphql: activeBucket,
          // These 10 idle buckets should NOT appear in the table
          code_scanning_upload: idleBucket,
          actions_runner_registration: idleBucket,
          scim: idleBucket,
          dependency_snapshots: idleBucket,
          code_search: idleBucket,
          audit_log: idleBucket,
          source_import: idleBucket,
          integration_manifest: idleBucket,
          packages: idleBucket,
          dependency_graph: idleBucket,
        },
      }),
    });
    const markdown = renderMarkdown(data);

    // Active buckets appear
    expect(markdown).toContain('core');
    expect(markdown).toContain('search');
    expect(markdown).toContain('graphql');
    // Idle buckets do not appear
    expect(markdown).not.toContain('scim');
    expect(markdown).not.toContain('audit_log');
    expect(markdown).not.toContain('packages');
  });

  it('shows no-usage message when all buckets are idle', () => {
    const idleBucket = {
      last_reset: 1706230800,
      last_used: 0,
      total_used: 0,
      windows_crossed: 0,
      anomalies: 0,
      last_seen_ts: 'ts',
      limit: 5000,
      remaining: 5000,
    };
    const data = makeSummaryData({
      state: makeState({
        buckets: {
          core: idleBucket,
          search: idleBucket,
        },
      }),
    });
    const markdown = renderMarkdown(data);

    expect(markdown).toContain('No API usage detected');
    expect(markdown).not.toContain('| Bucket |');
  });
});

// -----------------------------------------------------------------------------
// renderConsole tests
// -----------------------------------------------------------------------------

describe('renderConsole', () => {
  it('includes one-line summary with total usage', () => {
    const data = makeSummaryData({
      state: makeState({
        poll_count: 20,
        buckets: {
          core: {
            last_reset: 1706230800,
            last_used: 100,
            total_used: 100,
            windows_crossed: 0,
            anomalies: 0,
            last_seen_ts: 'ts',
            limit: 5000,
            remaining: 4900,
          },
        },
      }),
      duration_seconds: 600,
    });
    const consoleText = renderConsole(data);

    expect(consoleText).toContain('100 requests');
    expect(consoleText).toContain('10m');
    expect(consoleText).toContain('20 polls');
  });

  it('shows top 3 buckets', () => {
    const baseBucket = {
      last_reset: 1706230800,
      last_used: 0,
      windows_crossed: 0,
      anomalies: 0,
      last_seen_ts: 'ts',
      limit: 5000,
      remaining: 5000,
    };
    const data = makeSummaryData({
      state: makeState({
        buckets: {
          bucket1: { ...baseBucket, total_used: 100, remaining: 4900 },
          bucket2: { ...baseBucket, total_used: 80, remaining: 4920 },
          bucket3: { ...baseBucket, total_used: 60, remaining: 4940 },
          bucket4: { ...baseBucket, total_used: 40, remaining: 4960 },
        },
      }),
    });
    const consoleText = renderConsole(data);

    expect(consoleText).toContain('bucket1');
    expect(consoleText).toContain('bucket2');
    expect(consoleText).toContain('bucket3');
    expect(consoleText).not.toContain('bucket4');
  });

  it('includes warning count when warnings exist', () => {
    const data = makeSummaryData({ warnings: ['w1', 'w2', 'w3'] });
    const consoleText = renderConsole(data);

    expect(consoleText).toContain('Warnings: 3');
  });
});

// -----------------------------------------------------------------------------
// generateWarnings tests
// -----------------------------------------------------------------------------

describe('generateWarnings', () => {
  it('warns on poll failures', () => {
    const state = makeState({ poll_failures: 5 });
    const warnings = generateWarnings(state);

    expect(warnings).toContainEqual(expect.stringContaining('5 poll'));
    expect(warnings).toContainEqual(expect.stringContaining('failed'));
  });

  it('warns on anomalies', () => {
    const baseBucket = {
      last_reset: 1706230800,
      last_used: 0,
      total_used: 0,
      windows_crossed: 0,
      last_seen_ts: 'ts',
      limit: 5000,
      remaining: 5000,
    };
    const state = makeState({
      buckets: {
        core: { ...baseBucket, anomalies: 3 },
      },
    });
    const warnings = generateWarnings(state);

    expect(warnings).toContainEqual(expect.stringContaining('3 anomaly'));
  });

  it('warns on secondary rate limit hits', () => {
    const state = makeState({ secondary_rate_limit_hits: 2 });
    const warnings = generateWarnings(state);

    expect(warnings).toContainEqual(
      expect.stringContaining('Secondary rate limit warning response was received (2 times)'),
    );
  });

  it('warns on multiple window crosses for active buckets', () => {
    const baseBucket = {
      last_reset: 1706230800,
      last_used: 50,
      total_used: 100,
      anomalies: 0,
      last_seen_ts: 'ts',
      limit: 5000,
      remaining: 4950,
    };
    const state = makeState({
      buckets: {
        search: { ...baseBucket, windows_crossed: 5 },
      },
    });
    const warnings = generateWarnings(state);

    expect(warnings).toContainEqual(expect.stringContaining('search'));
    expect(warnings).toContainEqual(expect.stringContaining('5 times'));
  });

  it('includes last error if present', () => {
    const state = makeState({ last_error: 'Network timeout' });
    const warnings = generateWarnings(state);

    expect(warnings).toContainEqual(expect.stringContaining('Network timeout'));
  });

  it('does NOT warn about window crosses on idle buckets (total_used = 0)', () => {
    const state = makeState({
      buckets: {
        code_scanning_upload: {
          last_reset: 1706230800,
          last_used: 0,
          total_used: 0,
          windows_crossed: 3, // idle bucket with window rotations
          anomalies: 0,
          last_seen_ts: 'ts',
          limit: 5000,
          remaining: 5000,
        },
      },
    });
    const warnings = generateWarnings(state);

    // Should NOT contain a window-crossing warning for an idle bucket
    const windowWarnings = warnings.filter((w) => w.includes('window'));
    expect(windowWarnings).toHaveLength(0);
  });

  it('DOES warn about window crosses on active buckets', () => {
    const state = makeState({
      buckets: {
        core: {
          last_reset: 1706230800,
          last_used: 100,
          total_used: 200,
          windows_crossed: 2,
          anomalies: 0,
          last_seen_ts: 'ts',
          limit: 5000,
          remaining: 4900,
        },
      },
    });
    const warnings = generateWarnings(state);

    expect(warnings).toContainEqual(expect.stringContaining('core'));
    expect(warnings).toContainEqual(expect.stringContaining('2 times'));
  });

  it('returns empty array when no issues', () => {
    const baseBucket = {
      last_reset: 1706230800,
      last_used: 0,
      total_used: 0,
      last_seen_ts: 'ts',
      limit: 5000,
      remaining: 5000,
    };
    const state = makeState({
      poll_failures: 0,
      last_error: null,
      buckets: {
        core: { ...baseBucket, anomalies: 0, windows_crossed: 0 },
      },
    });
    const warnings = generateWarnings(state);

    expect(warnings).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// writeStepSummary tests
// -----------------------------------------------------------------------------

describe('writeStepSummary', () => {
  let originalEnv: string | undefined;
  let tempDir: string;

  beforeEach((): void => {
    // Save original environment variable
    originalEnv = process.env['GITHUB_STEP_SUMMARY'];

    // Create temporary directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-step-summary-'));
  });

  afterEach((): void => {
    // Restore original environment variable
    if (originalEnv !== undefined) {
      process.env['GITHUB_STEP_SUMMARY'] = originalEnv;
    } else {
      delete process.env['GITHUB_STEP_SUMMARY'];
    }

    // Cleanup temporary directory
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tempDir, file));
      }
      fs.rmdirSync(tempDir);
    }

    // Restore all mocks
    vi.restoreAllMocks();
  });

  it('appends markdown to GITHUB_STEP_SUMMARY file when env var is set', (): void => {
    const summaryPath = path.join(tempDir, 'summary.md');
    process.env['GITHUB_STEP_SUMMARY'] = summaryPath;

    writeStepSummary('# Hello');

    const content = fs.readFileSync(summaryPath, 'utf-8');
    expect(content).toBe('# Hello\n');
  });

  it('appends multiple writes', (): void => {
    const summaryPath = path.join(tempDir, 'summary.md');
    process.env['GITHUB_STEP_SUMMARY'] = summaryPath;

    writeStepSummary('line1');
    writeStepSummary('line2');

    const content = fs.readFileSync(summaryPath, 'utf-8');
    expect(content).toBe('line1\nline2\n');
  });

  it('does nothing when GITHUB_STEP_SUMMARY is not set', (): void => {
    delete process.env['GITHUB_STEP_SUMMARY'];

    // Should not throw
    expect(() => {
      writeStepSummary('anything');
    }).not.toThrow();
  });

  it('does nothing when GITHUB_STEP_SUMMARY is empty string', (): void => {
    process.env['GITHUB_STEP_SUMMARY'] = '';

    // Should not throw
    expect(() => {
      writeStepSummary('anything');
    }).not.toThrow();
  });
});
