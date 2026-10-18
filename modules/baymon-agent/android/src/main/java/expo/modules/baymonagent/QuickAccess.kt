package expo.modules.baymonagent

import android.app.PendingIntent
import android.app.StatusBarManager
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.RemoteViews

/** Opens Baymon straight into talk mode (handled by the app's `+native-intent`). */
internal fun talkIntent(context: Context): Intent =
  Intent(Intent.ACTION_VIEW, Uri.parse("baymon://talk"))
    .setPackage(context.packageName)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

internal fun talkPendingIntent(context: Context, requestCode: Int): PendingIntent =
  PendingIntent.getActivity(
    context,
    requestCode,
    talkIntent(context),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )

/** Quick Settings tile: pull down, tap Baymon, talk. */
class TalkTileService : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    qsTile?.apply {
      state = Tile.STATE_INACTIVE
      label = getString(R.string.baymon_tile_label)
      updateTile()
    }
  }

  override fun onClick() {
    super.onClick()
    if (Build.VERSION.SDK_INT >= 34) {
      startActivityAndCollapse(talkPendingIntent(this, 10))
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(talkIntent(this))
    }
  }
}

/** Home-screen widget: the orb and "Talk to Baymon". */
class TalkWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val views = RemoteViews(context.packageName, R.layout.baymon_widget).apply {
      setOnClickPendingIntent(R.id.baymon_widget_root, talkPendingIntent(context, 11))
    }
    for (id in ids) manager.updateAppWidget(id, views)
  }
}

internal object QuickAccess {
  /** Asks the system to add the tile (Android 13+); otherwise the user adds it from the tile editor. */
  fun requestTile(context: Context, done: (String) -> Unit) {
    if (Build.VERSION.SDK_INT < 33) return done("unsupported")
    val manager = context.getSystemService(StatusBarManager::class.java) ?: return done("unsupported")
    manager.requestAddTileService(
      ComponentName(context, TalkTileService::class.java),
      context.getString(R.string.baymon_tile_label),
      Icon.createWithResource(context, R.drawable.baymon_tile),
      context.mainExecutor,
    ) { result ->
      done(
        when (result) {
          StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED -> "added"
          StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED -> "already_added"
          StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED -> "not_added"
          else -> "failed"
        }
      )
    }
  }

  /** Asks the launcher to pin the widget; false when the launcher can't. */
  fun requestWidget(context: Context): Boolean {
    val manager = AppWidgetManager.getInstance(context)
    if (Build.VERSION.SDK_INT < 26 || !manager.isRequestPinAppWidgetSupported) return false
    return manager.requestPinAppWidget(ComponentName(context, TalkWidget::class.java), null, null)
  }
}
