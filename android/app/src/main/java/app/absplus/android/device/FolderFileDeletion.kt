package app.absplus.android.device

import android.content.Context
import android.database.Cursor
import android.provider.DocumentsContract
import androidx.core.net.toUri
import app.absplus.android.data.LocalFolder
import java.io.File

/** Registered regular files only. Never prunes directories or discovers temporary files by name. */
object FolderFileDeletion {
  enum class Kind { FILE, DIRECTORY, MISSING, UNKNOWN }
  enum class Result { DELETED, FAILED, UNAVAILABLE }
  interface Docs {
    fun folderReachable(): Boolean
    fun kind(uri: String): Kind
    fun deleteFile(uri: String): Boolean
  }

  /** A partial operation keeps its records; the next pass can retry remaining registered files. */
  fun deleteFiles(uris: List<String>, docs: Docs, guarded: (() -> Boolean) -> Boolean = { it() }, alreadyMissingIsDeleted: Boolean = false): Result {
    if (!docs.folderReachable()) return Result.UNAVAILABLE
    val targets = uris.distinct()
    val kinds = targets.map { docs.kind(it) }
    if (kinds.any { it == Kind.DIRECTORY || it == Kind.UNKNOWN }) return Result.FAILED
    if (kinds.none { it == Kind.FILE }) return if (alreadyMissingIsDeleted && kinds.isNotEmpty()) Result.DELETED else Result.FAILED
    for ((i, uri) in targets.withIndex()) {
      if (kinds[i] == Kind.MISSING) continue
      val removed = guarded { docs.folderReachable() && docs.kind(uri) == Kind.FILE && docs.deleteFile(uri) }
      if (!removed) return if (docs.folderReachable()) Result.FAILED else Result.UNAVAILABLE
    }
    if (!docs.folderReachable()) return Result.UNAVAILABLE
    return if (targets.all { docs.kind(it) == Kind.MISSING }) Result.DELETED else Result.FAILED
  }

