"""Mutation checks on an isolated prepared checkout, using only synthetic JVM/Robolectric fixtures.

Requires existing Android/Gradle dependencies. Never run alongside another build/editor in this
checkout. Edits are byte-for-byte restored in finally; a killed process still requires manual
restoration. Does not install/run an APK. --output must be outside the checkout.
"""
import argparse, json, pathlib, subprocess, xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANAGERS = ROOT / "android/app/src/main/java/app/absplus/android/managers"
guard = ".any { !it.moved && downloadToken(it, item) == null }"
MUTATIONS = [
    ("startDownload_active_fallback", "DownloadItemManager.kt", [
        ("    val token = downloadToken(part, item)\n", "    val token = downloadToken(part, item) ?: DeviceManager.token\n")]),
    ("startDownload_active_instead_of_owner", "DownloadItemManager.kt", [
        ("    val token = downloadToken(part, item)\n", "    val token = DeviceManager.token\n")]),
    ("restore_after_missing_final", "DownloadItemManager.kt", [
        ("      // before resetting its retained staging copy; the initial guard only saw moved parts.\n      if (item.downloadItemParts" + guard + ") {",
         "      // before resetting its retained staging copy; the initial guard only saw moved parts.\n      if (false) {")]),
    ("retry_owner_guard", "DownloadItemManager.kt", [
        ("    if (!DownloadControls.canRetry(item) { it in currentDownloadItemParts }) return false\n    if (item.downloadItemParts" + guard + ") {",
         "    if (!DownloadControls.canRetry(item) { it in currentDownloadItemParts }) return false\n    if (false) {")]),
    ("expiry_owner_guard", "IncompleteDownloadCleanup.kt", [
        ("        }) return false\n    val failedAt", "        } && false) return false\n    val failedAt")]),
    ("hold_cleanup_deadline", "DownloadItemManager.kt", [
        ("      item.terminalFailureAt = null\n      IncompleteDownloadCleanup.cancel(context, item.id)",
         "      item.terminalFailureAt = item.terminalFailureAt ?: 1L\n      IncompleteDownloadCleanup.cancel(context, item.id)")]),
    ("redirect_reinjects_authorization", "InternalDownloadManager.kt", [
        ("            OkHttpClient.Builder()", '            OkHttpClient.Builder().addNetworkInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("Authorization", "Bearer synthetic-A").build()) }')]),
]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = pathlib.Path(args.output).resolve()
    assert not output.is_relative_to(ROOT), "Evidence output must be outside the checkout"
    output.mkdir(parents=True, exist_ok=True)
    results = []
    for name, filename, edits in [("baseline", None, [])] + MUTATIONS:
        file = MANAGERS / filename if filename else None
        original = file.read_bytes() if file else None
        try:
            if file:
                source = original.decode("utf8").replace("\r\n", "\n")
                for before, after in edits:
                    assert source.count(before) == 1, name
                    source = source.replace(before, after)
                file.write_text(source, encoding="utf8")
            cmd = [str(ROOT / "android/gradlew.bat"), ":app:testDebugUnitTest", "--offline", "--console=plain",
                   "--tests", "app.absplus.android.managers.DownloadAuthorization*",
                   "--tests", "app.absplus.android.managers.DownloadControlsTest"]
            result = subprocess.run(cmd, cwd=ROOT / "android", capture_output=True, text=True, encoding="utf8", errors="replace", timeout=300)
            (output / (name + ".log")).write_text(result.stdout + result.stderr, encoding="utf8")
            failed = []
            for xml in (ROOT / "android/app/build/test-results/testDebugUnitTest").glob("TEST-*.xml"):
                tree = ET.parse(xml)
                for case in tree.findall("testcase"):
                    failure = case.find("failure")
                    if failure is not None: failed.append({'test':case.attrib['classname']+'.'+case.attrib['name'],'type':failure.get('type'),'message':failure.get('message')})
            if name == "baseline": assert result.returncode == 0 and not failed, "Baseline failed"
            else: assert result.returncode != 0 and any('Assertion' in (f['type'] or '') or 'ComparisonFailure' in (f['type'] or '') for f in failed), name + " survived or failed outside an assertion"
            results.append({'name':name,'exit':result.returncode,'result':'PASS' if name=='baseline' else 'KILLED','failures':failed})
            (output / "results.json").write_text(json.dumps(results, indent=2), encoding="utf8")
            print(name + ": " + results[-1]['result'], flush=True)
        finally:
            if file: file.write_bytes(original)
    print("All source bytes restored. Run the unmodified full suite before commit.", flush=True)

if __name__ == "__main__": main()
