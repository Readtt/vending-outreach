/**
 * Pure types + pure helpers for the Dashboard, shared between `data.ts`
 * (server-only) and the client components (`send-toggle.tsx`,
 * `rearm-breaker-button.tsx`). Zero value-import of `@/lib/db`,
 * `@/lib/mail-send`, or anything that reaches them — see `app/settings/types.ts`
 * for why this split exists.
 */

export interface DashboardTiles {
  sentToday: number
  /**
   * The cap that will actually stop sending today: the warm-up ramp, summed
   * across active mailboxes. Day one is 5 per mailbox, climbing ~20% per day
   * of real sending activity. This is NOT the number in Settings — showing
   * that one made sending appear to stall for no reason.
   */
  dailyCap: number
  /** The ceiling from Settings → Sending, which the ramp climbs toward. */
  configuredCap: number
  /** True while the ramp is still below the configured ceiling. */
  warmingUp: boolean
  dryRunToday: number
  repliesLast7d: number
  hotLeads: number
  readyToSend: number
  /** Null means "not enough data yet" — never render this as 0%. */
  hardBounceRateLast50: number | null
  totalLeads: number
}

export interface MailboxHealthItem {
  id: string
  email: string
  dailyCap: number
  status: string
  pausedReason: string | null
  pausedUntil: number | null
}

export interface ActivityItem {
  id: number
  text: string
  extra?: string
  leadId: string | null
  leadName: string | null
  createdAt: number | null
}

export interface QueueSummary {
  pending: number
  running: number
  failed: number
  byKind: Record<string, number>
}

export interface RecentFailure {
  id: number
  reason?: string
  createdAt: number | null
}

export interface BreakerInfo {
  breaker: string
  reason: string
  trippedAt: number
}

export function humanizeBreakerName(breaker: string): string {
  const labels: Record<string, string> = {
    auto_reply_burst: "Auto-reply burst",
    unplanned_repeat_to_address: "Unplanned repeat send to one address",
    domain_volume: "Domain volume limit",
    hard_bounce_rate: "Hard bounce rate",
    rate_limit_response: "Rate-limit response from the mail server",
    auth_revoked: "Mailbox authentication revoked",
  }
  return labels[breaker] ?? breaker.replace(/_/g, " ")
}

export function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}
