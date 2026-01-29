# RETRO — Pre/Post Hook Design Decisions

**Date:** 2026-01-29  
**Project:** github-api-usage-monitor  

## Goal

Adopt a pre/post–based action lifecycle so monitoring automatically starts at job start and stops at job end, eliminating the need for users to remember an explicit “stop” step.

## Decisions Made

### 1) Use `pre` + `post` hooks; make `main` a no-op
**Decision:** Move startup to `pre`, keep cleanup/reporting in `post`, and make `main` log a no-op message.  
**Why:**  
- Guarantees full job coverage without forcing step placement.  
- Removes user error risk (forgetting to stop).  
- Aligns with Actions lifecycle semantics.  
**Trade-offs:**  
- Local actions (`uses: ./`) do not run `pre`.  
- Main step appears as cosmetic/no-op.  
**Mitigation:**  
- Self-test uses `owner/repo@sha` instead of `./` so `pre` runs.

### 2) Extract shared start logic into `src/start.ts`
**Decision:** Create `startMonitor()` to be called by the `pre` entry.  
**Why:**  
- Keeps startup logic centralized.  
- Avoids duplicated logic between pre and main.  

### 3) Add a final poll on stop
**Decision:** In `post`, perform one last `/rate_limit` call and reduce the state before stopping.  
**Why:**  
- Short jobs can end before the next 30s poll; final poll captures usage.  
**Trade-offs:**  
- Adds one more API call.  
- If token is unavailable, only a warning is emitted.

### 4) Update self-test to single-step usage via repo ref
**Decision:** Replace `uses: ./` with `uses: ${{ github.repository }}@${{ github.sha }}` and remove explicit stop steps.  
**Why:**  
- Ensures `pre` runs (local actions skip `pre`).  
- Matches real marketplace usage.  
- Prevents double-start/duplicate post cleanup.

### 5) Add pre build output and wire it in `action.yml`
**Decision:** Build `src/pre.ts` into `dist/pre.js` and add `runs.pre` in `action.yml`.  
**Why:**  
- Required for hook-based startup.  

## Alternatives Considered

- **Keep explicit start/stop steps**  
  Rejected due to user error risk and double-start issues in self-tests.

- **Use `main` to start and `post` to stop (no `pre`)**  
  Rejected because it doesn’t capture job start unless the step is first.

## Known Constraints

- Local actions (`uses: ./`) do not execute `pre`.  
  The self-test workflow now uses a repository ref to exercise `pre`.

## Follow-ups (Optional)

- Consider a heartbeat or shorter max-lifetime to reduce orphan risk on self-hosted runners.  
- Document recommended usage in README (single step, no explicit stop).
