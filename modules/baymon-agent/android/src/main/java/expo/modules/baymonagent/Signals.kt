package expo.modules.baymonagent

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the phone noticed while JS may not have been running, kept until JS takes it:
 * - signals: notifications and screen changes, sent to `/v1/nudges/check`;
 * - bubble actions: what the user did with a floating bubble (opened, dismissed, snoozed, done).
 *
 * Both survive the app being killed (SharedPreferences), so the next check sends them.
 */
internal object Signals {
  private const val PREFS = "baymon_agent_signals"
  private const val MAX_SIGNALS = 40
  private const val MAX_ACTIONS = 40

  /** Called with the signal type whenever one is recorded (the module forwards it to JS). */
  @Volatile
  var onSignal: ((String) -> Unit)? = null

  /** Called whenever a bubble action is recorded. */
  @Volatile
  var onAction: (() -> Unit)? = null

  private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** Which sources the user lets Baymon notice ("notifications", "screen"). Off until JS says otherwise. */
  fun enabled(context: Context, source: String) = prefs(context).getBoolean("source_$source", false)

  fun setSources(context: Context, sources: Map<String, Boolean>) {
    prefs(context).edit().apply { sources.forEach { (k, v) -> putBoolean("source_$k", v) } }.apply()
  }

  /**
   * Apps a "remind me when I open …" reminder is waiting for. Opening one is reported (app name only)
   * even when screen context is off, because the user asked for it.
   */
  @Volatile
  private var watched: List<String>? = null

  fun setWatchedApps(context: Context, apps: List<String>) {
    val clean = apps.map { it.trim().lowercase() }.filter { it.isNotEmpty() }.distinct()
    watched = clean
    prefs(context).edit().putString("watched_apps", JSONArray(clean).toString()).apply()
  }

  fun isWatched(context: Context, label: String, pkg: String): Boolean {
    val list = watched ?: try {
      val raw = JSONArray(prefs(context).getString("watched_apps", null) ?: "[]")
      List(raw.length()) { raw.getString(it) }.also { watched = it }
    } catch (_: Exception) {
      emptyList()
    }
    val name = label.lowercase()
    return list.any { it == name || it == pkg.lowercase() || (it.length >= 3 && name.contains(it)) }
  }

  fun add(context: Context, type: String, at: String, data: JSONObject) {
    val signal = JSONObject().put("type", type).put("at", at).put("data", data)
    synchronized(this) { append(context, "signals", signal, MAX_SIGNALS) }
    onSignal?.invoke(type)
  }

  fun addAction(context: Context, id: String, action: String, snoozeMinutes: Int? = null, reason: String? = null) {
    val entry = JSONObject().put("id", id).put("action", action).put("at", isoTime(System.currentTimeMillis()))
    if (snoozeMinutes != null) entry.put("snooze_minutes", snoozeMinutes)
    if (reason != null) entry.put("reason", reason)
    synchronized(this) { append(context, "actions", entry, MAX_ACTIONS) }
    onAction?.invoke()
  }

  /** Returns everything recorded so far as a JSON array and clears it. */
  fun take(context: Context, key: String): String = synchronized(this) {
    val p = prefs(context)
    val value = p.getString(key, null) ?: "[]"
    p.edit().remove(key).apply()
    value
  }

  private fun append(context: Context, key: String, item: JSONObject, max: Int) {
    val p = prefs(context)
    val list = try {
      JSONArray(p.getString(key, null) ?: "[]")
    } catch (_: Exception) {
      JSONArray()
    }
    list.put(item)
    val kept = JSONArray()
    for (i in maxOf(0, list.length() - max) until list.length()) kept.put(list.get(i))
    p.edit().putString(key, kept.toString()).apply()
  }
}
