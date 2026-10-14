"""Run permanent JUnit boundary tests and helper mutations against the app's OkHttp classpath.

Supply --classpath with resolved okhttp/okio/kotlin-stdlib/junit/hamcrest JARs. This script
installs nothing. All mutations are temporary copies; production files are never edited.
The manager/redirect regressions additionally run under Gradle (see H04-README.txt).
"""
import argparse, os, pathlib, subprocess, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
PACKAGE = "app.absplus.android.managers"
SOURCE = ROOT / "android/app/src/main/java/app/absplus/android/managers/DownloadAuthorization.java"
TEST = ROOT / "android/app/src/test/java/app/absplus/android/managers/DownloadAuthorizationTest.java"
MUTATIONS = [
    ("config_identity", "!ownerId.equals(savedId)", "false"),
    ("saved_address_binding", "!ownerAddress.equals(savedAddress)", "false"),
    ("user_identity", "!ownerUserId.equals(savedUserId)", "false"),
    ("origin_scheme", "!base.scheme().equals(request.scheme())", "false"),
    ("origin_host", "!base.host().equals(request.host())", "false"),
    ("origin_port", "base.port() != request.port()", "false"),
    ("base_path", "!request.encodedPath().startsWith(prefix.encodedPath())", "false"),
    ("query_path", "!request.encodedPath().equals(prefix.encodedPath())", "false"),
    ("query_prefix", "!query.startsWith(queryPrefix)", "query.length() < queryPrefix.length()"),
    ("userinfo", "authority.indexOf('@') >= 0", "false"),
    ("raw_dot_segments", 'part.equals(".") || part.equals("..")', "false"),
    ("encoded_separator", 'lower.contains("%2f")', "false"),
    ("nested_escape", 'lower.contains("%25")', "false"),
    ("query_parameter_injection", "!safeQuerySuffix(query.substring(queryPrefix.length()))", "false"),
]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--classpath", required=True)
    args = parser.parse_args()
    for name, old, new in [("fixed", None, None)] + MUTATIONS:
        with tempfile.TemporaryDirectory(prefix="abs-h04-boundary-") as directory:
            root = pathlib.Path(directory)
            source = SOURCE.read_text(encoding="utf8")
            if old is not None:
                assert source.count(old) == 1, name
                source = source.replace(old, new)
            candidate = root / "DownloadAuthorization.java"
            candidate.write_text(source, encoding="utf8")
            subprocess.run(["javac", "--release", "8", "-encoding", "UTF-8", "-cp", args.classpath,
                            "-d", str(root), str(candidate), str(TEST)], check=True, capture_output=True, timeout=60)
            result = subprocess.run(["java", "-cp", str(root) + os.pathsep + args.classpath,
                                     "org.junit.runner.JUnitCore", PACKAGE + ".DownloadAuthorizationTest"],
                                    capture_output=True, text=True, timeout=30)
            if name == "fixed":
                assert result.returncode == 0, result.stdout + result.stderr
                print(result.stdout.strip(), flush=True)
            else:
                assert result.returncode != 0 and "AssertionError" in result.stdout, name + " survived or failed outside an assertion: " + result.stdout
                print("KILLED: " + name, flush=True)

if __name__ == "__main__":
    main()
