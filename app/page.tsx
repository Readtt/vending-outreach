import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  getActivityFeed,
  getBreakerInfo,
  getDashboardTiles,
  getMailboxHealth,
  getQueueSummary,
  getRecentFailures,
  getSendControlState,
  getStopFilePresent,
  hasAnyLeads,
} from "./data"
import { RearmBreakerButton } from "./rearm-breaker-button"
import { SendToggle } from "./send-toggle"
import {
  formatDateTime,
  formatPercent,
  humanizeBreakerName,
  type ActivityItem,
  type BreakerInfo,
  type DashboardTiles,
  type MailboxHealthItem,
  type QueueSummary,
  type RecentFailure,
} from "./types"

// This page reads the local SQLite DB directly, so Next has no signal that
// it's dynamic and would otherwise prerender it once at build time — see
// app/settings/page.tsx for the identical reasoning.
export const dynamic = "force-dynamic"

const TASK_KIND_ORDER = ["enrich", "compose", "send", "classify"]

export default function DashboardPage() {
  if (!hasAnyLeads()) {
    return <GetStarted />
  }

  const tiles = getDashboardTiles()
  const send = getSendControlState()
  const stopPresent = getStopFilePresent()
  const breaker = getBreakerInfo()
  const queue = getQueueSummary()
  const failures = getRecentFailures()
  const mailboxes = getMailboxHealth()
  const activity = getActivityFeed(30)

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-lg font-medium">Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        What happened, what needs you, and what is about to happen.
      </p>

      <Tiles tiles={tiles} />

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sending</CardTitle>
          </CardHeader>
          <CardContent>
            <SendToggle
              initialEnabled={send.enabled}
              initialDryRunCount={send.dryRunCount}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <QueueStatus queue={queue} failures={failures} />
          </CardContent>
        </Card>
      </div>

      {stopPresent && <StopBanner />}
      {breaker && <BreakerBanner breaker={breaker} />}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Mailboxes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {mailboxes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No mailboxes configured yet.
            </p>
          ) : (
            mailboxes.map((m) => <MailboxRow key={m.id} mailbox={m} />)
          )}
        </CardContent>
      </Card>

      <Card className="mt-4" id="activity-feed">
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border">
          {activity.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              Nothing has happened yet.
            </p>
          ) : (
            activity.map((item) => <ActivityRow key={item.id} item={item} />)
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Tile({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-2xl font-medium tabular-nums">{value}</span>
        {sub ? (
          <span className="text-xs text-muted-foreground">{sub}</span>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Tiles({ tiles }: { tiles: DashboardTiles }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Tile
        label="Sent today"
        value={`${tiles.sentToday} / ${tiles.dailyCap}`}
        // The ramp is the number that actually stops sending, so say so when
        // it is below the configured ceiling. Otherwise sending appears to
        // stall at 5 with the tile reading "/ 25" and nothing explaining it.
        sub={
          tiles.warmingUp
            ? `warming up toward ${tiles.configuredCap}`
            : tiles.dryRunToday > 0
              ? `+${tiles.dryRunToday} rehearsal`
              : undefined
        }
      />
      <Tile label="Replies (7d)" value={String(tiles.repliesLast7d)} />
      <Tile
        label="Hot leads"
        value={String(tiles.hotLeads)}
        sub={tiles.hotLeads > 0 ? "awaiting you" : undefined}
      />
      <Tile label="Ready to send" value={String(tiles.readyToSend)} />
      <Tile
        label="Hard bounce rate"
        value={
          tiles.hardBounceRateLast50 === null
            ? "—"
            : formatPercent(tiles.hardBounceRateLast50)
        }
        sub={
          tiles.hardBounceRateLast50 === null
            ? "not enough data"
            : "last 50 sends"
        }
      />
    </div>
  )
}

function StopBanner() {
  return (
    <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
      <p className="font-medium text-destructive">
        Sending is halted — a STOP file is present.
      </p>
      <p className="mt-1 text-muted-foreground">
        Delete the <code className="text-xs">STOP</code> file in the project
        root (or the path named by{" "}
        <code className="text-xs">VENDING_STOP_FILE</code>, if set) to let the
        engine resume. Nothing else on this page can do that for you — it is a
        filesystem kill switch by design.
      </p>
    </div>
  )
}

function BreakerBanner({ breaker }: { breaker: BreakerInfo }) {
  return (
    <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">
            Circuit breaker tripped: {humanizeBreakerName(breaker.breaker)}
          </p>
          <p className="mt-1 text-muted-foreground">{breaker.reason}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tripped {formatDateTime(breaker.trippedAt)}. This is a deliberate
            safety gate, not an error to dismiss — re-arming is a decision only
            you make.
          </p>
        </div>
        <RearmBreakerButton />
      </div>
    </div>
  )
}

function QueueStatus({
  queue,
  failures,
}: {
  queue: QueueSummary
  failures: RecentFailure[]
}) {
  const kinds = [
    ...TASK_KIND_ORDER.filter((k) => queue.byKind[k]),
    ...Object.keys(queue.byKind).filter((k) => !TASK_KIND_ORDER.includes(k)),
  ]
  const latestReason = failures.find((f) => f.reason)?.reason

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          <strong className="tabular-nums">{queue.pending}</strong>{" "}
          <span className="text-muted-foreground">pending</span>
        </span>
        <span>
          <strong className="tabular-nums">{queue.running}</strong>{" "}
          <span className="text-muted-foreground">running</span>
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {kinds.length > 0
          ? kinds.map((k) => `${queue.byKind[k]} ${k}`).join(" · ")
          : "Nothing queued right now."}
      </p>
      {queue.failed > 0 && (
        <a
          href="#activity-feed"
          className="text-xs text-destructive underline-offset-2 hover:underline"
        >
          {queue.failed} task{queue.failed === 1 ? "" : "s"} gave up after
          repeated failures
          {latestReason ? ` — "${latestReason}"` : ""}
        </a>
      )}
    </div>
  )
}

function MailboxRow({ mailbox }: { mailbox: MailboxHealthItem }) {
  const paused = mailbox.pausedReason !== null
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium">{mailbox.email}</div>
        <div className="text-xs text-muted-foreground">
          {mailbox.dailyCap}/day
        </div>
      </div>
      <Badge variant={paused ? "destructive" : "outline"}>
        {paused
          ? `Paused${mailbox.pausedReason ? `: ${mailbox.pausedReason}` : ""}`
          : mailbox.status}
      </Badge>
    </div>
  )
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <span>{item.text}</span>
        {item.leadName && (
          <span className="text-muted-foreground"> — {item.leadName}</span>
        )}
        {item.extra && (
          <div className="text-xs text-muted-foreground">{item.extra}</div>
        )}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {item.createdAt ? formatDateTime(item.createdAt) : ""}
      </span>
    </div>
  )
}

function GetStarted() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-lg font-medium">Welcome</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        No leads yet. Two steps to get moving:
      </p>
      <ol className="mt-4 flex flex-col gap-3 text-sm">
        <li className="rounded-lg border border-border px-3 py-2.5">
          <span className="font-medium">
            1. Add an AI provider and a mailbox.
          </span>
          <p className="mt-1 text-muted-foreground">
            Settings needs at least one AI provider (for writing emails), one
            Gmail mailbox (for sending them), and your physical address under
            &quot;About you&quot; for CAN-SPAM.
          </p>
          <Button render={<Link href="/settings" />} size="sm" className="mt-2">
            Go to Settings
          </Button>
        </li>
        <li className="rounded-lg border border-border px-3 py-2.5">
          <span className="font-medium">2. Find locations.</span>
          <p className="mt-1 text-muted-foreground">
            Search a city or ZIP in Leads, pick the business types you want, and
            import what looks good.
          </p>
          <Button
            render={<Link href="/leads" />}
            size="sm"
            variant="outline"
            className="mt-2"
          >
            Go to Leads
          </Button>
        </li>
      </ol>
    </div>
  )
}
