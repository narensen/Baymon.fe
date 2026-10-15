package expo.modules.baymonagent

import android.content.ActivityNotFoundException
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.AlarmClock
import android.provider.MediaStore
import android.provider.Settings
import android.view.KeyEvent
import android.webkit.MimeTypeMap
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.delay
import java.io.File

// The JS error code is derived from the class name, e.g. ScreenAccessOffException → ERR_SCREEN_ACCESS_OFF.
class ScreenAccessOffException :
  CodedException("Screen control is off. Turn on Baymon in Settings → Accessibility.")
class NotificationAccessOffException :
  CodedException("Notification access is off. Turn on Baymon in Settings → Notification access.")
class AllFilesAccessOffException :
  CodedException("All-files access is off. Allow it for Baymon in Settings → Special app access.")
class ElementNotFoundException(message: String) : CodedException(message)
class ActionFailedException(message: String) : CodedException(message)
class AppNotFoundException(message: String) : CodedException(message)
class NoHandlerException(message: String) : CodedException(message)

class BaymonAgentModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw ActionFailedException("The app isn't ready yet.")

  private fun screen() = ScreenService.instance ?: throw ScreenAccessOffException()
  private fun notifications() = NotificationsService.instance ?: throw NotificationAccessOffException()

  override fun definition() = ModuleDefinition {
    Name("BaymonAgent")

    Function("getStatus") {
      mapOf(
        "screenAccess" to (ScreenService.instance != null),
        "notificationAccess" to notificationAccessEnabled(),
        "allFilesAccess" to allFilesAccess(),
      )
    }
    Function("openSystemSettings") { page: String -> openSystemSettings(page) }

    // Screen
    AsyncFunction("readScreen") { screen().readScreen() }
    AsyncFunction("tap") { element: Int?, text: String? -> screen().tap(element, text) }
    AsyncFunction("longPress") { element: Int?, text: String? -> screen().longPress(element, text) }
    AsyncFunction("typeText") { element: Int?, text: String, submit: Boolean -> screen().typeText(element, text, submit) }
    AsyncFunction("scroll") { direction: String, element: Int? -> screen().scroll(direction, element) }
    AsyncFunction("navigate") { action: String -> screen().global(action) }
    AsyncFunction("waitForText") Coroutine { text: String, timeoutMs: Int ->
      val service = screen()
      val deadline = System.currentTimeMillis() + timeoutMs.coerceIn(500, 20_000)
      while (System.currentTimeMillis() < deadline) {
        if (service.containsText(text)) return@Coroutine true
        delay(300)
      }
      false
    }

    // Apps
    AsyncFunction("listApps") { launchableApps() }
    AsyncFunction("openApp") { query: String -> openApp(query) }
    Function("openStorePage") { query: String -> openStorePage(query) }
    Function("uninstallApp") { packageName: String ->
      start(Intent(Intent.ACTION_DELETE, Uri.parse("package:$packageName")))
    }
    Function("openAppSettings") { packageName: String ->
      start(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
    }

    // Clock
    Function("setAlarm") { hour: Int, minute: Int, label: String?, days: List<Int>? ->
      val intent = Intent(AlarmClock.ACTION_SET_ALARM)
        .putExtra(AlarmClock.EXTRA_HOUR, hour)
        .putExtra(AlarmClock.EXTRA_MINUTES, minute)
        .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
      label?.let { intent.putExtra(AlarmClock.EXTRA_MESSAGE, it) }
      // Calendar.SUNDAY = 1 … SATURDAY = 7.
      if (!days.isNullOrEmpty()) intent.putExtra(AlarmClock.EXTRA_DAYS, ArrayList(days))
      start(intent)
    }
    Function("setTimer") { seconds: Int, label: String? ->
      val intent = Intent(AlarmClock.ACTION_SET_TIMER)
        .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
        .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
      label?.let { intent.putExtra(AlarmClock.EXTRA_MESSAGE, it) }
      start(intent)
    }

    // Device
    Function("setTorch") { on: Boolean ->
      val cameras = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val id = cameras.cameraIdList.firstOrNull {
        cameras.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
      } ?: throw ActionFailedException("This phone has no flashlight.")
      cameras.setTorchMode(id, on)
    }
    Function("mediaControl") { action: String -> mediaControl(action) }

    // Files
    AsyncFunction("findFiles") { query: String, limit: Int -> findFiles(query, limit.coerceIn(1, 20)) }
    AsyncFunction("recentMedia") { kind: String, limit: Int -> recentMedia(kind, limit.coerceIn(1, 30)) }

    // Notifications
    AsyncFunction("listNotifications") { limit: Int -> notifications().list(limit.coerceIn(1, 50)) }
    AsyncFunction("replyToNotification") { key: String, text: String -> notifications().reply(key, text) }
  }

  // -----------------------------------------------------------------------------------------------

  private fun start(intent: Intent) {
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
      throw NoHandlerException("No app on this phone can do that.")
    }
  }

  private fun notificationAccessEnabled(): Boolean =
    Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
      ?.contains(context.packageName) == true

  private fun allFilesAccess(): Boolean =
    if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
    else context.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

  private fun openSystemSettings(page: String) {
    val pkg = Uri.parse("package:${context.packageName}")
    val intent = when (page) {
      "accessibility" -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
      "notification_access" -> Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      "all_files" ->
        if (Build.VERSION.SDK_INT >= 30) Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, pkg)
        else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg)
      "write_settings" -> Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, pkg)
      "app" -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg)
      "wifi" -> if (Build.VERSION.SDK_INT >= 29) Intent(Settings.Panel.ACTION_WIFI) else Intent(Settings.ACTION_WIFI_SETTINGS)
      "internet" -> if (Build.VERSION.SDK_INT >= 29) Intent(Settings.Panel.ACTION_INTERNET_CONNECTIVITY) else Intent(Settings.ACTION_WIRELESS_SETTINGS)
      "volume" -> if (Build.VERSION.SDK_INT >= 29) Intent(Settings.Panel.ACTION_VOLUME) else Intent(Settings.ACTION_SOUND_SETTINGS)
      "nfc" -> if (Build.VERSION.SDK_INT >= 29) Intent(Settings.Panel.ACTION_NFC) else Intent(Settings.ACTION_NFC_SETTINGS)
      "bluetooth" -> Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
      "location" -> Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
      "display" -> Intent(Settings.ACTION_DISPLAY_SETTINGS)
      "sound" -> Intent(Settings.ACTION_SOUND_SETTINGS)
      "battery" -> Intent(Intent.ACTION_POWER_USAGE_SUMMARY)
      "airplane" -> Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS)
      "dnd" -> Intent("android.settings.ZEN_MODE_SETTINGS")
      "notifications" -> Intent("android.settings.NOTIFICATION_SETTINGS")
      "date" -> Intent(Settings.ACTION_DATE_SETTINGS)
      "storage" -> Intent(Settings.ACTION_INTERNAL_STORAGE_SETTINGS)
      "apps" -> Intent(Settings.ACTION_APPLICATION_SETTINGS)
      "security" -> Intent(Settings.ACTION_SECURITY_SETTINGS)
      else -> Intent(Settings.ACTION_SETTINGS)
    }
    start(intent)
  }

  private fun launchableApps(): List<Map<String, String>> {
    val pm = context.packageManager
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val activities = if (Build.VERSION.SDK_INT >= 33) {
      pm.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0))
    } else {
      @Suppress("DEPRECATION") pm.queryIntentActivities(launcher, 0)
    }
    return activities
      .map { mapOf("name" to it.loadLabel(pm).toString(), "package" to it.activityInfo.packageName) }
      .distinctBy { it["package"] }
      .sortedBy { it["name"]!!.lowercase() }
  }

  /** Opens an app by package name, or by its name as shown on the home screen. */
  private fun openApp(query: String): Map<String, String> {
    val pm = context.packageManager
    pm.getLaunchIntentForPackage(query)?.let {
      start(it)
      return mapOf("package" to query)
    }
    val q = query.trim().lowercase()
    val apps = launchableApps()
    val match = apps.firstOrNull { it["name"]!!.lowercase() == q }
      ?: apps.firstOrNull { it["name"]!!.lowercase().startsWith(q) }
      ?: apps.firstOrNull { it["name"]!!.lowercase().contains(q) }
      ?: throw AppNotFoundException("No installed app matches \"$query\".")
    val launch = pm.getLaunchIntentForPackage(match["package"]!!)
      ?: throw AppNotFoundException("${match["name"]} can't be opened directly.")
    start(launch)
    return match
  }

  private fun openStorePage(query: String) {
    val isPackage = Regex("^[a-zA-Z][\\w]*(\\.[\\w]+)+$").matches(query.trim())
    val market = if (isPackage) "market://details?id=${query.trim()}" else "market://search?q=${Uri.encode(query)}&c=apps"
    try {
      start(Intent(Intent.ACTION_VIEW, Uri.parse(market)).setPackage("com.android.vending"))
    } catch (_: NoHandlerException) {
      val web = if (isPackage) "https://play.google.com/store/apps/details?id=${query.trim()}"
      else "https://play.google.com/store/search?q=${Uri.encode(query)}&c=apps"
      start(Intent(Intent.ACTION_VIEW, Uri.parse(web)))
    }
  }

  private fun mediaControl(action: String) {
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    fun key(code: Int) {
      audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
      audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
    }
    fun adjust(direction: Int) =
      audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI)
    when (action) {
      "play_pause" -> key(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
      "next" -> key(KeyEvent.KEYCODE_MEDIA_NEXT)
      "previous" -> key(KeyEvent.KEYCODE_MEDIA_PREVIOUS)
      "stop" -> key(KeyEvent.KEYCODE_MEDIA_STOP)
      "volume_up" -> adjust(AudioManager.ADJUST_RAISE)
      "volume_down" -> adjust(AudioManager.ADJUST_LOWER)
      "mute" -> adjust(AudioManager.ADJUST_TOGGLE_MUTE)
      else -> throw ActionFailedException("Unknown media action: $action")
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Files
  // -----------------------------------------------------------------------------------------------

  private fun fileInfo(file: File): Map<String, Any?> = mapOf(
    "name" to file.name,
    "path" to file.absolutePath,
    "uri" to Uri.fromFile(file).toString(),
    "folder" to file.parentFile?.name,
    "size" to file.length(),
    "modified_at" to isoTime(file.lastModified()),
    "mime" to MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()),
  )

  /** Words in a filename: "VII_SEM-scheme.pdf" → "vii sem scheme pdf". */
  private fun words(name: String) = name.lowercase().replace(Regex("[_\\-.()\\[\\]]+"), " ")

  /**
   * Finds files whose names contain the query's words, across shared storage (Downloads,
   * Documents, WhatsApp media…). Needs all-files access; private app folders are skipped.
   */
  private fun findFiles(query: String, limit: Int): Map<String, Any?> {
    if (!allFilesAccess()) throw AllFilesAccessOffException()
    val tokens = words(query).split(' ').filter { it.isNotBlank() }
    if (tokens.isEmpty()) return mapOf("files" to emptyList<Any>())

    val root = Environment.getExternalStorageDirectory()
    val skip = setOf(File(root, "Android/data").absolutePath, File(root, "Android/obb").absolutePath)
    data class Hit(val file: File, val score: Int)
    val hits = ArrayList<Hit>()
    val stack = ArrayDeque<Pair<File, Int>>().apply { add(root to 0) }
    var visited = 0
    while (stack.isNotEmpty() && visited < 80_000) {
      val (dir, depth) = stack.removeLast()
      val children = dir.listFiles() ?: continue
      for (f in children) {
        if (f.name.startsWith(".")) continue
        visited++
        if (f.isDirectory) {
          if (depth < 9 && f.absolutePath !in skip) stack.add(f to depth + 1)
          continue
        }
        val name = words(f.name)
        val score = tokens.count { name.contains(it) }
        if (score > 0) hits.add(Hit(f, score))
      }
    }
    // Every word matching beats a partial match; then newest first.
    val best = hits.maxOfOrNull { it.score } ?: 0
    val files = hits
      .filter { it.score == best }
      .sortedByDescending { it.file.lastModified() }
      .take(limit)
      .map { fileInfo(it.file) }
    return mapOf("files" to files, "matched_all_words" to (best == tokens.size))
  }

  @Suppress("DEPRECATION") // MediaColumns.DATA
  private fun recentMedia(kind: String, limit: Int): List<Map<String, Any?>> {
    if (!allFilesAccess()) throw AllFilesAccessOffException()
    val collection = when (kind) {
      "video" -> MediaStore.Video.Media.EXTERNAL_CONTENT_URI
      "screenshot", "photo" -> MediaStore.Images.Media.EXTERNAL_CONTENT_URI
      else -> throw ActionFailedException("Unknown media kind: $kind")
    }
    val projection = arrayOf(
      MediaStore.MediaColumns._ID,
      MediaStore.MediaColumns.DISPLAY_NAME,
      MediaStore.MediaColumns.SIZE,
      MediaStore.MediaColumns.DATE_ADDED,
      MediaStore.MediaColumns.MIME_TYPE,
      // Deprecated but still filled in; with all-files access the path is readable, which the
      // share flow needs (it copies the file before sharing).
      MediaStore.MediaColumns.DATA,
    )
    val selection = if (kind == "screenshot") "${MediaStore.MediaColumns.DISPLAY_NAME} LIKE ?" else null
    val args = if (kind == "screenshot") arrayOf("%Screenshot%") else null
    val out = ArrayList<Map<String, Any?>>()
    context.contentResolver.query(collection, projection, selection, args, "${MediaStore.MediaColumns.DATE_ADDED} DESC")
      ?.use { c ->
        while (c.moveToNext() && out.size < limit) {
          val id = c.getLong(0)
          val path = c.getString(5)
          out.add(
            mapOf(
              "name" to c.getString(1),
              "path" to path,
              "uri" to (path?.let { Uri.fromFile(File(it)).toString() } ?: ContentUris.withAppendedId(collection, id).toString()),
              "size" to c.getLong(2),
              "modified_at" to isoTime(c.getLong(3) * 1000),
              "mime" to c.getString(4),
            )
          )
        }
      }
    return out
  }
}
