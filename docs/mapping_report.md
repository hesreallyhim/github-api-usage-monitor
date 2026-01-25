# PRD → Spec Mapping Report

**Source PRD:** `DESIGN-github-api-usage-monitor.md`
**Generated Spec:** `spec/spec.json`
**Date:** 2026-01-25

---

## Traceability Matrix

### Header Mapping

| PRD Field | Spec Field | Value |
|-----------|------------|-------|
| Title (§1) | `title` | github-api-usage-monitor v1 |
| Status (§1) | `status` | ready_for_implementation |
| Date | `canonical_date` | 2026-01-25 (derived from context) |

### Section Mapping

| PRD Section | Spec Location | Notes |
|-------------|---------------|-------|
| §1 Summary | `prd.summary` | Extracted problem statement |
| §2 Goals | `prd.scope_boundary.in_scope` | 5 goals mapped |
| §2 Non-Goals | `prd.scope_boundary.out_of_scope` | 7 exclusions mapped |
| §3 Operating Model | Incorporated into summary | Key observation about reset windows |
| §4 User Experience | `prd.steel_thread_acceptance` | Workflow pattern documented |
| §5 Architecture | `layers[]` | 4 layers defined |
| §6 High-Level Diagram | `SPEC.md` mermaid | Derived diagram |
| §7 Data Model | `boundary_types[]` | 5 types defined |
| §8 Reducer Algorithm | `requirements.functional` F7, F8 | Core logic captured |
| §9 Outputs | `requirements.functional` F10 | Summary format captured |
| §10 Functional Requirements | `requirements.functional` | 10 requirements extracted |
| §11 Non-Functional Requirements | `requirements.non_functional` | 4 NFRs extracted |
| §12 Risks and Mitigations | `risks[]` | 8 risks mapped |
| §13 Implementation Plan | `layers[].modules[].paths` | File structure captured |
| §14 Testing Strategy | `milestones` M3 | Testing milestone defined |

### Functional Requirements Traceability

| Spec ID | PRD Section | PRD Text (paraphrased) |
|---------|-------------|------------------------|
| F1 | §10.1 | mode=start spawns poller and returns success |
| F2 | §10.1 | mode=stop terminates poller and prints summary |
| F3 | §10.2 | Accept token input; default to github.token |
| F4 | §10.3 + clarification | Poll at 30s intervals (updated from 60s) |
| F5 | §10.4 | Use $RUNNER_TEMP paths for state persistence |
| F6 | Clarification | Track all buckets; user configures which to report |
| F7 | §8 pseudo-code | Include used after reset change |
| F8 | §8 pseudo-code | Detect anomalies when used decreases |
| F9 | Clarification | Periodic state writes for durability |
| F10 | §9 | Output to step summary + console |

### Non-Functional Requirements Traceability

| Spec ID | PRD Section | PRD Text (paraphrased) |
|---------|-------------|------------------------|
| NF1 | §11 Security | No secrets in logs |
| NF2 | §11 Reliability | Poller survives step boundaries |
| NF3 | §11 Performance | Constant-space reducer |
| NF4 | §11 Maintainability | Deterministic, unit-testable |

---

## Clarifications Incorporated

The following clarifications from the user were incorporated into the spec:

1. **Bucket tracking**: All buckets tracked; user specifies which to report (F6)
2. **Initial poll timing**: Immediate poll on startup for baseline + token validation (F4 notes)
3. **Polling interval**: Changed from 60s to 30s to avoid missing 60s reset windows (F4)
4. **Graceful shutdown**: Best-effort state preservation via periodic writes (F9)
5. **State corruption**: Missing fields handled gracefully; unparseable = total loss (documented in implementation notes)
6. **Bundling**: ncc specified for action bundling (M4)

---

## Warnings

### ARCHITECTURE_AMBIGUOUS

- **W1**: PRD §13 lists proposed file structure but does not define explicit module boundaries or ownership. Spec infers layers from logical grouping.
- **W2**: No CODEOWNERS specified. TODO: Define layer owners before v1 release.

### UNCLEAR_PORT_BOUNDARY

- **W3**: The PRD describes "atomic state write" but does not specify the contract. Spec defines `state.read` and `state.write` ports with atomic rename semantics.

### MISSING_DETAIL

- **W4**: PRD mentions "optional single retry" for poll failures but v1 omits retry. Spec captures "no retry in v1" as explicit design choice.
- **W5**: PRD §9 describes summary format but does not specify exact table columns. Spec derives from example in §18.
- **W6**: Poller logging strategy TBD. Recommend adding debug log file for development.

### FORMAT_NORMALIZATION

- **W7**: PRD is not in SP-PRD template format. Mapping performed manually with section-by-section extraction.

---

## TODOs

- [ ] Define CODEOWNERS for each layer before release
- [ ] Decide on poller logging strategy (silent vs. debug log file)
- [ ] Add `report_buckets` input in v2 for user-specified bucket filtering
- [ ] Document minimum interval (30s) in action.yml description

---

## Open Questions (from PRD §15)

Resolved in spec:

| Question | Resolution |
|----------|------------|
| interval_seconds override | v1: no override, fixed at 30s |
| token input only | Confirmed |
| mode input: start/stop | Confirmed |

Deferred to v2+:

- Optional JSONL time series artifact
- Windows support
- Endpoint tracing (opt-in)
- Step correlation (timestamp markers)

---

*Report generated as part of prd-to-specctl transformation*