  /** Queries preserve errors. Unsupported child/type/delete capabilities fail closed. */
  class AndroidDocs(private val ctx: Context, private val folder: LocalFolder?,
                    private val itemFolderUrl: String? = folder?.contentUrl) : Docs {
    override fun folderReachable(): Boolean = try {
      val f = folder
      if (f == null) false
      else if (f.contentUrl.startsWith("file:")) {
        val root = File(f.contentUrl.toUri().path ?: "")
        AndroidStorageIo.kind(root) == NodeKind.DIRECTORY && root.canWrite()
      } else FolderAccess.canWrite(ctx, f)
    } catch (_: Exception) { false }

    private fun within(uri: String): Boolean {
      val root = folder?.contentUrl?.toUri() ?: return false
      val doc = uri.toUri()
      if (root.scheme == "file" && doc.scheme == "file") {
        val base = File(root.path ?: return false).canonicalFile
        val file = File(doc.path ?: return false).canonicalFile
        return file != base && AppStorage.isUnder(file, base)
      }
      if (root.scheme != "content" || doc.scheme != "content" || root.authority != doc.authority ||
          !DocumentsContract.isTreeUri(root) || !DocumentsContract.isTreeUri(doc) ||
          DocumentsContract.getTreeDocumentId(root) != DocumentsContract.getTreeDocumentId(doc)) return false
      val rootDoc = DocumentsContract.buildDocumentUriUsingTree(root, DocumentsContract.getTreeDocumentId(root))
      return android.os.Build.VERSION.SDK_INT >= 29 && DocumentsContract.getDocumentId(doc) != DocumentsContract.getDocumentId(rootDoc) &&
              DocumentsContract.isChildDocument(ctx.contentResolver, rootDoc, doc)
    }

    override fun kind(uri: String): Kind = try {
      val contained = try { within(uri) } catch (_: Exception) { false }
      if (!contained) {
        // Android's local provider cannot isChild/query a document after deleting it.
        // Verify the surviving parent inside the tree and its complete child listing instead.
        if (uri.toUri().authority == "com.android.externalstorage.documents" && absentFromItemFolder(uri)) Kind.MISSING else Kind.UNKNOWN
      }
      else if (uri.toUri().scheme == "file") when (AndroidStorageIo.kind(File(uri.toUri().path!!))) {
        NodeKind.FILE -> Kind.FILE
        NodeKind.DIRECTORY -> Kind.DIRECTORY
        NodeKind.MISSING -> Kind.MISSING
        else -> Kind.UNKNOWN
      } else {
        var mime: String? = null
        var answered = false
        try {
          ctx.contentResolver.query(uri.toUri(), arrayOf(DocumentsContract.Document.COLUMN_MIME_TYPE), null, null, null)?.use { c ->
            if (!complete(c)) return Kind.UNKNOWN
            answered = true
            if (c.moveToFirst()) mime = c.getString(0)
          }
        } catch (_: java.io.FileNotFoundException) { answered = true }
        when {
          mime == DocumentsContract.Document.MIME_TYPE_DIR -> Kind.DIRECTORY
          !mime.isNullOrBlank() -> Kind.FILE
          answered && absentFromItemFolder(uri) -> Kind.MISSING
          else -> Kind.UNKNOWN
        }
      }
    } catch (_: Exception) { Kind.UNKNOWN }

    private fun absentFromItemFolder(uri: String): Boolean {
      val parent = itemFolderUrl?.toUri() ?: return false
      val doc = uri.toUri()
      val selected = folder?.contentUrl?.toUri() ?: return false
      if (android.os.Build.VERSION.SDK_INT < 29 || selected.scheme != "content" ||
          parent.authority != doc.authority || selected.authority != doc.authority ||
          !DocumentsContract.isTreeUri(parent) || !DocumentsContract.isTreeUri(doc) ||
          DocumentsContract.getTreeDocumentId(parent) != DocumentsContract.getTreeDocumentId(selected) ||
          DocumentsContract.getTreeDocumentId(doc) != DocumentsContract.getTreeDocumentId(selected)) return false
      val rootId = DocumentsContract.getTreeDocumentId(selected)
      val rootDoc = DocumentsContract.buildDocumentUriUsingTree(selected, rootId)
      val parentId = DocumentsContract.getDocumentId(parent)
      val docId = DocumentsContract.getDocumentId(doc)
      if (parentId != rootId && !DocumentsContract.isChildDocument(ctx.contentResolver, rootDoc, parent)) return false
      // Local-provider direct children can be established; opaque/nested ambiguity is deferred.
      if (docId.substringBeforeLast('/', "") != parentId) return false
      val children = DocumentsContract.buildChildDocumentsUriUsingTree(parent, parentId)
      val c = ctx.contentResolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID), null, null, null) ?: return false
      return c.use {
        if (!complete(it)) return false
        while (it.moveToNext()) if (it.getString(0) == docId) return false
        true
      }
    }

    private fun complete(c: Cursor) = !c.extras.getBoolean(DocumentsContract.EXTRA_LOADING, false) &&
            c.extras.getString(DocumentsContract.EXTRA_ERROR) == null

    override fun deleteFile(uri: String): Boolean = try {
      if (!folderReachable() || kind(uri) != Kind.FILE) false
      else if (uri.toUri().scheme == "file") File(uri.toUri().path!!).delete()
      else {
        val c = ctx.contentResolver.query(uri.toUri(), arrayOf(DocumentsContract.Document.COLUMN_FLAGS,
                DocumentsContract.Document.COLUMN_MIME_TYPE), null, null, null)
        val supported = c?.use { complete(it) && it.moveToFirst() &&
                it.getString(1) != DocumentsContract.Document.MIME_TYPE_DIR && !it.getString(1).isNullOrBlank() &&
                it.getInt(0) and DocumentsContract.Document.FLAG_SUPPORTS_DELETE != 0 } == true
        supported && within(uri) && DocumentsContract.deleteDocument(ctx.contentResolver, uri.toUri())
      }
    } catch (_: Exception) { false }
  }
}
