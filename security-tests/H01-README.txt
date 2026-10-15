H01: download identifier admission hardening

Based on trusted plus d844ca65e78c5f03e63c1aa9b12e4bad0cd7e436.
No PR #23/#29 source is incorporated.

Run with an existing JDK 9+ and Python 3 (no dependency installation):
  python security-tests/run_h01_regressions.py

The runner compiles only DownloadIdentifiers.java and its standalone regression
test with --release 8. It does not run Gradle, Android code or network requests.
32 checks pass. Two mutants must fail: allowing unsafe IDs overwrites the bounded
synthetic sentinel; removing response-ID binding admits a substituted item.

Scope: validate requested library/episode IDs before queue lookup or API calls;
independently validate/bind the server response before path construction; defend
the private start helper. Reject unsupported IDs without modifying existing data.
UUIDs, numeric IDs, and ASCII alphanumeric/underscore/hyphen IDs up to 256 chars
are accepted. Other legacy formats fail closed and require compatibility review.

Not a complete filesystem hardening fix: already-persisted unsafe queue paths,
symlinks, path substitution, database-key validation and other filesystem sinks
still require the H01/M01 repair specification. No old queue is deleted/rewritten.
No playback/progress schema, PR #25 compaction or retry behavior is changed.

Claude integration gate: compile the Android app; exercise both bridge rejection
paths, normal book/episode/cover downloads, legacy server ID fixtures, persisted
queues and PR #25 compaction. No Android integration tests were run by Codex.
Do not merge/release solely on the standalone test result.
