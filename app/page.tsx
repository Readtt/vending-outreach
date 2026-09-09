import Link from "next/link"
import { ActivityChart } from "@/components/activity-chart"
import { AutoRefresh } from "@/components/auto-refresh"
import { Page, PageHeader } from "@/components/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  getActivityChart,
  getActivityFeed,
  getBreakerInfo,
  getDashboardTiles,
  getEngineStatus,
  getFailedJobCount,
  getMailboxHealth,
  getRecentFailures,
  getSendControlState,
  getStopFilePresent,
  hasAnyLeads,
  type DailyActivityPoint,
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
  type RecentFailure,
} from "./types"

// This page reads the local SQLite DB directly, so Next has no signal that
// it's dynamic and would otherwise prerender it once at build time — see
// app/settings/page.tsx for the identical reasoning.
export const dynamic = "force-dynamic"

export default function DashboardPage() {
  if (!hasAnyLeads()) {
    return <GetStarted />
  }

  const tiles = getDashboardTiles()
  const send = getSendControlState()
  const engine = getEngineStatus()
  const stopPresent = getStopFilePresent()
  const breaker = getBreakerInfo()
  const failedJobs = getFailedJobCount()
  const failures = getRecentFailures()
  const mailboxes = getMailboxHealth()
  const chart = getActivityChart()
  const activity = getActivityFeed(30)

  return (
    <Page>
      <AutoRefresh />
      <PageHeader
        title="Dashboard"
        description="What happened today, and anything that needs you."
        action={<EnginePill running={engine.running} />}
      />

      <Tiles tiles={tiles} />

      {stopPresent && <StopBanner />}
      {breaker && <BreakerBanner breaker={breaker} />}
      {failedJobs > 0 && (
        <FailedBanner count={failedJobs} failures={failures} />
      )}

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
            <CardTitle>The last two weeks</CardTitle>
          </CardHeader>
          <CardContent>
            <Chart points={chart} />
          </CardContent>
        </Card>
      </div>

      {mailboxes.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Your email accounts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {mailboxes.map((m) => (
              <MailboxRow key={m.id} mailbox={m} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="mt-4" id="activity-feed">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
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
    </Page>
  )
}

/**
 * Whether the engine process is alive, next to the page title.
 *
 * A stopped engine is the single most common reason nothing happens, and it
 * used to be invisible: the UI ran perfectly well on its own while no work
 * was being done.
 */
function EnginePill({ running }: { running: boolean }) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs",
        running
          ? "border-border text-muted-foreground"
          : "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-500"
      )}
      title={
        running
          ? "The engine checked in within the last few minutes."
          : "Run `pnpm dev` to start the engine. The website works without it, but no work gets done."
      }
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          running ? "bg-primary" : "bg-amber-500"
        )}
      />
      {running ? "Engine running" : "Engine stopped"}
    </span>
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Tile
        label="Sent today"
        value={`${tiles.sentToday} / ${tiles.dailyCap}`}
        // The ramp is the number that actually stops sending, so say so when
        // it is below the configured ceiling. Otherwise sending appears to
        // stall at 5 with the tile reading "/ 25" and nothing explaining it.
        sub={
          tiles.warmingUp
            ? `working up to ${tiles.configuredCap} a day`
            : tiles.dryRunToday > 0
              ? `plus ${tiles.dryRunToday} practice`
              : undefined
        }
      />
      <Tile label="Replies this week" value={String(tiles.repliesLast7d)} />
      <Tile
        label="Waiting for you"
        value={String(tiles.waitingForYou)}
        sub={tiles.waitingForYou > 0 ? "in your Inbox" : undefined}
      />
      <Tile
        label="Ready to send"
        value={String(tiles.readyToSend)}
        sub={
          tiles.preparing > 0
            ? `${tiles.preparing} more being written`
            : undefined
        }
      />
      <Tile
        label="Bounced"
        value={
          tiles.bounceRateLast50 === null
            ? "—"
            : formatPercent(tiles.bounceRateLast50)
        }
        sub={
          tiles.bounceRateLast50 === null
            ? "too early to tell"
            : "of the last 50 sent"
        }
      />
    </div>
  )
}

