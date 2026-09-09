/**
 * Server-only data shaping for the Dashboard. `page.tsx` and `actions.ts`
 * are the only callers — client components (`send-toggle.tsx`,
 * `rearm-breaker-button.tsx`) import shapes from `./types` instead, exactly
 * like the Settings page's split (see `app/settings/data.ts`).
 */

import {
  countLeads,
  dailyActivity,
  dashboardStats,
  engineStatus,
  getLeadById,
  listMailboxes,
  listRecentEvents,
  taskQueueSummary,
  type DailyActivityPoint,
  type EngineStatus,
  type EventRow,
} from "@/lib/db"
import {
  countDryRunMessages,
  getCircuitBreakerState,
  getMailboxPause,
  isSendEnabled,
  isStopFilePresent,
  getPacingConfig,
  warmupCap,
} from "@/lib/mail-send"
import { getSendingSettings } from "./settings/data"
import { FEED_DUPLICATE_TYPES, humanizeEvent } from "./humanize-event"
import type {
  ActivityItem,
  BreakerInfo,
  DashboardTiles,
  MailboxHealthItem,
  RecentFailure,
} from "./types"

export type { DailyActivityPoint, EngineStatus }

/** Operator-local midnight for `now`. Node's `Date` already uses this machine's
 * own timezone, which is the right "operator" clock for a local-first app. */
function operatorLocalMidnight(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function hasAnyLeads(): boolean {
  return countLeads() > 0
}

export function getDashboardTiles(now: number = Date.now()): DashboardTiles {
  const stats = dashboardStats(operatorLocalMidnight(now), now)
  const sending = getSendingSettings()
  const queue = taskQueueSummary()

  // The cap that actually stops sending is the warm-up ramp, not the number in
  // Settings. On day one that is 5, climbing ~20% per day with real sending
  // activity. Showing "0 / 25" while the gate refuses at 5 gives the user no
  // way to understand why sending stopped, so show the effective cap and keep
  // the configured one alongside it as the ceiling.
  const mailboxes = listMailboxes().filter((m) => m.status === "active")
  const pacing = getPacingConfig()
  const effectiveCap = mailboxes.reduce(
    (total, mailbox) =>
      total +
      warmupCap(
        mailbox.id,
        pacing,
        Math.min(
          mailbox.daily_cap ?? sending.emailsPerDay,
          sending.emailsPerDay
        ),
        now
      ),
    0
  )

  return {
    sentToday: stats.sentToday,
    dailyCap: mailboxes.length === 0 ? sending.emailsPerDay : effectiveCap,
    configuredCap: sending.emailsPerDay,
    warmingUp: mailboxes.length > 0 && effectiveCap < sending.emailsPerDay,
    dryRunToday: stats.dryRunToday,
    repliesLast7d: stats.repliesLast7d,
    waitingForYou: stats.hotLeads,
    readyToSend: stats.readyToSend,
    preparing: queue.pending + queue.running,
    bounceRateLast50: stats.hardBounceRateLast50,
  }
}

export function getEngineStatus(): EngineStatus {
  return engineStatus()
}

/** Two weeks of sends and replies for the dashboard chart. */
export function getActivityChart(): DailyActivityPoint[] {
  return dailyActivity(14)
}

export function getSendControlState(): {
  enabled: boolean
  dryRunCount: number
} {
  return { enabled: isSendEnabled(), dryRunCount: countDryRunMessages() }
}

export function getStopFilePresent(): boolean {
  return isStopFilePresent()
}

export function getBreakerInfo(): BreakerInfo | null {
  const state = getCircuitBreakerState()
  if (!state) return null
  return {
    breaker: state.breaker,
    reason: state.reason,
    trippedAt: state.trippedAt,
  }
}

/** How many jobs gave up for good. Zero is the normal case. */
export function getFailedJobCount(): number {
  return taskQueueSummary().failed
}

/** The reasons behind the most recent dead-lettered tasks, for the "N jobs
 * gave up" banner — otherwise a failed job is completely invisible. */
export function getRecentFailures(limit = 5): RecentFailure[] {
  const rows = listRecentEvents(limit, { types: ["task_dead_letter"] })
  return rows.map((row) => {
    const humanized = humanizeEvent(row.type, row.detail_json)
    return { id: row.id, reason: humanized.extra, createdAt: row.created_at }
  })
}

export function getMailboxHealth(): MailboxHealthItem[] {
  return listMailboxes().map((m) => ({
    id: m.id,
    email: m.email,
    status: m.status,
    pausedReason: getMailboxPause(m.id)?.reason ?? null,
  }))
}

/** Resolves lead names for a batch of events in one pass — cheap locally
 * (SQLite, indexed PK lookups), and the only way the feed can say "Wrote an
 * email — Joe's Gym" instead of an anonymous line. */
function resolveLeadNames(events: readonly EventRow[]): Map<string, string> {
  const ids = new Set<string>()
  for (const e of events) {
    if (e.lead_id) ids.add(e.lead_id)
  }
  const names = new Map<string, string>()
  for (const id of ids) {
    const lead = getLeadById(id)
    if (lead?.name) names.set(id, lead.name)
  }
  return names
}

export function getActivityFeed(limit = 30): ActivityItem[] {
  const events = listRecentEvents(limit, {
    excludeTypes: FEED_DUPLICATE_TYPES,
  })
  const names = resolveLeadNames(events)
  return events.map((row) => {
    const humanized = humanizeEvent(row.type, row.detail_json)
    return {
      id: row.id,
      text: humanized.text,
      extra: humanized.extra,
      leadId: row.lead_id,
      leadName: row.lead_id ? (names.get(row.lead_id) ?? null) : null,
      createdAt: row.created_at,
    }
  })
}
