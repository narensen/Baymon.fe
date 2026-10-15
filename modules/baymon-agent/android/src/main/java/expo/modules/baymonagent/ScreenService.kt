package expo.modules.baymonagent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Screen control. Reads the active window as a numbered list of elements (text, buttons, fields)
 * and performs taps, typing, scrolling and system navigation on them. It only acts when the app
 * asks it to; it doesn't record anything on its own.
 */
class ScreenService : AccessibilityService() {
  companion object {
    @Volatile
    var instance: ScreenService? = null
      private set

    private const val MAX_ELEMENTS = 200
    private const val MAX_LABEL = 140
    private const val MAX_DEPTH = 60
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
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    instance = null
    super.onDestroy()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

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
