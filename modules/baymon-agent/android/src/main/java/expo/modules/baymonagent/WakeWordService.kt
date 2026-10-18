package expo.modules.baymonagent

import ai.picovoice.porcupine.Porcupine
import ai.picovoice.porcupine.PorcupineManager
import ai.picovoice.porcupine.PorcupineManagerCallback
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.Log

/**
 * "Hey Baymon": listens for a wake word on the device (Picovoice Porcupine; audio never leaves the
 * phone) and opens Baymon in talk mode. Runs as a microphone foreground service with an ongoing
 * notification, so it has to be started while Baymon is open. While Baymon itself is on screen it
 * stays paused and lets the app use the microphone.
 */
class WakeWordService : Service() {
  companion object {
    private const val TAG = "BaymonWakeWord"
    private const val CHANNEL = "baymon_wake_word"
    private const val ALERT_CHANNEL = "baymon_wake_word_alert"
    private const val NOTIFICATION_ID = 4107
    private const val ALERT_ID = 4108
    private const val PREFS = "baymon_wake_word"
    /** After a detection, listen again this long later unless Baymon took over the microphone. */
    private const val RESUME_AFTER_MS = 30_000L

    @Volatile
    private var instance: WakeWordService? = null

    /** Set by the app: paused while Baymon is in the foreground. */
    @Volatile
    private var pausedByApp = false

    @Volatile
    var lastError: String? = null
      private set

    fun isRunning() = instance != null

    fun isListening() = instance?.porcupine != null

    fun start(context: Context, accessKey: String, keyword: String, keywordPath: String?, sensitivity: Float) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString("access_key", accessKey)
        .putString("keyword", keyword)
        .putString("keyword_path", keywordPath)
        .putFloat("sensitivity", sensitivity.coerceIn(0.1f, 0.95f))
        .apply()
      lastError = null
      val intent = Intent(context, WakeWordService::class.java)
      instance?.let {
        // Already running: pick up the new settings.
        it.restartListening()
        return
      }
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, WakeWordService::class.java))
    }

    fun pause() {
      pausedByApp = true
      instance?.main?.post { instance?.stopListening() }
    }

    fun resume() {
      pausedByApp = false
      instance?.main?.post { instance?.startListening() }
    }
  }

  private val main = Handler(Looper.getMainLooper())
  private var porcupine: PorcupineManager? = null
  private val resumeLater = Runnable { if (!pausedByApp) startListening() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      createChannels()
      val notification = ongoingNotification()
      if (Build.VERSION.SDK_INT >= 29) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      // E.g. started from the background on Android 14+: it can only start while Baymon is open.
      lastError = "Couldn’t start listening: ${e.message}"
      Log.w(TAG, lastError!!)
      stopSelf()
      return START_NOT_STICKY
    }
    if (!pausedByApp) startListening()
    // Not sticky: Android can't restart a microphone service from the background anyway.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    main.removeCallbacks(resumeLater)
    stopListening()
    instance = null
    super.onDestroy()
  }

  private fun restartListening() {
    main.post {
      stopListening()
      if (!pausedByApp) startListening()
    }
  }

  private fun startListening() {
    if (porcupine != null) return
    val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val accessKey = prefs.getString("access_key", null)
    if (accessKey.isNullOrBlank()) {
      lastError = "Add your Picovoice AccessKey in Settings."
      return
    }
    try {
      val builder = PorcupineManager.Builder()
        .setAccessKey(accessKey)
        .setSensitivity(prefs.getFloat("sensitivity", 0.6f))
      val path = prefs.getString("keyword_path", null)
      if (!path.isNullOrBlank()) {
        builder.setKeywordPath(path)
      } else {
        val name = prefs.getString("keyword", "jarvis")!!.uppercase().replace(' ', '_')
        builder.setKeyword(Porcupine.BuiltInKeyword.valueOf(name))
      }
      porcupine = builder.build(applicationContext, PorcupineManagerCallback { main.post { onWake() } }).also { it.start() }
      lastError = null
    } catch (e: Exception) {
      porcupine = null
      lastError = e.message ?: "The wake word couldn’t start."
      Log.w(TAG, "start failed", e)
    }
  }

  private fun stopListening() {
    val p = porcupine ?: return
    porcupine = null
    try {
      p.stop()
      p.delete()
    } catch (_: Exception) {
    }
  }

  private fun onWake() {
    // Free the microphone for Baymon's own recording.
    stopListening()
    main.removeCallbacks(resumeLater)
    main.postDelayed(resumeLater, RESUME_AFTER_MS)
    // Opening an activity from the background needs "display over other apps".
    if (Settings.canDrawOverlays(this)) {
      try {
        startActivity(talkIntent(this))
        return
      } catch (_: Exception) {
      }
    }
    val alert = notificationBuilder(ALERT_CHANNEL)
      .setSmallIcon(R.drawable.baymon_tile)
      .setContentTitle("Baymon is here")
      .setContentText("Tap to talk")
      .setCategory(Notification.CATEGORY_CALL)
      .setAutoCancel(true)
      .setContentIntent(talkPendingIntent(this, 12))
      .build()
    getSystemService(NotificationManager::class.java)?.notify(ALERT_ID, alert)
  }

  private fun notificationBuilder(channel: String): Notification.Builder =
    if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, channel) else @Suppress("DEPRECATION") Notification.Builder(this)

  private fun createChannels() {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL, getString(R.string.baymon_wake_word_channel), NotificationManager.IMPORTANCE_MIN)
    )
    manager.createNotificationChannel(
      NotificationChannel(ALERT_CHANNEL, "Wake word heard", NotificationManager.IMPORTANCE_HIGH)
    )
  }

  private fun ongoingNotification(): Notification {
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 13, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    return notificationBuilder(CHANNEL)
      .setSmallIcon(R.drawable.baymon_tile)
      .setContentTitle(getString(R.string.baymon_wake_word_listening))
      .setContentText("Tap to open Baymon. Turn it off in Settings → Quick access.")
      .setOngoing(true)
      .setContentIntent(open)
      .build()
  }
}
