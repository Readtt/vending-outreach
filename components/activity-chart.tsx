import type { DailyActivityPoint } from "@/lib/db"

function shortDate(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

/**
 * Two weeks of sending, as plain bars.
 *
 * It answers the one question a number cannot: is this thing going out
 * steadily? A climbing left edge is the warm-up ramp working, flat gaps every
 * five bars are weekends, and a run of empty days means something stopped.
 *
 * One scale, one meaning: bar height is emails sent. Replies are far rarer
 * than sends, so plotting them on the same axis would draw them as invisible
 * slivers — a day that got a reply is marked with a dot above the bar instead.
 *
 * Bars are flex children with percentage heights rather than SVG, which keeps
 * it responsive for free and the whole file under a hundred lines. A charting
 * library for this would be several hundred kilobytes.
 */
export function ActivityChart({ points }: { points: DailyActivityPoint[] }) {
  const max = Math.max(...points.map((p) => p.sent), 1)
  const anyReplies = points.some((p) => p.replies > 0)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-20 items-end gap-1">
        {points.map((point) => (
          <div
            key={point.date}
            className="flex h-full flex-1 flex-col justify-end gap-1"
            title={`${shortDate(point.date)}: ${point.sent} sent${
              point.replies > 0
                ? `, ${point.replies} ${point.replies === 1 ? "reply" : "replies"}`
                : ""
            }`}
          >
            <div
              className="mx-auto size-1.5 shrink-0 rounded-full bg-primary"
              style={{ visibility: point.replies > 0 ? "visible" : "hidden" }}
            />
            <div
              className="rounded-sm bg-foreground/15"
              style={{
                // A day with one send still gets a visible sliver rather than
                // being indistinguishable from a day with none.
                height: point.sent === 0 ? 2 : `${(point.sent / max) * 100}%`,
                opacity: point.sent === 0 ? 0.4 : 1,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{shortDate(points[0].date)}</span>
        {anyReplies && (
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-primary" />
            got a reply
          </span>
        )}
        <span>Today</span>
      </div>
    </div>
  )
}
