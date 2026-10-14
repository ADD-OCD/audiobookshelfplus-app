package app.absplus.android.managers;

import java.util.Locale;
import okhttp3.HttpUrl;

/** Credential selection uses the same URL parser as Request.Builder.url(String). */
public final class DownloadAuthorization {
  private DownloadAuthorization() {}

  public static String tokenFor(
      String ownerId, String ownerAddress, String ownerUserId,
      String savedId, String savedAddress, String savedUserId, String savedToken,
      String requestUrl) {
    // Destination canonicalization does not rebind a persisted download to a different config.
    if (blank(ownerId) || blank(ownerAddress) || blank(ownerUserId)
        || !ownerId.equals(savedId) || !ownerAddress.equals(savedAddress)
        || !ownerUserId.equals(savedUserId) || blank(savedToken)) return null;
    if (!safeSyntax(savedAddress) || !safeSyntax(requestUrl)) return null;
    try {
      HttpUrl base = HttpUrl.get(savedAddress);
      HttpUrl request = HttpUrl.get(requestUrl);
      if (!base.scheme().equals(request.scheme())
          || !base.host().equals(request.host())
          || base.port() != request.port()) return null;

      // Preserve address + serverPath, including trailing slashes and configured queries.
      // Resolving a relative URL or moving a query would silently change the endpoint.
      HttpUrl prefix = HttpUrl.get(savedAddress + "/api/items/");
      if (base.encodedQuery() == null) {
        if (!request.encodedPath().startsWith(prefix.encodedPath())) return null;
      } else {
        // The existing app appends the API suffix inside a configured query. Only that exact
        // path and query prefix are allowed; never infer a different API path on the same host.
        String query = request.encodedQuery();
        String queryPrefix = prefix.encodedQuery();
        if (!request.encodedPath().equals(prefix.encodedPath())
            || query == null || !query.startsWith(queryPrefix)
            || !safeQuerySuffix(query.substring(queryPrefix.length()))) return null;
      }
      return savedToken;
    } catch (IllegalArgumentException invalid) {
      return null;
    }
  }

  private static boolean blank(String value) {
    return value == null || value.trim().isEmpty();
  }

  private static boolean safeQuerySuffix(String suffix) {
    // An appended resource must not add/override configured routing parameters. The only query
    // suffix constructed by the downloader itself is the cover request's literal ?raw=1.
    String lower = suffix.toLowerCase(Locale.ROOT);
    if (suffix.indexOf('&') >= 0 || suffix.indexOf(';') >= 0
        || lower.contains("%26") || lower.contains("%3b")) return false;
    int query = suffix.indexOf('?');
    if (query >= 0 && !suffix.substring(query).equals("?raw=1")) return false;
    return safePath(query < 0 ? suffix : suffix.substring(0, query));
  }

  /** Reject ambiguous spelling before HttpUrl can normalize away traversal evidence. */
  private static boolean safeSyntax(String value) {
    if (value == null || value.indexOf('\\') >= 0 || value.indexOf('#') >= 0) return false;
    for (int i = 0; i < value.length(); i++) {
      if (value.charAt(i) < 0x20 || value.charAt(i) == 0x7f) return false;
    }
    int authorityStart;
    if (value.regionMatches(true, 0, "https://", 0, 8)) authorityStart = 8;
    else if (value.regionMatches(true, 0, "http://", 0, 7)) authorityStart = 7;
    else return false;
    int authorityEnd = authorityStart;
    while (authorityEnd < value.length()
        && value.charAt(authorityEnd) != '/' && value.charAt(authorityEnd) != '?') authorityEnd++;
    String authority = value.substring(authorityStart, authorityEnd);
    // Empty userinfo matters too: HttpUrl treats https://@host like https://host.
    if (authority.isEmpty() || authority.indexOf('@') >= 0 || authority.indexOf('%') >= 0) return false;
    int queryStart = value.indexOf('?', authorityEnd);
    return safePath(value.substring(authorityEnd, queryStart < 0 ? value.length() : queryStart));
  }

  private static boolean safePath(String path) {
    String lower = path.toLowerCase(Locale.ROOT);
    // Reject nested escapes as well as structural encodings; never recursively guess/decode.
    if (lower.contains("%2e") || lower.contains("%2f") || lower.contains("%5c")
        || lower.contains("%25")) return false;
    for (String part : path.split("/")) {
      if (part.equals(".") || part.equals("..")) return false;
    }
    return true;
  }
}
