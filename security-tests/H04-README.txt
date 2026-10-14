H04: owner-bound downloads with HTTP-client-compatible address validation

Compatibility correction based on Claude's validated integration commit
fb38c166795ba9ac3be2b91182a71e2a56bf1969 (plus c05a52c2 plus H01/H04).
No new merge is performed and no PR #23/#29 source is incorporated.

Permanent JUnit and Robolectric tests run in the existing GitHub CI suite:
  cd android
  gradlew testDebugUnitTest

Focused tests (use gradlew.bat on Windows):
  gradlew :app:testDebugUnitTest --tests "app.absplus.android.managers.DownloadAuthorization*" --tests "app.absplus.android.managers.DownloadControlsTest"

Fast helper mutations, with existing resolved okhttp, okio, kotlin-stdlib,
junit and hamcrest JARs on CLASSPATH (no dependency installation by the runner):
  python security-tests/run_h04_regressions.py --classpath "<resolved test classpath>"
This compiles the SAME permanent DownloadAuthorizationTest with --release 8.
Fourteen mutants cover owner/address/user binding, scheme/host/port, path,
configured-query path/prefix and parameter injection, userinfo, raw dot segments
and encoded escapes.

Manager/redirect mutations require an isolated prepared checkout, no concurrent
editor/build, and an evidence directory OUTSIDE the checkout:
  python security-tests/run_h04_wiring_mutations.py --output "<evidence directory>"
Seven mutants include the original active-token fallback in startDownload,
always using the active token, restore/retry/expiry guards, hold retention and
reinjecting Authorization after a redirect. Sources are restored in finally.
Hard termination still requires manual source restoration; review git diff.

Scope: never fall back to the active server; require queued configuration ID,
verbatim saved address and user ID to match. Parse the destination with OkHttp
HttpUrl, the parser used by Request.Builder.url(String); compare scheme, canonical
host, effective port and actual app-constructed API prefix. No DNS-based identity.
Underscore/Unicode/punycode hosts, IPv4/IPv6, path spaces and trailing slashes work.
Configured queries preserve EXACT existing address + serverPath semantics: the
API suffix stays in the query at the same path. This is parser/destination
compatibility, not a guarantee every server routes such a configuration correctly.
No query is moved, removed or interpreted as a new server address.
Appended resources cannot add/override configured query parameters; ampersand,
semicolon and their encoded forms are rejected in the appended suffix. Its only
allowed nested query is the downloader's existing cover suffix ?raw=1.
Reject userinfo (even empty), raw controls/backslashes/fragments, dot segments,
encoded path separators/dots and nested percent escapes; no lossy sanitization.

Restore/retry checks precede partial-file resets. An invalid owner is held using
existing failure fields without creating a terminal-failure cleanup deadline;
active non-moving parts are cancelled and records/bytes/progress retained.
Expired cleanup also skips invalid ownership, including before service restore.
Reconnect the original server then retry. Removing/re-adding a server under a new
configuration ID cannot silently rebind an old queue. No queue schema is changed.

Claude's supplementary manager harness is now committed with attribution, plus a
real loopback request that observes the saved owner's renewed token while another
server is active. Loopback redirect tests use the actual download client's policy:
same-origin redirects retain the original token; different-origin redirects strip
Authorization. No production credentials, external servers or signing keys used.

Remaining: Claude's final Android integration/device validation; per-config
generation/cancellation coordination and immutable enqueue ownership. The separate
x-refresh-token redirect issue R01 and legacy path safety H01/M01 are NOT fixed.
No H01 implementation, PR #25 queue behavior, schema, signing or version changes.
Do not merge/release based solely on unit tests.
