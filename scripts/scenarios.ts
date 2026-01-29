/**
 * Declarative self-test scenario definitions.
 *
 * Each scenario describes a pattern of GitHub API calls and the expected
 * rate-limit bucket deltas the monitor should observe. The generator
 * (`generate-self-test.ts`) reads these definitions and stamps out an
 * identical CI job structure for each one.
 *
 * This file is the single source of truth for what the self-test suite
 * exercises and what constitutes a passing result.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface Endpoint {
  /** URL template — use `${REPO}` as a placeholder for the repository slug. */
  url: string;
  method: "GET" | "POST";
  /** Request body for POST endpoints (e.g. GraphQL query). */
  body?: string;
  /** Content-Type header value for POST endpoints. */
  contentType?: string;
  /** Which rate-limit bucket this endpoint touches. */
  bucket: string;
}

export interface BucketExpectation {
  /** Exact number of API calls we make to this bucket. */
  total_used_delta: number;
  /** Upper bound on the number of rate-limit windows crossed during the scenario. */
  windows_crossed_max: number;
}

/** Associates an endpoint with how many times it should be called. */
export interface EndpointCalls {
  endpoint: Endpoint;
  calls: number;
}

export interface Scenario {
  /** Job-safe identifier (lowercase, hyphens only). */
  id: string;
  /** Human-readable label for the scenario. */
  name: string;
  /** What to call and how many times per endpoint. */
  endpoint_calls: EndpointCalls[];
  /** Seconds to sleep between successive API calls (0 = no sleep). */
  inter_call_sleep_s: number;
  /** Total time (seconds) to let the poller run before inspecting state. */
  poll_duration_s: number;
  /** Per-bucket expectations keyed by bucket name. */
  expected: Record<string, BucketExpectation>;
}

// ---------------------------------------------------------------------------
// Shared endpoint constants
// ---------------------------------------------------------------------------

export const ENDPOINTS = {
  core: {
    url: "https://api.github.com/repos/${REPO}",
    method: "GET" as const,
    bucket: "core",
  },
  search: {
    url: "https://api.github.com/search/repositories?q=test",
    method: "GET" as const,
    bucket: "search",
  },
  code_search: {
    url: "https://api.github.com/search/code?q=test+repo:${REPO}",
    method: "GET" as const,
    bucket: "code_search",
  },
  graphql: {
    url: "https://api.github.com/graphql",
    method: "POST" as const,
    body: '{"query":"{ viewer { login } }"}',
    contentType: "application/json",
    bucket: "graphql",
  },
} as const satisfies Record<string, Endpoint>;

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

/**
 * The complete list of self-test scenarios.
 *
 * Scenarios are executed sequentially (linear chain via `needs:` in the
 * generated workflow). They range from a zero-call baseline through
 * multi-bucket and window-crossing cases, giving high confidence that the
 * monitor correctly tracks deltas and window transitions for every bucket
 * type the GitHub API exposes.
 */
