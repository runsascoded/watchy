import { sendPushover } from './pushover'
import type { Env } from './collect'

interface RunRow {
  id: number
  started_at: string
  finished_at: string | null
  ok: number | null
  alerted: number
}

const HOUR_MS = 3_600_000

function humanDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000))
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (mins || parts.length === 0) parts.push(`${mins}m`)
  return parts.join(' ')
}

/**
 * Failure alerting, state derived entirely from the `runs` table:
 * - alert on the 2nd consecutive failure (1 transient GitHub 5xx shouldn't page)
 * - subsequent alerts back off: ≥6h after the 1st alert, then ≥24h between alerts
 * - one recovery ping when a run succeeds after an alerted streak
 *
 * Returns whether an alert was sent for the just-recorded run (caller stamps `alerted`).
 */
export async function maybeAlert(env: Env, runId: number, ok: boolean, error?: string): Promise<boolean> {
  const { results: runs } = await env.DB
    .prepare('SELECT id, started_at, finished_at, ok, alerted FROM runs WHERE id <= ? ORDER BY id DESC LIMIT 100')
    .bind(runId)
    .all<RunRow>()
  // runs[0] is the just-recorded run; the streak is the failed runs before it
  const streak: RunRow[] = []
  for (const r of runs.slice(1)) {
    if (r.ok === 1) break
    streak.push(r)
  }

  if (ok) {
    if (streak.some(r => r.alerted)) {
      const first = streak[streak.length - 1]
      await sendPushover(env, {
        title: '✅ watchy recovered',
        message: `Collection succeeded after ${humanDuration(Date.now() - Date.parse(first.started_at))} of failures.`,
        url: 'https://watchy.rbw.sh/api/status',
      })
    }
    return false
  }

  const consecutive = streak.length + 1  // including the current failure
  const alerts = streak.filter(r => r.alerted)
  let shouldAlert: boolean
  if (alerts.length === 0) {
    shouldAlert = consecutive >= 2
  } else {
    const lastAlertTs = Date.parse(alerts[0].finished_at ?? alerts[0].started_at)
    const backoffH = alerts.length === 1 ? 6 : 24
    shouldAlert = Date.now() - lastAlertTs >= backoffH * HOUR_MS
  }
  if (shouldAlert) {
    await sendPushover(env, {
      title: `⚠️ watchy: ${consecutive} consecutive failures`,
      message: error ?? 'unknown error',
      url: 'https://watchy.rbw.sh/api/status',
      priority: 1,
    })
  }
  return shouldAlert
}
