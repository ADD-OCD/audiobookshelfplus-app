H04: bind queued download credentials to their saved owner

Based on trusted plus d844ca65e78c5f03e63c1aa9b12e4bad0cd7e436.
No PR #23/#29 source is incorporated.

Run with an existing JDK 9+ and Python 3 (no dependency installation):
  python security-tests/run_h04_regressions.py

The runner compiles only DownloadAuthorization.java and its standalone regression
test with --release 8. It does not run Gradle, Android code or network requests.
22 checks pass and four mutants must fail (active-token fallback, owner ID,
request host, registered base path). Tokens/domains are synthetic.

Scope: never fall back to the active server; require the queued configuration ID,
verbatim saved address and user ID to match, with a valid same-origin API-item URL.
Same-owner token rotation, explicit HTTP servers and existing trailing-slash URL
construction remain supported. URI parsing is conservative; non-ASCII/ambiguous
server-address spellings must be normalized/revalidated during integration.

Restore/retry checks precede partial-file resets. An invalid owner is held using
existing failure fields without creating a terminal-failure cleanup deadline;
active non-moving parts are cancelled and records/bytes/progress retained.
Expired cleanup also skips invalid ownership, including before service restore.
Reconnect the original server then retry. Removing/re-adding a server under a new
configuration ID cannot silently rebind an old queue. No queue schema is changed.

Remaining integration work: the manager/cleanup wiring has been statically
reviewed, not run under Android. Test queue restart, retained partial bytes,
finished parts, callbacks, cleanup scheduling, configuration mutation races and
PR #25 compaction. A per-config generation/cancellation coordinator and immutable
enqueue ownership remain in the full H04 specification. This patch does not fix
the separate x-refresh-token redirect issue R01 or legacy path safety H01/M01.
No production credentials or signing material were used. Do not merge/release
solely on the standalone helper tests.
