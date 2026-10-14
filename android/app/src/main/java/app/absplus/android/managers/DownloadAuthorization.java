package app.absplus.android.managers;

import java.net.URI;
import java.net.URISyntaxException;

/** Fail-closed credential selection for an existing download, with no active-server fallback. */
public final class DownloadAuthorization {
  private DownloadAuthorization() {}

  public static String tokenFor(
      String ownerId, String ownerAddress, String ownerUserId,
      String savedId, String savedAddress, String savedUserId, String savedToken,
      String requestUrl) {
    if (blank(ownerId) || blank(ownerAddress) || blank(ownerUserId)
        || !ownerId.equals(savedId) || !ownerAddress.equals(savedAddress)
        || !ownerUserId.equals(savedUserId) || blank(savedToken)) return null;
    try {
      URI base = new URI(savedAddress);
      URI request = new URI(requestUrl);
      if (!httpUrl(base) || !httpUrl(request)
          || base.getRawQuery() != null
          || !base.getScheme().equalsIgnoreCase(request.getScheme())
          || !base.getHost().equalsIgnoreCase(request.getHost())
          || port(base) != port(request)) return null;
      // Server addresses are captured verbatim with the queue owner. A changed spelling/base path
      // requires explicit recovery rather than silently authorizing an old job against a new URL.
      String basePath = base.getRawPath();
      String path = request.getRawPath();
      if (!safePath(basePath) || !safePath(path)
          || !path.startsWith(basePath + "/api/items/")) return null;
      return savedToken;
    } catch (URISyntaxException | IllegalArgumentException | NullPointerException invalid) {
      return null;
    }
  }

  private static boolean blank(String value) {
    return value == null || value.trim().isEmpty();
  }

  private static boolean httpUrl(URI uri) {
    return ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
        && uri.getHost() != null && uri.getRawUserInfo() == null && uri.getRawFragment() == null;
  }

  private static int port(URI uri) {
    return uri.getPort() != -1 ? uri.getPort() : ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80);
  }

  private static boolean safePath(String path) {
    if (path == null || path.indexOf('\\') >= 0) return false;
    String lower = path.toLowerCase(java.util.Locale.ROOT);
    // These are structural encodings, never valid server item identifiers in this boundary.
    if (lower.contains("%2e") || lower.contains("%2f") || lower.contains("%5c")) return false;
    for (String part : path.split("/")) {
      if (part.equals(".") || part.equals("..")) return false;
    }
    return true;
  }
}
