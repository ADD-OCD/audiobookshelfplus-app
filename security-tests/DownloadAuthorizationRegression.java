import app.absplus.android.managers.DownloadAuthorization;
import java.util.ArrayList;
import java.util.List;

/** Standalone, no Android/HTTP/filesystem fixtures: only synthetic request/credential decisions. */
public final class DownloadAuthorizationRegression {
  private static int checks;
  private static final String A = "https://a.invalid/abs";
  private static final String URL = A + "/api/items/book/file/one/download";
  private static String token(String id, String address, String user, String secret, String url) {
    return DownloadAuthorization.tokenFor("A", A, "alice", id, address, user, secret, url);
  }
  private static void expect(String expected, String actual, String name) {
    checks++;
    if (expected == null ? actual != null : !expected.equals(actual)) throw new AssertionError(name);
  }
  public static void main(String[] args) {
    expect("synthetic-A", token("A", A, "alice", "synthetic-A", URL), "original owner accepted");
    expect("rotated-A", token("A", A, "alice", "rotated-A", URL), "same-owner rotation accepted");
    expect(null, token(null, null, null, null, URL), "removed A must not select current B");
    expect(null, token("B", A, "alice", "synthetic-B", URL), "wrong config ID");
    expect(null, token("A", A, "bob", "synthetic-B", URL), "same ID different account");
    expect(null, token("A", "https://b.invalid/abs", "alice", "synthetic-B", URL), "changed address");
    expect(null, token("A", A, "alice", "", URL), "missing credential");
    expect(null, token("A", A, "alice", "synthetic-A", "https://b.invalid/abs/api/items/book"), "wrong request host");
    expect(null, token("A", A, "alice", "synthetic-A", "http://a.invalid/abs/api/items/book"), "scheme change");
    expect(null, token("A", A, "alice", "synthetic-A", "https://a.invalid:444/abs/api/items/book"), "port change");
    expect(null, token("A", A, "alice", "synthetic-A", "https://a.invalid/other/api/items/book"), "base path change");
    expect(null, token("A", A, "alice", "synthetic-A", A + "/api/items/../private"), "dot traversal");
    expect(null, token("A", A, "alice", "synthetic-A", A + "/api/items/%2e%2e/private"), "encoded traversal");
    expect(null, token("A", A, "alice", "synthetic-A", A + "/api/items/a%2fb"), "encoded separator");
    expect(null, token("A", A, "alice", "synthetic-A", "https://a.invalid@b.invalid/abs/api/items/book"), "userinfo confusion");
    expect(null, token("A", A, "alice", "synthetic-A", URL + "#fragment"), "fragment rejected");
    expect(null, token("A", A, "alice", "synthetic-A", "https://a.invalid\\@b.invalid/abs/api/items/book"), "backslash ambiguity");
    expect("synthetic-A", token("A", A, "alice", "synthetic-A", A + "/api/items/book/cover?raw=1"), "cover query accepted");
    expect("synthetic-A", token("A", A, "alice", "synthetic-A", "https://A.INVALID:443/abs/api/items/book"), "equivalent request origin");
    expect("synthetic-LAN", DownloadAuthorization.tokenFor("A", "http://127.0.0.1:1234", "alice", "A", "http://127.0.0.1:1234", "alice", "synthetic-LAN", "http://127.0.0.1:1234/api/items/book"), "explicit HTTP server remains supported");
    expect("synthetic-A", DownloadAuthorization.tokenFor("A", A + "/", "alice", "A", A + "/", "alice", "synthetic-A", A + "//api/items/book"), "existing trailing-slash construction remains supported");
    // A fake transport records only an allowed header. The original fallback leaks B here.
    List<String> sent = new ArrayList<>();
    String selected = token(null, null, null, null, URL);
    if (selected != null) sent.add("A receives Bearer " + selected);
    checks++;
    if (!sent.isEmpty()) throw new AssertionError("removed owner produced a network authorization");
    System.out.println("PASS: " + checks + " credential-boundary checks; no network requests");
  }
}
