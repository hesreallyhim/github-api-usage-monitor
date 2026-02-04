# Roadmap

# Future enhancements

- [ ] Introduce tracking for "gap seconds" - we can infer the duration of time between each poll and a window reset. We should track and aggregate the time so that we can provide accurate accounting of exactly how many seconds have been skipped over the course of the job. (This would have to be calculated on a per-bucket basis.)
- [ ] Record loop-level poller errors in reducer state (poll_failures/last_error) without adding poll-log entries, to surface negative signal without time-series failure data.
- [ ] Reduce size of test files.
