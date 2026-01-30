/**
 * Output Renderer
 * Layer: infra
 *
 * Provided ports:
 *   - output.render
 *
 * Generates summary for GitHub step summary and console.
 */
import type { SummaryData, ReducerState, PollLogEntry } from './types';
export interface RenderResult {
    /** Markdown for step summary */
    markdown: string;
    /** Plain text for console */
    console: string;
}
/**
 * Renders the summary data to markdown and console formats.
 *
 * @param data - Summary data to render
 */
export declare function render(data: SummaryData): RenderResult;
/**
 * Renders full markdown summary for $GITHUB_STEP_SUMMARY.
 */
export declare function renderMarkdown(data: SummaryData): string;
/**
 * Renders concise console output.
 */
export declare function renderConsole(data: SummaryData): string;
/**
 * Writes markdown to GitHub step summary.
 */
export declare function writeStepSummary(markdown: string): void;
/**
 * Renders a detailed diagnostic `<details>` block for the step summary.
 * Includes bucket summary, poll timeline with quiet-poll gap rows, and
 * window crossing details.
 *
 * Intended to be called from post.ts after state is finalized (final poll
 * done, markStopped called) so the data is complete.
 */
export declare function renderDiagnostics(state: ReducerState, pollLog: PollLogEntry[]): string;
/**
 * Generates warnings based on state analysis.
 */
export declare function generateWarnings(state: ReducerState): string[];
