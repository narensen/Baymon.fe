package expo.modules.baymonagent

import android.app.Notification
import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject

/**
 * Notification access: lists current notifications and replies through their inline Reply action.
 * When the user lets Baymon notice notifications, new ones are also recorded as signals so Baymon
 * can decide whether to speak up (see Signals).
 */
class NotificationsService : NotificationListenerService() {
  companion object {
    @Volatile
    var instance: NotificationsService? = null
      private set

    private const val MAX_TEXT = 500
    /** Status, media and progress notifications say nothing worth speaking up about. */
    private val SKIPPED_CATEGORIES = setOf(
      Notification.CATEGORY_TRANSPORT,
      Notification.CATEGORY_PROGRESS,
      Notification.CATEGORY_SERVICE,
      Notification.CATEGORY_SYSTEM,
      Notification.CATEGORY_STATUS,
      Notification.CATEGORY_NAVIGATION,
      Notification.CATEGORY_CALL,
    )
    private val SKIPPED_PACKAGES = setOf("android", "com.android.systemui")
    private val CODE_CONTEXT = Regex("(?i)otp|one[- ]time|verification|passcode|password|\\bpin\\b|\\bcode\\b")
    private val CODE = Regex("\\b\\d{4,8}\\b")
  }

  /** Last text recorded per notification key, so updates that change nothing aren't sent again. */
  private val lastText = object : LinkedHashMap<String, String>(64, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 100
  }

  override fun onListenerConnected() {
    super.onListenerConnected()
    instance = this
  }

  override fun onListenerDisconnected() {
    instance = null
    super.onListenerDisconnected()
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null || !Signals.enabled(this, "notifications")) return
    val notification = sbn.notification
    if (sbn.packageName == packageName || sbn.packageName in SKIPPED_PACKAGES) return
    if (sbn.isOngoing || notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    if (notification.category?.let { it in SKIPPED_CATEGORIES } == true) return

    val (title, text) = titleAndText(notification)
    if (title.isNullOrBlank() && text.isNullOrBlank()) return
    val fingerprint = "$title\u0000$text"
    synchronized(lastText) {
      if (lastText[sbn.key] == fingerprint) return
      lastText[sbn.key] = fingerprint
    }

    val data = JSONObject().put("app", appLabel(sbn.packageName)).put("package", sbn.packageName)
    title?.let { data.put("title", redact(it).take(MAX_TEXT)) }
    text?.let { data.put("text", redact(it).take(MAX_TEXT)) }
    // Lets Baymon draft a reply that can be sent straight from the bubble (notification_reply).
    if (replyAction(notification) != null) data.put("key", sbn.key).put("can_reply", true)
    Signals.add(this, "notification", isoTime(sbn.postTime), data)
  }

  /** One-time codes are never worth sending anywhere. */
  private fun redact(s: String) = if (CODE_CONTEXT.containsMatchIn(s)) CODE.replace(s, "[code]") else s

  private fun titleAndText(notification: Notification): Pair<String?, String?> {
    val extras = notification.extras
    val title = (extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)
      ?: extras.getCharSequence(Notification.EXTRA_TITLE))?.toString()
    val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
      ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()
    return title to text
  }

  private fun appLabel(pkg: String): String = try {
    packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
  } catch (_: Exception) {
    pkg
  }

  fun list(limit: Int): List<Map<String, Any?>> {
    return activeNotifications.orEmpty()
      .filter { it.packageName != packageName }
      .sortedByDescending { it.postTime }
      .take(limit)
      .map { sbn ->
        val (title, text) = titleAndText(sbn.notification)
        mapOf(
          "key" to sbn.key,
          "app" to appLabel(sbn.packageName),
          "package" to sbn.packageName,
          "title" to title,
          "text" to text,
          "time" to isoTime(sbn.postTime),
          "can_reply" to (replyAction(sbn.notification) != null),
        )
      }
  }

  fun reply(key: String, text: String): Map<String, Any?> {
    val sbn = activeNotifications.orEmpty().firstOrNull { it.key == key }
      ?: throw ElementNotFoundException("That notification is gone. List notifications again.")
    val action = replyAction(sbn.notification)
      ?: throw ActionFailedException("That notification has no Reply action.")
    val inputs = action.remoteInputs
    val results = Bundle().apply { inputs.forEach { putCharSequence(it.resultKey, text) } }
    val intent = Intent()
    RemoteInput.addResultsToIntent(inputs, intent, results)
    action.actionIntent.send(this, 0, intent)
    return mapOf("sent" to true)
  }

  private fun replyAction(notification: Notification): Notification.Action? =
    notification.actions?.firstOrNull { action -> action.remoteInputs?.any { it.allowFreeFormInput } == true }
}
