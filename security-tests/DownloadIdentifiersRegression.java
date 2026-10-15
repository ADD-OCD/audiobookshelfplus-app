import app.absplus.android.managers.DownloadIdentifiers;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/** Bounded synthetic files below the explicitly supplied, newly created fixture directory only. */
public final class DownloadIdentifiersRegression {
  private static int checks;
  private static void check(boolean ok, String name) {
    checks++;
    if (!ok) throw new AssertionError(name);
  }
  public static void main(String[] args) throws Exception {
    Path fixture = Paths.get(args[0]).toAbsolutePath().normalize();
    Path downloads = Files.createDirectories(fixture.resolve("files/downloads"));
    Path sentinel = fixture.resolve("shared_prefs/synthetic.xml");
    Files.createDirectories(sentinel.getParent());
    Files.write(sentinel, "original".getBytes(StandardCharsets.UTF_8));
    String hostileId = "../../shared_prefs";
    Path oldTarget = downloads.resolve(hostileId).resolve("synthetic.xml").normalize();
    check(oldTarget.startsWith(fixture) && oldTarget.equals(sentinel), "bounded baseline escape reproduced");
    // Exercise the repaired admission decision around the original path construction, with a
    // sentinel outside downloads. No repository or application code is executed by this fixture.
    if (DownloadIdentifiers.isSafe(hostileId)) Files.write(oldTarget, "overwritten".getBytes(StandardCharsets.UTF_8));
    check(new String(Files.readAllBytes(sentinel), StandardCharsets.UTF_8).equals("original"), "out-of-root sentinel preserved");
    for (String id : new String[]{null, "", ".", "..", "../x", "x/../../y", "/tmp/x", "x\\y", "C:\\x", "\\\\host\\x", "%2e%2e", "a%2fb", ".moving-book", "a\u0000b", "a\nb", "a b", "a.b", "雪"}) {
      check(!DownloadIdentifiers.isSafe(id), "hostile/unsupported component rejected");
    }
    for (String id : new String[]{"book_123", "123", "01J9ABCDEFG", "a98d9e92-cf12-4f20-b32a-22b405b28fff"}) {
      check(DownloadIdentifiers.isSafe(id), "supported server ID accepted");
      check(downloads.resolve(id).normalize().startsWith(downloads), "safe component stays under root");
    }
    check(!DownloadIdentifiers.isSafe(new String(new char[257]).replace('\0', 'a')), "bounded length");
    check(DownloadIdentifiers.matchesRequest("book_123", "book_123"), "matching response");
    check(!DownloadIdentifiers.matchesRequest("book_123", "other_safe_id"), "response binding");
    check(!DownloadIdentifiers.matchesRequest("book_123", hostileId), "untrusted response rejected");
    System.out.println("PASS: " + checks + " identifier checks; bounded synthetic sentinel preserved");
  }
}