export const SCENARIOS: Scenario[] = [
  // 1 — Infrastructure noise floor (no API calls at all)
  {
    id: "baseline",
    name: "Baseline — zero calls",
    endpoint_calls: [],
    inter_call_sleep_s: 0,
    poll_duration_s: 90,
    expected: {},
  },

  // 2 — Basic core delta counting
  {
    id: "core-5",
    name: "5 core GET calls",
    endpoint_calls: [{ endpoint: ENDPOINTS.core, calls: 5 }],
    inter_call_sleep_s: 2,
    poll_duration_s: 90,
    expected: {
      core: { total_used_delta: 5, windows_crossed_max: 0 },
    },
  },

  // 3 — Linear scaling (double the calls of scenario 2)
  {
    id: "core-10",
    name: "10 core GET calls",
    endpoint_calls: [{ endpoint: ENDPOINTS.core, calls: 10 }],
    inter_call_sleep_s: 1,
    poll_duration_s: 90,
    expected: {
      core: { total_used_delta: 10, windows_crossed_max: 0 },
    },
  },

  // 4 — 60-second bucket counting (search)
  {
    id: "search-2",
    name: "2 search calls",
    endpoint_calls: [{ endpoint: ENDPOINTS.search, calls: 2 }],
    inter_call_sleep_s: 3,
    poll_duration_s: 90,
    expected: {
      search: { total_used_delta: 2, windows_crossed_max: 0 },
    },
  },

  // 5 — Separate code_search bucket
  {
    id: "code-search-2",
    name: "2 code_search calls",
    endpoint_calls: [{ endpoint: ENDPOINTS.code_search, calls: 2 }],
    inter_call_sleep_s: 3,
    poll_duration_s: 90,
    expected: {
      code_search: { total_used_delta: 2, windows_crossed_max: 0 },
    },
  },

  // 6 — GraphQL point counting
  {
    id: "graphql-2",
    name: "2 GraphQL calls",
    endpoint_calls: [{ endpoint: ENDPOINTS.graphql, calls: 2 }],
    inter_call_sleep_s: 3,
    poll_duration_s: 90,
    expected: {
      graphql: { total_used_delta: 2, windows_crossed_max: 0 },
    },
  },

  // 7 — Multi-bucket simultaneous (core + search + graphql, 2 each)
  {
    id: "mixed-small",
    name: "Mixed — 2 core + 2 search + 2 graphql",
    endpoint_calls: [
      { endpoint: ENDPOINTS.core, calls: 2 },
      { endpoint: ENDPOINTS.search, calls: 2 },
      { endpoint: ENDPOINTS.graphql, calls: 2 },
    ],
    inter_call_sleep_s: 2,
    poll_duration_s: 120,
    expected: {
      core: { total_used_delta: 2, windows_crossed_max: 0 },
      search: { total_used_delta: 2, windows_crossed_max: 0 },
      graphql: { total_used_delta: 2, windows_crossed_max: 0 },
    },
  },

  // 8 — Rapid-fire with no inter-call sleep
  {
    id: "core-burst",
    name: "5 core GET calls — burst (no sleep)",
    endpoint_calls: [{ endpoint: ENDPOINTS.core, calls: 5 }],
    inter_call_sleep_s: 0,
    poll_duration_s: 90,
    expected: {
      core: { total_used_delta: 5, windows_crossed_max: 0 },
    },
  },

  // 9 — Force a 60-second window crossing for search
  {
    id: "search-window-cross",
    name: "2 search calls — 65s apart (window crossing)",
    endpoint_calls: [{ endpoint: ENDPOINTS.search, calls: 2 }],
    inter_call_sleep_s: 65,
    poll_duration_s: 150,
    expected: {
      search: { total_used_delta: 2, windows_crossed_max: 1 },
    },
  },

  // 10 — Longer idle period, no API calls
  {
    id: "idle-check",
    name: "Idle check — no calls, 120s observation",
    endpoint_calls: [],
    inter_call_sleep_s: 0,
    poll_duration_s: 120,
    expected: {},
  },

  // 11 — Sequential multi-bucket: 3 core then 2 search
  {
    id: "core-then-search",
    name: "3 core + 2 search (sequential)",
    endpoint_calls: [
      { endpoint: ENDPOINTS.core, calls: 3 },
      { endpoint: ENDPOINTS.search, calls: 2 },
    ],
    inter_call_sleep_s: 2,
    poll_duration_s: 120,
    expected: {
      core: { total_used_delta: 3, windows_crossed_max: 0 },
      search: { total_used_delta: 2, windows_crossed_max: 0 },
    },
  },

  // 12 — Higher GraphQL usage
  {
    id: "graphql-5",
    name: "5 GraphQL calls",
    endpoint_calls: [{ endpoint: ENDPOINTS.graphql, calls: 5 }],
    inter_call_sleep_s: 2,
    poll_duration_s: 90,
    expected: {
      graphql: { total_used_delta: 5, windows_crossed_max: 0 },
    },
  },
];
