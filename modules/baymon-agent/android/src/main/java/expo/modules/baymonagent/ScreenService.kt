package expo.modules.baymonagent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.delay
import org.json.JSONObject

/**
 * Screen control. Reads the active window as a numbered list of elements (text, buttons, fields)
 * and performs taps, typing, scrolling and system navigation on them. It only acts when the app
 * asks it to.
 *
 * Only if the user turns on "Screen" under what Baymon notices does it record anything by itself:
 * the app you switch to and a short excerpt of its text, so Baymon can speak up about it.
 */
class ScreenService : AccessibilityService() {
  companion object {
    @Volatile
    var instance: ScreenService? = null
      private set

    private const val MAX_ELEMENTS = 200
    private const val MAX_LABEL = 140
    private const val MAX_DEPTH = 60

    private const val SCREEN_TEXT_CHARS = 400
    /** Let the new screen finish loading before reading it. */
    private const val SCREEN_SETTLE_MS = 1_500L
    /** Don't record the same app again within this window. */
    private const val SCREEN_REPEAT_MS = 10 * 60_000L
  }

  private val lock = Any()
  /** Elements from the last read, numbered from 1 in reading order. */
  private var elements: List<AccessibilityNodeInfo> = emptyList()

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
  }

  override fun onUnbind(intent: Intent?): Boolean {
    instance = null
    handler.removeCallbacksAndMessages(null)
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    instance = null
    handler.removeCallbacksAndMessages(null)
    super.onDestroy()
  }

  // ---------------------------------------------------------------------------------------------
  // Screen context signals (opt-in)
  // ---------------------------------------------------------------------------------------------

  private val handler = Handler(Looper.getMainLooper())
  private var lastPackage: String? = null
  private val lastCaptured = HashMap<String, Long>()
  private var pendingCapture: Runnable? = null

  /** The launcher, the keyboard, the status bar and Baymon itself aren't "apps you're using". */
  private val ignoredPackages: Set<String> by lazy {
    val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    @Suppress("DEPRECATION")
    val launchers = packageManager.queryIntentActivities(home, 0).map { it.activityInfo.packageName }
    setOf(packageName, "android", "com.android.systemui") + launchers
  }

  private fun isIgnored(pkg: String): Boolean {
    if (pkg in ignoredPackages) return true
    val keyboard = Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
    return keyboard?.substringBefore('/') == pkg
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
    val pkg = event.packageName?.toString() ?: return
    if (pkg == lastPackage || isIgnored(pkg)) return
    lastPackage = pkg
    val label = appLabel(pkg) ?: pkg
    // A "remind me when I open …" reminder is waiting for this app: report it (name only) right away.
    if (Signals.isWatched(this, label, pkg)) {
      Signals.add(this, "app_open", isoTime(System.currentTimeMillis()), JSONObject().put("app", label).put("package", pkg))
    }
    pendingCapture?.let { handler.removeCallbacks(it) }
    pendingCapture = null
    if (!Signals.enabled(this, "screen")) return
    val last = lastCaptured[pkg]
    if (last != null && SystemClock.elapsedRealtime() - last < SCREEN_REPEAT_MS) return
    val capture = Runnable { captureScreen(pkg) }
    pendingCapture = capture
    handler.postDelayed(capture, SCREEN_SETTLE_MS)
  }

  private fun captureScreen(pkg: String) {
    pendingCapture = null
    val root = rootInActiveWindow ?: return
    if (root.packageName?.toString() != pkg) return
    val parts = ArrayList<String>()
    var length = 0
    var sensitive = false
    fun walk(node: AccessibilityNodeInfo, depth: Int) {
      if (sensitive || length >= SCREEN_TEXT_CHARS || depth > MAX_DEPTH || !node.isVisibleToUser) return
      if (node.isPassword) {
        sensitive = true
        return
      }
      // What the user is typing stays on the phone.
      if (!node.isEditable) {
        val t = clean(node.text).ifEmpty { clean(node.contentDescription) }
        if (t.isNotEmpty() && parts.lastOrNull() != t) {
          parts.add(t)
          length += t.length + 3
        }
      }
      for (i in 0 until node.childCount) node.getChild(i)?.let { walk(it, depth + 1) }
    }
    walk(root, 0)
    // Sign-in screens are skipped entirely.
    if (sensitive || parts.isEmpty()) return
    lastCaptured[pkg] = SystemClock.elapsedRealtime()
    val data = JSONObject()
      .put("app", appLabel(pkg) ?: pkg)
      .put("text", parts.joinToString(" · ").take(SCREEN_TEXT_CHARS))
    Signals.add(this, "screen", isoTime(System.currentTimeMillis()), data)
  }

  override fun onInterrupt() = Unit

  // ---------------------------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------------------------

  fun readScreen(): Map<String, Any?> {
    val root = rootInActiveWindow
      ?: return mapOf("package" to null, "app" to null, "elements" to 0, "text" to "(nothing readable on screen right now)")
    val found = ArrayList<AccessibilityNodeInfo>()
    val lines = StringBuilder()
    collect(root, 0, insideLabeled = false, found, lines)
    if (found.size >= MAX_ELEMENTS) lines.append("… (more elements below; scroll to see them)\n")
    synchronized(lock) { elements = found }
    val pkg = root.packageName?.toString()
    return mapOf(
      "package" to pkg,
      "app" to appLabel(pkg),
      "elements" to found.size,
      "text" to lines.toString().trimEnd(),
    )
  }

  private fun collect(
    node: AccessibilityNodeInfo,
    depth: Int,
    insideLabeled: Boolean,
    out: MutableList<AccessibilityNodeInfo>,
    lines: StringBuilder,
  ) {
    if (out.size >= MAX_ELEMENTS || depth > MAX_DEPTH || !node.isVisibleToUser) return

    val text = clean(node.text)
    val desc = clean(node.contentDescription)
    val hint = if (Build.VERSION.SDK_INT >= 26) clean(node.hintText) else ""
    val clickable = node.isClickable || node.isLongClickable
    val actionable = clickable || node.isEditable || node.isScrollable || node.isCheckable

    var labeled = insideLabeled
    // Plain text inside a row we've already labelled would just repeat the label.
    val redundantText = insideLabeled && !actionable
    if (!redundantText) {
      val label = when {
        node.isEditable -> desc.ifEmpty { hint }
        desc.isNotEmpty() -> desc
        text.isNotEmpty() -> text
        clickable -> childLabel(node)
        else -> ""
      }
      if (label.isNotEmpty() || node.isEditable || node.isScrollable) {
        out.add(node)
        lines.append(describe(out.size, node, label, text)).append('\n')
        if (clickable && label.isNotEmpty()) labeled = true
      }
    }

    for (i in 0 until node.childCount) {
      val child = node.getChild(i) ?: continue
      collect(child, depth + 1, labeled, out, lines)
      if (out.size >= MAX_ELEMENTS) return
    }
  }

  private fun describe(number: Int, node: AccessibilityNodeInfo, label: String, text: String): String {
    val cls = node.className?.toString().orEmpty()
    val role = when {
      node.isEditable -> "field"
      node.isCheckable -> if (cls.contains("Switch", ignoreCase = true)) "switch" else "checkbox"
      cls.contains("Button") -> "button"
      node.isClickable || node.isLongClickable -> "button"
      node.isScrollable -> "list"
      cls.contains("Image") -> "image"
      else -> "text"
    }
    val sb = StringBuilder("[").append(number).append("] ").append(role)
    if (label.isNotEmpty()) sb.append(" \"").append(label).append('"')
    if (node.isEditable) {
      val showingHint = Build.VERSION.SDK_INT >= 26 && node.isShowingHintText
      when {
        node.isPassword -> sb.append(" (password)")
        !showingHint && text.isNotEmpty() && text != label -> sb.append(" = \"").append(text).append('"')
        else -> sb.append(" (empty)")
      }
    }
    if (node.isCheckable) sb.append(if (node.isChecked) " (on)" else " (off)")
    if (node.isSelected) sb.append(" (selected)")
    if (node.isScrollable) sb.append(" (scrollable)")
    if (!node.isEnabled) sb.append(" (disabled)")
    if (node.isEditable && node.isFocused) sb.append(" (focused)")
    return sb.toString()
  }

  /** A label for a clickable container with no text of its own: its first few descendant texts. */
  private fun childLabel(node: AccessibilityNodeInfo): String {
    val parts = ArrayList<String>()
    fun walk(n: AccessibilityNodeInfo, depth: Int) {
      if (parts.size >= 3 || depth > 6) return
      for (i in 0 until n.childCount) {
        val c = n.getChild(i) ?: continue
        if (!c.isVisibleToUser) continue
        val t = clean(c.contentDescription).ifEmpty { clean(c.text) }
        if (t.isNotEmpty()) parts.add(t) else walk(c, depth + 1)
        if (parts.size >= 3) return
      }
    }
    walk(node, 0)
    return clip(parts.joinToString(" · "))
  }

  private fun clean(value: CharSequence?): String = clip(value?.toString()?.replace(Regex("\\s+"), " ")?.trim().orEmpty())

  private fun clip(s: String) = if (s.length > MAX_LABEL) s.take(MAX_LABEL - 1) + "…" else s

  private fun appLabel(pkg: String?): String? {
    if (pkg == null) return null
    return try {
      packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) {
      pkg
    }
  }

  /** The app the user was in before Baymon (Baymon itself, the launcher and the keyboard don't count). */
  fun previousApp(): Map<String, Any?>? {
    val pkg = lastPackage ?: return null
    return mapOf("package" to pkg, "app" to (appLabel(pkg) ?: pkg))
  }

  /**
   * Reads a long screen in full: collects the text, scrolls, and repeats until nothing new appears
   * (or `maxPages`). With `app` (or when Baymon itself is in front), that app is brought forward
   * first and Baymon comes back afterwards. Text being typed and password fields are skipped.
   */
  suspend fun readAll(maxPages: Int, app: String?): Map<String, Any?> {
    val front = rootInActiveWindow?.packageName?.toString()
    val target = app?.trim()?.takeIf { it.isNotEmpty() }?.let { resolvePackage(it) }
      ?: if (front == packageName) lastPackage else null
    var cameBack = false
    if (target != null && target != front) {
      val launch = packageManager.getLaunchIntentForPackage(target)
        ?: throw AppNotFoundException("Can’t bring $target to the front.")
      startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      cameBack = true
      delay(1_500)
    }
    val lines = LinkedHashSet<String>()
    var pages = 0
    var reachedEnd = false
    val shownPkg = rootInActiveWindow?.packageName?.toString()
    try {
      while (pages < maxPages.coerceIn(1, 20)) {
        val before = lines.size
        rootInActiveWindow?.let { collectLines(it, 0, lines) }
        pages++
        if (lines.size == before || lines.sumOf { it.length } > 40_000) {
          reachedEnd = lines.size == before
          break
        }
        if (!scrollForward()) {
          reachedEnd = true
          break
        }
        delay(700)
      }
    } finally {
      if (cameBack) packageManager.getLaunchIntentForPackage(packageName)?.let {
        startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
      }
    }
    return mapOf(
      "app" to appLabel(shownPkg),
      "package" to shownPkg,
      "pages" to pages,
      "complete" to reachedEnd,
      "text" to lines.joinToString("\n").take(30_000),
    )
  }

  private fun resolvePackage(query: String): String? {
    if (packageManager.getLaunchIntentForPackage(query) != null) return query
    val q = query.lowercase()
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    @Suppress("DEPRECATION")
    val apps = packageManager.queryIntentActivities(launcher, 0)
    return apps.firstOrNull { it.loadLabel(packageManager).toString().lowercase() == q }?.activityInfo?.packageName
      ?: apps.firstOrNull { it.loadLabel(packageManager).toString().lowercase().contains(q) }?.activityInfo?.packageName
  }

  private fun collectLines(node: AccessibilityNodeInfo, depth: Int, out: MutableSet<String>) {
    if (depth > MAX_DEPTH || !node.isVisibleToUser || node.isPassword) return
    if (!node.isEditable) {
      val t = node.text?.toString()?.replace(Regex("\\s+"), " ")?.trim().orEmpty()
        .ifEmpty { node.contentDescription?.toString()?.replace(Regex("\\s+"), " ")?.trim().orEmpty() }
      if (t.length > 1) out.add(t)
    }
    for (i in 0 until node.childCount) node.getChild(i)?.let { collectLines(it, depth + 1, out) }
  }

  /** Scrolls the biggest scrollable area forward; false when nothing would move. */
  private fun scrollForward(): Boolean {
    var best: AccessibilityNodeInfo? = null
    var bestArea = 0
    fun find(n: AccessibilityNodeInfo, depth: Int) {
      if (depth > MAX_DEPTH || !n.isVisibleToUser) return
      if (n.isScrollable) {
        val r = Rect().also { n.getBoundsInScreen(it) }
        val area = r.width() * r.height()
        if (area > bestArea) {
          best = n
          bestArea = area
        }
      }
      for (i in 0 until n.childCount) n.getChild(i)?.let { find(it, depth + 1) }
    }
    rootInActiveWindow?.let { find(it, 0) }
    return best?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD) == true
  }

  fun containsText(text: String): Boolean =
    rootInActiveWindow?.findAccessibilityNodeInfosByText(text)?.any { it.isVisibleToUser } == true

  // ---------------------------------------------------------------------------------------------
  // Acting
  // ---------------------------------------------------------------------------------------------

  private fun elementAt(number: Int): AccessibilityNodeInfo {
    val node = synchronized(lock) { elements.getOrNull(number - 1) }
      ?: throw ElementNotFoundException("Element $number isn't on the last screen read. Read the screen again.")
    if (!node.refresh()) throw ElementNotFoundException("Element $number is no longer on screen. Read the screen again.")
    return node
  }

  private fun findByText(text: String): AccessibilityNodeInfo? {
    val matches = rootInActiveWindow?.findAccessibilityNodeInfosByText(text)?.filter { it.isVisibleToUser }.orEmpty()
    return matches.firstOrNull {
      it.text?.toString().equals(text, ignoreCase = true) || it.contentDescription?.toString().equals(text, ignoreCase = true)
    } ?: matches.firstOrNull()
  }

  private fun target(element: Int?, text: String?): AccessibilityNodeInfo = when {
    element != null -> elementAt(element)
    !text.isNullOrBlank() ->
      findByText(text) ?: throw ElementNotFoundException("Nothing on screen says \"$text\". Read the screen again.")
    else -> throw ElementNotFoundException("Say which element: its number from the last screen read, or its text.")
  }

  fun tap(element: Int?, text: String?): Map<String, Any?> {
    val node = target(element, text)
    var clickable: AccessibilityNodeInfo? = node
    while (clickable != null && !clickable.isClickable) clickable = clickable.parent
    if (clickable != null && clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return mapOf("tapped" to true)
    // Some apps draw buttons that don't expose a click action; a real touch still works.
    if (gesture(node, longPress = false)) return mapOf("tapped" to true, "method" to "touch")
    throw ActionFailedException("Couldn't tap that element.")
  }

  fun longPress(element: Int?, text: String?): Map<String, Any?> {
    val node = target(element, text)
    var target: AccessibilityNodeInfo? = node
    while (target != null && !target.isLongClickable) target = target.parent
    if (target != null && target.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)) return mapOf("pressed" to true)
    if (gesture(node, longPress = true)) return mapOf("pressed" to true, "method" to "touch")
    throw ActionFailedException("Couldn't long-press that element.")
  }

  fun typeText(element: Int?, text: String, submit: Boolean): Map<String, Any?> {
    val node = when {
      element != null -> elementAt(element)
      else -> rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: firstEditable(rootInActiveWindow)
    } ?: throw ElementNotFoundException("No text field on screen. Read the screen and pass the field's number.")
    val field = if (node.isEditable) node else firstEditable(node)
      ?: throw ElementNotFoundException("Element ${element ?: ""} isn't a text field.")
    field.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
    val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
    if (!field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) throw ActionFailedException("Couldn't type into that field.")
    var submitted = false
    if (submit && Build.VERSION.SDK_INT >= 30) {
      submitted = field.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
    }
    return mapOf("typed" to true, "submitted" to submitted)
  }

  private fun firstEditable(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
    if (node == null) return null
    if (node.isEditable && node.isVisibleToUser) return node
    for (i in 0 until node.childCount) firstEditable(node.getChild(i))?.let { return it }
    return null
  }

  private fun firstScrollable(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
    if (node == null) return null
    if (node.isScrollable && node.isVisibleToUser) return node
    for (i in 0 until node.childCount) firstScrollable(node.getChild(i))?.let { return it }
    return null
  }

  fun scroll(direction: String, element: Int?): Map<String, Any?> {
    val forward = direction == "down" || direction == "right"
    var node: AccessibilityNodeInfo? = element?.let { elementAt(it) } ?: firstScrollable(rootInActiveWindow)
    while (node != null && !node.isScrollable) node = node.parent
    val action = if (forward) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
    if (node != null && node.performAction(action)) return mapOf("scrolled" to true)
    if (swipe(direction)) return mapOf("scrolled" to true, "method" to "touch")
    throw ActionFailedException("Nothing to scroll in that direction.")
  }

  fun global(action: String): Map<String, Any?> {
    val code = when (action) {
      "back" -> GLOBAL_ACTION_BACK
      "home" -> GLOBAL_ACTION_HOME
      "recents" -> GLOBAL_ACTION_RECENTS
      "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
      "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
      "lock" -> if (Build.VERSION.SDK_INT >= 28) GLOBAL_ACTION_LOCK_SCREEN else null
      "screenshot" -> if (Build.VERSION.SDK_INT >= 28) GLOBAL_ACTION_TAKE_SCREENSHOT else null
      else -> null
    } ?: throw ActionFailedException("Unknown or unsupported navigation action: $action")
    if (!performGlobalAction(code)) throw ActionFailedException("The system didn't accept \"$action\".")
    return mapOf("done" to true)
  }

  private fun gesture(node: AccessibilityNodeInfo, longPress: Boolean): Boolean {
    val bounds = Rect().also { node.getBoundsInScreen(it) }
    if (bounds.isEmpty) return false
    val path = Path().apply { moveTo(bounds.exactCenterX(), bounds.exactCenterY()) }
    val stroke = GestureDescription.StrokeDescription(path, 0, if (longPress) 700L else 60L)
    return dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
  }

  private fun swipe(direction: String): Boolean {
    val metrics = resources.displayMetrics
    val w = metrics.widthPixels.toFloat()
    val h = metrics.heightPixels.toFloat()
    // "down" means see content further down, so the finger moves up.
    val (from, to) = when (direction) {
      "down" -> (w / 2 to h * 0.7f) to (w / 2 to h * 0.3f)
      "up" -> (w / 2 to h * 0.3f) to (w / 2 to h * 0.7f)
      "right" -> (w * 0.8f to h / 2) to (w * 0.2f to h / 2)
      "left" -> (w * 0.2f to h / 2) to (w * 0.8f to h / 2)
      else -> return false
    }
    val path = Path().apply {
      moveTo(from.first, from.second)
      lineTo(to.first, to.second)
    }
    val stroke = GestureDescription.StrokeDescription(path, 0, 300L)
    return dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
  }
}
