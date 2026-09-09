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
  /** Leads that replied with something a person has to answer. */
  waitingForYou: number
  /** Drafts written and queued, waiting their turn in the schedule. */
  readyToSend: number
  /** Leads still being researched or written up — the queue, in plain terms. */
  preparing: number
  /** Null means "not enough sent yet" — never render this as 0%. */
  bounceRateLast50: number | null
}

export interface MailboxHealthItem {
  id: string
  email: string
  status: string
  pausedReason: string | null
}

export interface ActivityItem {
  id: number
  text: string
  extra?: string
  leadId: string | null
  leadName: string | null
  createdAt: number | null
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

/** Plain-language names for the safety limits that can stop sending. */
export function humanizeBreakerName(breaker: string): string {
  const labels: Record<string, string> = {
    auto_reply_burst: "Too many automatic replies at once",
    unplanned_repeat_to_address: "Nearly emailed the same address twice",
    domain_volume: "Too many emails to one company",
    hard_bounce_rate: "Too many emails coming back undelivered",
    rate_limit_response: "The mail server asked us to slow down",
    auth_revoked: "The mailbox stopped accepting the password",
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
