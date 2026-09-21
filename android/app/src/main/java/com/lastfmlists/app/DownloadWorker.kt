package com.lastfmlists.app

import android.app.*
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.*
import kotlinx.coroutines.CancellationException

/** Only enqueued after explicit consent. Revoking consent cancels the unique work. */
class DownloadWorker(context: Context,params: WorkerParameters): CoroutineWorker(context,params) {
    private val app=context.applicationContext as ListsApplication
    override suspend fun doWork(): Result {
        if(!app.prefs.getBoolean("background",false)) return Result.failure()
        val name=inputData.getString("account") ?: return Result.failure()
        return try {
            setForeground(notification("Preparing your library"))
            app.sync.sync(name) { progress ->
                if(!app.prefs.getBoolean("background",false)) throw CancellationException("Consent revoked")
                setForeground(notification(progress.message))
                setProgress(workDataOf("message" to progress.message))
            }
            Result.success()
        } catch(e: CancellationException) { throw e }
        catch(e: Exception) { Result.failure(workDataOf("error" to (e.message ?: "Download failed"))) }
    }
    private fun notification(message: String): ForegroundInfo {
        val manager=applicationContext.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("downloads","Library downloads",NotificationManager.IMPORTANCE_LOW))
        val launch=PendingIntent.getActivity(applicationContext,0,android.content.Intent(applicationContext,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification=NotificationCompat.Builder(applicationContext,"downloads").setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("lastfmlists").setContentText(message).setOngoing(true).setContentIntent(launch).addAction(android.R.drawable.ic_menu_close_clear_cancel,"Pause",WorkManager.getInstance(applicationContext).createCancelPendingIntent(id)).build()
        return if(Build.VERSION.SDK_INT>=29) ForegroundInfo(7,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(7,notification)
    }
    companion object {
        const val NAME="lastfmlists-library-download"
        fun start(context: Context,name: String,wifiOnly: Boolean) {
            val constraints=Constraints.Builder().setRequiredNetworkType(if(wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED).build()
            val work=OneTimeWorkRequestBuilder<DownloadWorker>().setInputData(workDataOf("account" to name)).setConstraints(constraints).build()
            WorkManager.getInstance(context).enqueueUniqueWork(NAME,ExistingWorkPolicy.KEEP,work)
        }
        fun cancel(context: Context) { WorkManager.getInstance(context).cancelUniqueWork(NAME) }
    }
}