function Chart({ points }: { points: DailyActivityPoint[] }) {
  const total = points.reduce((sum, p) => sum + p.sent, 0)
  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing sent yet. Once emails start going out, this fills in.
      </p>
    )
  }
  return <ActivityChart points={points} />
}

function Banner({
  tone,
  children,
}: {
  tone: "warning" | "danger"
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "mt-4 rounded-xl border px-4 py-3 text-sm",
        tone === "danger"
          ? "border-destructive/30 bg-destructive/5"
          : "border-amber-500/40 bg-amber-500/5"
      )}
    >
      {children}
    </div>
  )
}

function StopBanner() {
  return (
    <Banner tone="danger">
      <p className="font-medium text-destructive">
        Everything is halted. There is a STOP file.
      </p>
      <p className="mt-1 text-muted-foreground">
        Delete the file named <code className="text-xs">STOP</code> in the
        project folder to let the engine start again. Nothing on this page can
        do that for you; that is the point of it.
      </p>
    </Banner>
  )
}

function BreakerBanner({ breaker }: { breaker: BreakerInfo }) {
  return (
    <Banner tone="warning">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">
            Sending stopped itself: {humanizeBreakerName(breaker.breaker)}
          </p>
          <p className="mt-1 text-muted-foreground">{breaker.reason}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Stopped {formatDateTime(breaker.trippedAt)}. This is a safety limit
            doing its job, not a glitch. Read it before you switch sending back
            on.
          </p>
        </div>
        <RearmBreakerButton />
      </div>
    </Banner>
  )
}

function FailedBanner({
  count,
  failures,
}: {
  count: number
  failures: RecentFailure[]
}) {
  const latestReason = failures.find((f) => f.reason)?.reason
  return (
    <Banner tone="warning">
      <p className="font-medium">
        {count} job{count === 1 ? "" : "s"} gave up after repeated tries
      </p>
      <p className="mt-1 text-muted-foreground">
        {latestReason ? `Most recent reason: ${latestReason}. ` : ""}
        <a href="#activity-feed" className="underline underline-offset-2">
          See recent activity
        </a>{" "}
        for the rest.
      </p>
    </Banner>
  )
}

function MailboxRow({ mailbox }: { mailbox: MailboxHealthItem }) {
  const paused = mailbox.pausedReason !== null
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
      <span className="truncate font-medium">{mailbox.email}</span>
      <Badge variant={paused ? "destructive" : "outline"}>
        {paused ? `Paused: ${mailbox.pausedReason}` : mailbox.status}
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
          <span className="text-muted-foreground"> · {item.leadName}</span>
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
    <Page>
      <PageHeader
        title="Welcome"
        description="Two things to do before this can start working."
      />
      <ol className="flex flex-col gap-3 text-sm">
        <li className="rounded-xl border border-border px-4 py-3">
          <span className="font-medium">1. Fill in Settings.</span>
          <p className="mt-1 text-muted-foreground">
            You need an AI provider to write the emails, a Gmail account to send
            them from, and your business address. US law requires that address
            on every sales email.
          </p>
          <Button
            render={<Link href="/settings" />}
            nativeButton={false}
            size="sm"
            className="mt-2"
          >
            Open Settings
          </Button>
        </li>
        <li className="rounded-xl border border-border px-4 py-3">
          <span className="font-medium">2. Find some businesses.</span>
          <p className="mt-1 text-muted-foreground">
            Search a town or ZIP code, pick the kinds of business you want, and
            add the ones that look good.
          </p>
          <Button
            render={<Link href="/leads" />}
            nativeButton={false}
            size="sm"
            variant="outline"
            className="mt-2"
          >
            Open Leads
          </Button>
        </li>
      </ol>
    </Page>
  )
}
