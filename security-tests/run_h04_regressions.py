"""Run only the new dependency-free Java helper/test, plus security mutants. No Android or network."""
import pathlib, subprocess, tempfile
ROOT = pathlib.Path(__file__).resolve().parents[1]
HELPER = 'DownloadAuthorization'
TEST = 'DownloadAuthorizationRegression'
MUTATIONS = [('restore_active_token_fallback', '|| !ownerUserId.equals(savedUserId) || blank(savedToken)) return null;', '|| !ownerUserId.equals(savedUserId) || blank(savedToken)) return "synthetic-B";'), ('ignore_config_id', '!ownerId.equals(savedId)', 'false'), ('ignore_request_host', '!base.getHost().equalsIgnoreCase(request.getHost())', 'false'), ('ignore_server_base_path', '!path.startsWith(basePath + "/api/items/")', 'false')]
source = ROOT / "android/app/src/main/java/app/absplus/android/managers" / (HELPER + ".java")
test = ROOT / "security-tests" / (TEST + ".java")
for name, old, new in [("fixed", None, None)] + MUTATIONS:
    with tempfile.TemporaryDirectory(prefix="abs-security-") as directory:
        temporary = pathlib.Path(directory)
        text = source.read_text(encoding="utf8")
        if old is not None:
            assert text.count(old) == 1, name
            text = text.replace(old, new)
        candidate = temporary / (HELPER + ".java")
        candidate.write_text(text, encoding="utf8")
        classes = temporary / "classes"
        classes.mkdir()
        fixture = temporary / "fixture"
        fixture.mkdir()
        subprocess.run(["javac", "--release", "8", "-encoding", "UTF-8", "-d", str(classes), str(candidate), str(test)], check=True)
        result = subprocess.run(["java", "-cp", str(classes), TEST, str(fixture)], capture_output=True, text=True, timeout=30)
        if name == "fixed":
            assert result.returncode == 0, result.stderr
            print(result.stdout.strip())
        else:
            assert result.returncode != 0 and "AssertionError" in result.stderr, name + " survived or failed for the wrong reason"
            print("KILLED: " + name)
