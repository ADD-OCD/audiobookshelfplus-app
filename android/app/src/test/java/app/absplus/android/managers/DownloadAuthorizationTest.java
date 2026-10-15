package app.absplus.android.managers;

import okhttp3.HttpUrl;
import okhttp3.Request;
import org.junit.Test;
import static org.junit.Assert.*;

/** Synthetic destinations only. Parsing uses the exact Request.Builder entry point used by downloads. */
public class DownloadAuthorizationTest {
  private static final String A = "https://a.invalid/abs";
  private static final String ITEM = "/api/items/book/file/one/download";
  private static String token(String savedId, String address, String user, String secret, String url) {
    return DownloadAuthorization.tokenFor("A", A, "alice", savedId, address, user, secret, url);
  }
  private static String at(String address, String url) {
    return DownloadAuthorization.tokenFor("A", address, "alice", "A", address, "alice", "synthetic-A", url);
  }

  @Test public void exactOwnerAndTokenRenewal() {
    assertEquals("synthetic-A", token("A", A, "alice", "synthetic-A", A + ITEM));
    assertEquals("renewed-A", token("A", A, "alice", "renewed-A", A + ITEM));
    assertNull(token(null, null, null, null, A + ITEM));
    assertNull(token("B", A, "alice", "synthetic-B", A + ITEM));
    assertNull(token("A", A, "bob", "synthetic-B", A + ITEM));
    assertNull(token("A", A, "alice", "", A + ITEM));
    // Canonical equivalence is NOT authority to change the persisted owner's identity/address.
    assertNull(token("A", "https://A.INVALID/abs", "alice", "synthetic-A", A + ITEM));
  }

  @Test public void legacyAddressesUseActualHttpClientCanonicalization() {
    String[] addresses = {"http://192.168.1.20:13378", "https://abs.example.com",
        "https://example.com/audiobookshelf", "https://example.com/audiobookshelf/",
        "http://[fd00::20]:13378", "http://abs_server:13378", "http://my-nas.local:13378",
        "https://bücher.example", "https://xn--bcher-kva.example", "http://localhost:13378",
        "HTTP://Example.com", "https://example.com/abs path", "https://example.com/abs%20path",
        "https://example.com?x=1", "https://example.com/abs?tenant=home office",
        "https://example.com/abs?", "http://10.0.2.2:13378"};
    for (String address : addresses) {
      String raw = address + ITEM;
      HttpUrl actual = new Request.Builder().url(raw).build().url();
      assertEquals(address, "synthetic-A", at(address, raw));
      // The URL checked after canonicalization is also accepted; no second parser disagrees.
      assertEquals(address, "synthetic-A", at(address, actual.toString()));
      assertEquals(HttpUrl.get(address).host(), actual.host());
    }
    assertEquals("xn--bcher-kva.example", new Request.Builder().url("https://bücher.example" + ITEM).build().url().host());
    assertEquals("abs_server", new Request.Builder().url("http://abs_server:13378" + ITEM).build().url().host());
    assertEquals("/abs%20path" + ITEM, new Request.Builder().url("https://example.com/abs path" + ITEM).build().url().encodedPath());
    assertEquals("synthetic-A", at("https://bücher.example", "https://xn--bcher-kva.example" + ITEM));
    assertEquals("synthetic-A", at(A, "https://A.INVALID:443/abs" + ITEM));
    assertEquals("synthetic-A", at(A, A + "/api/items/book/cover?raw=1"));
  }

  @Test public void queryCompatibilityPreservesTheExistingDestinationExactly() {
    String base = "https://a.invalid/abs?tenant=home office";
    HttpUrl actual = new Request.Builder().url(base + ITEM).build().url();
    assertEquals("/abs", actual.encodedPath());
    assertEquals("tenant=home%20office" + ITEM, actual.encodedQuery());
    assertEquals("synthetic-A", at(base, actual.toString()));
    assertEquals("synthetic-A", at(base, base + "/api/items/book/cover?raw=1"));
    // Never relocate the query into a different endpoint or change its configured prefix.
    assertNull(at(base, "https://a.invalid/abs" + ITEM + "?tenant=home%20office"));
    assertNull(at(base, "https://a.invalid/other?tenant=home%20office" + ITEM));
    assertNull(at(base, "https://a.invalid/abs?tenant=another" + ITEM));
    assertNull(at(base, "https://a.invalid/abs?tenant=home%20office/api/items/../private"));
    assertNull(at(base, "https://a.invalid/abs?tenant=home%20office/api/items/%2e%2e/private"));
    assertNull(at(base, "https://a.invalid/abs?tenant=home%20office/api/items/%252e%252e/private"));
    for (String extra : new String[]{"&tenant=another", ";tenant=another", "%26tenant=another", "%3btenant=another", "?next=another"}) {
      assertNull(extra, at(base, base + ITEM + extra));
    }
  }

  @Test public void originAndBasePathCannotChange() {
    assertNull(at(A, "https://b.invalid/abs" + ITEM));
    assertNull(at(A, "https://a.invalid:444/abs" + ITEM));
    // Same port deliberately isolates the scheme check (the previous mutation survived).
    assertNull(at(A, "http://a.invalid:443/abs" + ITEM));
    assertNull(at(A, "https://a.invalid/other" + ITEM));
    assertNull(at(A, "https://a.invalid/abs/api/items-extra/book"));
    assertNull(at(A, "https://a.invalid/abs/api/items"));
    assertNull(at(A, "https://a.invalid/abs/api/items/book/../../private"));
  }

  @Test public void userinfoCannotHideBehindAnEquivalentHost() {
    for (String authority : new String[]{"alice:password@a.invalid", "@a.invalid", "a.invalid@b.invalid", "%61.invalid"}) {
      assertNull(at(A, "https://" + authority + "/abs" + ITEM));
      String configured = "https://" + authority + "/abs";
      assertNull(at(configured, configured + ITEM));
    }
  }

  @Test public void rawTraversalIsRejectedBeforeHttpUrlNormalizesItAway() {
    for (String suffix : new String[]{"x/../book", "./book", "%2e/book", "%2E%2e/book",
        "a%2fb", "a%5Cb", "%252e%252e/book", "a\\b"}) {
      assertNull(suffix, at(A, A + "/api/items/" + suffix));
      String configured = "https://a.invalid/" + suffix;
      assertNull(suffix, at(configured, configured + ITEM));
    }
    assertNull(at(A, A + ITEM + "#fragment"));
    assertNull(at(A, A + "/api/items/bo\tok"));
    assertNull(at(A, " https://a.invalid/abs" + ITEM));
    assertNull(at(A, "https:a.invalid/abs" + ITEM));
    assertNull(at(A, "file:///abs" + ITEM));
    assertNull(at(A, "https://a.invalid:99999/abs" + ITEM));
    assertNull(at(A, null));
  }
}
