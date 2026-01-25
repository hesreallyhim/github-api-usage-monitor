/**
 * Output Renderer Tests
 *
 * Tests for summary rendering and warning generation.
 */

import { describe, it, expect } from 'vitest';
import {
  render,
  renderMarkdown,
  renderConsole,
  generateWarnings,
} from '../src/output';
import type { ReducerState, SummaryData } from '../src/types';

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

function makeState(overrides: Partial<ReducerState> = {}): ReducerState {
  return {
    buckets: {},
    started_at_ts: '2026-01-25T12:00:00.000Z',
    stopped_at_ts: '2026-01-25T12:10:00.000Z',
    interval_seconds: 30,
    poll_count: 20,
    poll_failures: 0,
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

    expect(markdown).toContain('No bucket data');
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
    const data = makeSummaryData({
      state: makeState({
        buckets: {
          bucket1: { total_used: 100 } as any,
          bucket2: { total_used: 80 } as any,
          bucket3: { total_used: 60 } as any,
          bucket4: { total_used: 40 } as any,
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
    const state = makeState({
      buckets: {
        core: {
          anomalies: 3,
        } as any,
      },
    });
    const warnings = generateWarnings(state);

    expect(warnings).toContainEqual(expect.stringContaining('3 anomaly'));
  });

  it('warns on multiple window crosses', () => {
    const state = makeState({
      buckets: {
        search: {
          windows_crossed: 5,
          anomalies: 0,
          total_used: 0,
        } as any,
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

  it('returns empty array when no issues', () => {
    const state = makeState({
      poll_failures: 0,
      last_error: null,
      buckets: {
        core: {
          anomalies: 0,
          windows_crossed: 0,
        } as any,
      },
    });
    const warnings = generateWarnings(state);

    expect(warnings).toHaveLength(0);
  });
});
