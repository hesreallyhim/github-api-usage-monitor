/**
 * Output Renderer
 * Layer: infra
 *
 * Provided ports:
 *   - output.render
 *
 * Generates summary for GitHub step summary and console.
 */
import type { SummaryData, ReducerState } from './types';
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
 * Generates warnings based on state analysis.
 */
export declare function generateWarnings(state: ReducerState): string[];
