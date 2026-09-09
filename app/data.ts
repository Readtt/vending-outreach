/**
 * Server-only data shaping for the Dashboard. `page.tsx` and `actions.ts`
 * are the only callers — client components (`send-toggle.tsx`,
 * `rearm-breaker-button.tsx`) import shapes from `./types` instead, exactly
 * like the Settings page's split (see `app/settings/data.ts`).
 */

import {
  countLeads,
  dashboardStats,
  getLeadById,
  listMailboxes,
  listRecentEvents,
  taskQueueSummary,
  type EventRow,
} from "@/lib/db"
import {
  countDryRunMessages,
  getCircuitBreakerState,
  getMailboxPause,
  isSendEnabled,
  isStopFilePresent,
} from "@/lib/mail-send"
import { getSendingSettings } from "./settings/data"
import { humanizeEvent } from "./humanize-event"
import type {
  ActivityItem,
  BreakerInfo,
  DashboardTiles,
  MailboxHealthItem,
  QueueSummary,
  RecentFailure,
} from "./types"

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
  return {
    sentToday: stats.sentToday,
    dailyCap: sending.emailsPerDay,
    dryRunToday: stats.dryRunToday,
    repliesLast7d: stats.repliesLast7d,
    hotLeads: stats.hotLeads,
    readyToSend: stats.readyToSend,
    hardBounceRateLast50: stats.hardBounceRateLast50,
    totalLeads: stats.totalLeads,
  }
}

export function getSendControlState(): { enabled: boolean; dryRunCount: number } {
  return { enabled: isSendEnabled(), dryRunCount: countDryRunMessages() }
}

export function getStopFilePresent(): boolean {
  return isStopFilePresent()
}

export function getBreakerInfo(): BreakerInfo | null {
  const state = getCircuitBreakerState()
  if (!state) return null
  return { breaker: state.breaker, reason: state.reason, trippedAt: state.trippedAt }
}

export function getQueueSummary(): QueueSummary {
  return taskQueueSummary()
}

/** The reasons behind the most recent dead-lettered tasks, for the "N tasks
 * gave up" line — otherwise a failed task is completely invisible. */
export function getRecentFailures(limit = 5): RecentFailure[] {
  const rows = listRecentEvents(limit, { types: ["task_dead_letter"] })
  return rows.map((row) => {
    const humanized = humanizeEvent(row.type, row.detail_json)
    return { id: row.id, reason: humanized.extra, createdAt: row.created_at }
  })
}

export function getMailboxHealth(): MailboxHealthItem[] {
  return listMailboxes().map((m) => {
    const pause = getMailboxPause(m.id)
    return {
      id: m.id,
      email: m.email,
      dailyCap: m.daily_cap,
      status: m.status,
      pausedReason: pause?.reason ?? null,
      pausedUntil: pause?.until ?? null,
    }
  })
}

/** Resolves lead names for a batch of events in one pass — cheap locally
 * (SQLite, indexed PK lookups), and the only way the feed can say "Drafted
 * an email — Joe's Gym" instead of an anonymous line. */
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
  const events = listRecentEvents(limit)
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
