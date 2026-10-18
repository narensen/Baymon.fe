package expo.modules.baymonagent

import android.animation.LayoutTransition
import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

/** One bubble, as sent from JS. */
internal data class Bubble(
  val id: String,
  val label: String,
  val urgent: Boolean,
  val text: String,
  val expiresAt: Long,
  /** Deep link that opens the chat with this bubble (e.g. baymon://nudge/<id>). */
  val url: String,
  /** Opens the chat in talk mode: Baymon reads the bubble out and listens for the answer. */
  val talkUrl: String,
  /** Opens the chat with the reply draft ready to edit. */
  val editUrl: String,
  /** A reply Baymon drafted, e.g. to the message that prompted this bubble. */
  val draft: String? = null,
  val draftTo: String? = null,
  /** Notification key: when set, Send replies inline without opening any app. */
  val replyKey: String? = null,
)

/**
 * The floating bubble: Baymon speaking up over other apps ("display over other apps").
 * Tap opens the chat, the mic answers by voice, a sideways swipe dismisses, long-press offers
 * snooze, done and "not useful". A drafted reply can be sent straight from the bubble.
 * Every action is queued in [Signals] so JS can report it even if it wasn't running.
 */
@SuppressLint("StaticFieldLeak") // Only ever holds the application context.
internal object BubbleOverlay {
  private const val MAX_WIDTH_DP = 480
  private val SNOOZES = listOf("15 min" to 15, "1 hour" to 60, "3 hours" to 180)

  // The app's palette (src/constants/theme.ts).
  private const val SURFACE = 0xFF18181A.toInt()
  private const val CHIP = 0xFF26262A.toInt()
  private const val BORDER = 0x29F4F3EF
  private const val TEXT = 0xFFF4F3EF.toInt()
  private const val MUTED = 0x94F4F3EF.toInt()
  private const val FAINT = 0x52F4F3EF
  private const val DANGER = 0xFFF2555A.toInt()

  private val main = Handler(Looper.getMainLooper())
  private var app: Context? = null
  private var windowManager: WindowManager? = null
  private var root: LinearLayout? = null
  private val cards = LinkedHashMap<String, View>()
  private val expiries = HashMap<String, Runnable>()

  fun available(context: Context) = Settings.canDrawOverlays(context)

  /** Shows exactly these bubbles: new ones slide in, ones no longer listed leave quietly. */
  fun show(context: Context, bubbles: List<Bubble>) {
    val appContext = context.applicationContext
    main.post { render(appContext, bubbles) }
  }

  fun hide() {
    main.post {
      cards.keys.toList().forEach { remove(it) }
      detach()
    }
  }

  // -----------------------------------------------------------------------------------------------

  private fun render(context: Context, bubbles: List<Bubble>) {
    val now = System.currentTimeMillis()
    val wanted = bubbles.filter { it.expiresAt > now }.associateBy { it.id }
    cards.keys.filter { it !in wanted }.forEach { remove(it) }
    if (wanted.isEmpty() || !available(context)) {
      if (cards.isEmpty()) detach()
      return
    }
    val container = attach(context) ?: return
    for (bubble in wanted.values) {
      if (bubble.id in cards) continue
      val card = card(context, bubble)
      cards[bubble.id] = card
      container.addView(card)
      val expire = Runnable { remove(bubble.id) }
      expiries[bubble.id] = expire
      main.postDelayed(expire, bubble.expiresAt - now)
    }
  }

