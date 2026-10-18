package expo.modules.baymonagent

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import java.io.File
import java.util.Collections
import java.util.WeakHashMap

/**
 * Ways into Baymon that aren't links: the share sheet ("Share → Baymon") and the system assistant
 * gesture (Baymon set as the digital assistant app). New intents are queued here and announced;
 * JS takes them with `takeIntent`, which also copies shared files into the cache (other apps only
 * lend them to Baymon while the intent is alive).
 */
internal object Intents {
  private const val MAX_FILES = 5
  private const val MAX_FILE_BYTES = 25L * 1024 * 1024
  private const val MAX_TEXT = 20_000

  @Volatile
  var onIntent: (() -> Unit)? = null

  @Volatile
  private var waiting: Intent? = null

  /** Intents already handed to JS (by identity), so a reload doesn't process them again. */
  private val handled: MutableSet<Intent> = Collections.synchronizedSet(Collections.newSetFromMap(WeakHashMap()))

  private fun interesting(intent: Intent) = intent.action in setOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE, Intent.ACTION_ASSIST)

  fun offer(intent: Intent?) {
    if (intent == null || !interesting(intent) || intent in handled) return
    waiting = intent
    onIntent?.invoke()
  }

  /** The next unhandled share or assist intent, parsed, or null. `current` is the activity's launch intent. */
  fun take(context: Context, activity: Activity?): Map<String, Any?>? {
    val intent = waiting?.takeIf { it !in handled }
      ?: activity?.intent?.takeIf { interesting(it) && it !in handled }
      ?: return null
    waiting = null
    handled.add(intent)
    return when (intent.action) {
      Intent.ACTION_ASSIST -> mapOf("kind" to "assist")
      else -> share(context, intent, activity)
    }
  }

  private fun share(context: Context, intent: Intent, activity: Activity?): Map<String, Any?> {
    val items = ArrayList<Map<String, Any?>>()
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim()
    if (!text.isNullOrEmpty()) {
      items.add(
        mapOf(
          "type" to "text",
          "text" to text.take(MAX_TEXT),
          "subject" to intent.getStringExtra(Intent.EXTRA_SUBJECT),
        )
      )
    }
    for (uri in streams(intent).take(MAX_FILES)) items.add(copy(context, uri, intent.type))
    return mapOf("kind" to "share", "from" to sender(context, activity), "items" to items)
  }

  @Suppress("DEPRECATION")
  private fun streams(intent: Intent): List<Uri> {
    val out = LinkedHashSet<Uri>()
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      val list = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
      else intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
      list?.let { out.addAll(it) }
    } else {
      val one = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
      else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      one?.let { out.add(it) }
    }
    // Some apps only put the files in clip data (which is also what carries the read grant).
    intent.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { out.add(it) } }
    return out.toList()
  }

  private fun copy(context: Context, uri: Uri, fallbackMime: String?): Map<String, Any?> {
    val resolver = context.contentResolver
    var name: String? = null
    var size = -1L
    try {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          name = c.getString(0)
          size = if (c.isNull(1)) -1L else c.getLong(1)
        }
      }
    } catch (_: Exception) {
    }
    val displayName = name ?: uri.lastPathSegment?.substringAfterLast('/') ?: "shared"
    val mime = (try { resolver.getType(uri) } catch (_: Exception) { null }) ?: fallbackMime
    if (size > MAX_FILE_BYTES) {
      return mapOf("type" to "file", "name" to displayName, "mime" to mime, "size" to size, "error" to "too_large")
    }
    return try {
      val dir = File(context.cacheDir, "shared").apply { mkdirs() }
      val safe = displayName.replace(Regex("[^\\w.\\- ]+"), "_").take(80)
      val target = File(dir, "${System.currentTimeMillis()}-$safe")
      resolver.openInputStream(uri)?.use { input -> target.outputStream().use { input.copyTo(it) } }
        ?: return mapOf("type" to "file", "name" to displayName, "mime" to mime, "error" to "unreadable")
      mapOf("type" to "file", "uri" to Uri.fromFile(target).toString(), "name" to displayName, "mime" to mime, "size" to target.length())
    } catch (_: Exception) {
      mapOf("type" to "file", "name" to displayName, "mime" to mime, "error" to "unreadable")
    }
  }

  /** The app that shared, when Android says (e.g. "Chrome"). */
  private fun sender(context: Context, activity: Activity?): String? {
    val pkg = activity?.referrer?.takeIf { it.scheme == "android-app" }?.host ?: return null
    if (pkg == context.packageName) return null
    return try {
      val pm = context.packageManager
      pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) {
      null
    }
  }
}
