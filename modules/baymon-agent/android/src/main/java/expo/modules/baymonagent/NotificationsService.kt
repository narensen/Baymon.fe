package expo.modules.baymonagent

import android.app.Notification
import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService

/** Notification access: lists current notifications and replies through their inline Reply action. */
class NotificationsService : NotificationListenerService() {
  companion object {
    @Volatile
    var instance: NotificationsService? = null
      private set
  }

  override fun onListenerConnected() {
    super.onListenerConnected()
    instance = this
  }

  override fun onListenerDisconnected() {
    instance = null
    super.onListenerDisconnected()
  }

  fun list(limit: Int): List<Map<String, Any?>> {
    val pm = packageManager
    return activeNotifications.orEmpty()
      .filter { it.packageName != packageName }
      .sortedByDescending { it.postTime }
      .take(limit)
      .map { sbn ->
        val extras = sbn.notification.extras
        val app = try {
          pm.getApplicationLabel(pm.getApplicationInfo(sbn.packageName, 0)).toString()
        } catch (_: Exception) {
          sbn.packageName
        }
        mapOf(
          "key" to sbn.key,
          "app" to app,
          "package" to sbn.packageName,
          "title" to (extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)
            ?: extras.getCharSequence(Notification.EXTRA_TITLE))?.toString(),
          "text" to (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString(),
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
