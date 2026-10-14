package app.absplus.android.managers;

/** Opaque server IDs are single components, never paths or names to sanitize into paths. */
public final class DownloadIdentifiers {
  private DownloadIdentifiers() {}

  public static boolean isSafe(String value) {
    if (value == null || value.isEmpty() || value.length() > 256) return false;
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
          || (c >= '0' && c <= '9') || c == '-' || c == '_')) return false;
    }
    return true;
  }

  public static boolean matchesRequest(String requestedId, String returnedId) {
    return isSafe(requestedId) && isSafe(returnedId) && requestedId.equals(returnedId);
  }
}