  private fun attach(context: Context): LinearLayout? {
    root?.let { return it }
    app = context
    val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val container = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      clipChildren = false
      clipToPadding = false
      // Room for the cards' shadows.
      setPadding(dp(12), dp(4), dp(12), dp(16))
      layoutTransition = transitions(context)
    }
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      // Never takes the keyboard or back button from the app underneath.
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP
      y = dp(6)
      title = "Baymon"
    }
    return try {
      wm.addView(container, params)
      windowManager = wm
      root = container
      container
    } catch (_: Exception) {
      // The permission was revoked between the check and now.
      null
    }
  }

  private fun detach() {
    val container = root ?: return
    root = null
    try {
      windowManager?.removeView(container)
    } catch (_: Exception) {
    }
  }

  private fun remove(id: String) {
    expiries.remove(id)?.let { main.removeCallbacks(it) }
    val card = cards.remove(id) ?: return
    root?.removeView(card)
    // Let the last card animate out before the window goes.
    if (cards.isEmpty()) main.postDelayed({ if (cards.isEmpty()) detach() }, 320)
  }

  private fun act(id: String, action: String, snoozeMinutes: Int? = null, reason: String? = null) {
    app?.let { Signals.addAction(it, id, action, snoozeMinutes, reason) }
    remove(id)
  }

  private fun open(bubble: Bubble, url: String = bubble.url) {
    val context = app ?: return
    act(bubble.id, "opened")
    val link = Intent(Intent.ACTION_VIEW, Uri.parse(url))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    try {
      context.startActivity(link)
    } catch (_: Exception) {
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
        context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }
  }

  /** Sends the drafted reply through the notification's own Reply action; opens the chat if it can't. */
  private fun sendDraft(bubble: Bubble) {
    val key = bubble.replyKey
    val text = bubble.draft
    val sent = key != null && text != null && try {
      NotificationsService.instance?.reply(key, text) != null
    } catch (_: Exception) {
      false
    }
    if (sent) act(bubble.id, "done", reason = "draft_sent") else open(bubble, bubble.editUrl)
  }

  // -----------------------------------------------------------------------------------------------
  // Views
  // -----------------------------------------------------------------------------------------------

  private fun transitions(context: Context) = LayoutTransition().apply {
    setAnimator(
      LayoutTransition.APPEARING,
      ObjectAnimator.ofPropertyValuesHolder(
        null as Any?,
        PropertyValuesHolder.ofFloat(View.ALPHA, 0f, 1f),
        PropertyValuesHolder.ofFloat(View.TRANSLATION_Y, -dp(context, 28).toFloat(), 0f),
      ),
    )
    setInterpolator(LayoutTransition.APPEARING, OvershootInterpolator(1.1f))
    setDuration(LayoutTransition.APPEARING, 360)
    // From wherever the card is (a swipe has already faded it) to gone.
    setAnimator(LayoutTransition.DISAPPEARING, ObjectAnimator.ofFloat(null as View?, View.ALPHA, 0f))
    setDuration(LayoutTransition.DISAPPEARING, 160)
  }

  private fun card(context: Context, bubble: Bubble): View {
    val width = min(context.resources.displayMetrics.widthPixels - dp(24), dp(MAX_WIDTH_DP))
    val card = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      background = GradientDrawable().apply {
        setColor(SURFACE)
        cornerRadius = dp(22).toFloat()
        setStroke(dp(1), BORDER)
      }
      elevation = dp(10).toFloat()
      layoutParams = LinearLayout.LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(8) }
      layoutTransition = LayoutTransition()
    }

    val row = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(14), dp(12), dp(16), dp(13))
    }
    row.addView(orb(context), LinearLayout.LayoutParams(dp(30), dp(30)).apply { marginEnd = dp(12) })
    val texts = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    texts.addView(TextView(context).apply {
      text = (if (bubble.urgent) "Urgent · ${bubble.label}" else bubble.label).uppercase()
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
      letterSpacing = 0.12f
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      setTextColor(if (bubble.urgent) DANGER else FAINT)
    })
    texts.addView(TextView(context).apply {
      text = bubble.text
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      setTextColor(TEXT)
      setLineSpacing(0f, 1.12f)
      maxLines = 3
      ellipsize = TextUtils.TruncateAt.END
      setPadding(0, dp(2), 0, 0)
    })
    row.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    row.addView(micButton(context, bubble), LinearLayout.LayoutParams(dp(36), dp(36)).apply { marginStart = dp(10) })
    card.addView(row)
    bubble.draft?.let { card.addView(draftView(context, bubble, it)) }

    val menu = menu(context, bubble).apply { visibility = View.GONE }
    card.addView(menu)
    row.setOnTouchListener(Gestures(card, menu, bubble))
    accessible(row, menu, bubble)
    return card
  }

  /** Screen readers: double-tap opens, long-press shows the menu, and "Dismiss" is an action. */
  private fun accessible(row: View, menu: View, bubble: Bubble) {
    row.contentDescription = "${bubble.label} from Baymon: ${bubble.text}"
    row.setOnClickListener { open(bubble) }
    row.setOnLongClickListener {
      menu.visibility = if (menu.visibility == View.VISIBLE) View.GONE else View.VISIBLE
      true
    }
    row.accessibilityDelegate = object : View.AccessibilityDelegate() {
      override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(host, info)
        info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_DISMISS)
      }

      override fun performAccessibilityAction(host: View, action: Int, args: Bundle?): Boolean {
        if (action != AccessibilityNodeInfo.ACTION_DISMISS) return super.performAccessibilityAction(host, action, args)
        act(bubble.id, "dismissed")
        return true
      }
    }
  }

  /** Baymon's face: the same off-white orb as in the app, breathing slowly. */
  private fun orb(context: Context) = View(context).apply {
    background = GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      gradientType = GradientDrawable.RADIAL_GRADIENT
      gradientRadius = dp(context, 15).toFloat()
      colors = intArrayOf(TEXT, 0xFF8E8D89.toInt())
    }
    val breathe = ObjectAnimator.ofPropertyValuesHolder(
      this,
      PropertyValuesHolder.ofFloat(View.SCALE_X, 0.92f, 1.04f),
      PropertyValuesHolder.ofFloat(View.SCALE_Y, 0.92f, 1.04f),
    ).apply {
      duration = 1_400
      repeatCount = ValueAnimator.INFINITE
      repeatMode = ValueAnimator.REVERSE
      interpolator = DecelerateInterpolator()
    }
    addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
      override fun onViewAttachedToWindow(v: View) = breathe.start()
      override fun onViewDetachedFromWindow(v: View) = breathe.cancel()
    })
  }

  /** Answer by voice: opens Baymon in talk mode with this bubble. */
  private fun micButton(context: Context, bubble: Bubble) = ImageView(context).apply {
    setImageResource(R.drawable.baymon_mic)
    scaleType = ImageView.ScaleType.CENTER
    background = GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(CHIP)
    }
    contentDescription = "Answer by voice"
    setOnClickListener {
      performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
      open(bubble, bubble.talkUrl)
    }
  }

  /** The drafted reply, quoted, with Send (inline reply) and Edit (in the chat). */
  private fun draftView(context: Context, bubble: Bubble, draft: String) = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(dp(56), 0, dp(16), dp(12))
    addView(TextView(context).apply {
      text = (bubble.draftTo?.let { "Reply to $it" } ?: "Suggested reply").uppercase()
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
      letterSpacing = 0.12f
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      setTextColor(FAINT)
    })
    addView(TextView(context).apply {
      text = "“$draft”"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      setTextColor(MUTED)
      maxLines = 3
      ellipsize = TextUtils.TruncateAt.END
      setPadding(0, dp(3), 0, dp(8))
    })
    addView(LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      if (bubble.replyKey != null) addView(chip(context, "Send", TEXT, "Send this reply") { sendDraft(bubble) })
      addView(chip(context, if (bubble.replyKey != null) "Edit" else "Edit & send", MUTED, "Edit the reply in Baymon") {
        open(bubble, bubble.editUrl)
      })
    })
  }

  /** Long-press menu: snooze for a while, mark it done, or say it wasn't useful (Baymon learns). */
  private fun menu(context: Context, bubble: Bubble) = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(dp(14), 0, dp(14), dp(4))
    addView(LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      setPadding(0, 0, 0, dp(8))
      for ((label, minutes) in SNOOZES) addView(chip(context, label, MUTED, "Snooze for $label") { act(bubble.id, "snoozed", minutes) })
    })
    addView(LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      setPadding(0, 0, 0, dp(8))
      addView(chip(context, "Done", TEXT, "Mark as done") { act(bubble.id, "done") })
      addView(chip(context, "Not useful", MUTED, "Not useful") { act(bubble.id, "dismissed", reason = "not_useful") })
      addView(chip(context, "Wrong time", MUTED, "Wrong time") { act(bubble.id, "dismissed", reason = "wrong_time") })
    })
  }

  private fun chip(context: Context, label: String, color: Int, description: String, onClick: () -> Unit) = TextView(context).apply {
    text = label
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
    setTextColor(color)
    typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    gravity = Gravity.CENTER
    setPadding(dp(12), dp(7), dp(12), dp(7))
    background = GradientDrawable().apply {
      setColor(CHIP)
      cornerRadius = dp(99).toFloat()
    }
    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
      marginEnd = dp(8)
    }
    contentDescription = description
    setOnClickListener {
      performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
      onClick()
    }
  }

  /** Tap, sideways swipe and long-press on one card. Uses raw coordinates because the card moves. */
  private class Gestures(private val card: View, private val menu: View, private val bubble: Bubble) : View.OnTouchListener {
    private val slop = ViewConfiguration.get(card.context).scaledTouchSlop
    private val flingVelocity = ViewConfiguration.get(card.context).scaledMinimumFlingVelocity * 6
    private var downX = 0f
    private var downY = 0f
    private var dragging = false
    private var longPressed = false
    private var moved = false
    private var tracker: VelocityTracker? = null
    private val longPress = Runnable {
      longPressed = true
      card.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
      press(false)
      menu.visibility = if (menu.visibility == View.VISIBLE) View.GONE else View.VISIBLE
    }

    private fun press(down: Boolean) {
      val scale = if (down) 0.98f else 1f
      card.animate().scaleX(scale).scaleY(scale).setDuration(120).start()
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouch(v: View, e: MotionEvent): Boolean {
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = e.rawX
          downY = e.rawY
          dragging = false
          longPressed = false
          moved = false
          tracker = VelocityTracker.obtain().also { it.addMovement(e) }
          press(true)
          main.postDelayed(longPress, ViewConfiguration.getLongPressTimeout().toLong())
        }
        MotionEvent.ACTION_MOVE -> {
          tracker?.addMovement(e)
          val dx = e.rawX - downX
          val dy = e.rawY - downY
          if (!moved && (abs(dx) > slop || abs(dy) > slop)) {
            moved = true
            main.removeCallbacks(longPress)
            dragging = !longPressed && abs(dx) > abs(dy)
          }
          if (dragging) {
            card.translationX = dx
            card.alpha = 1f - min(1f, abs(dx) / card.width.coerceAtLeast(1)) * 0.85f
          }
        }
        MotionEvent.ACTION_UP -> {
          main.removeCallbacks(longPress)
          tracker?.addMovement(e)
          tracker?.computeCurrentVelocity(1000)
          val velocity = tracker?.xVelocity ?: 0f
          release()
          val dx = e.rawX - downX
          when {
            dragging -> {
              val flung = abs(velocity) > flingVelocity && Math.signum(velocity) == Math.signum(dx)
              if (abs(dx) > card.width * 0.35f || flung) swipeAway(if (dx == 0f) Math.signum(velocity) else Math.signum(dx))
              else settle()
            }
            !longPressed && !moved -> {
              press(false)
              open(bubble)
            }
            else -> press(false)
          }
        }
        MotionEvent.ACTION_CANCEL -> {
          main.removeCallbacks(longPress)
          release()
          press(false)
          if (dragging) settle()
        }
      }
      return true
    }

    private fun release() {
      tracker?.recycle()
      tracker = null
    }

    private fun settle() {
      press(false)
      card.animate().translationX(0f).alpha(1f).setInterpolator(OvershootInterpolator(1.2f)).setDuration(280).start()
    }

    private fun swipeAway(direction: Float) {
      card.animate()
        .translationX(direction * (card.width + dp(card.context, 24)))
        .alpha(0f)
        .setInterpolator(DecelerateInterpolator())
        .setDuration(180)
        .withEndAction { act(bubble.id, "dismissed") }
        .start()
    }
  }

  private fun dp(value: Int) = app?.let { dp(it, value) } ?: value

  private fun dp(context: Context, value: Int) = (value * context.resources.displayMetrics.density).roundToInt()
}
