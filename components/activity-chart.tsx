import type { DailyActivityPoint } from "@/lib/db"
import { formatDay } from "@/lib/format"

/**
 * Two weeks of sending, as plain bars.
 *
 * It answers the one question a number cannot: is this thing going out
 * steadily? A climbing left edge is the warm-up ramp working, flat gaps every
 * five bars are weekends, and a run of empty days means something stopped.
 *
 * Rehearsals are drawn too, hollow rather than solid. Sending starts switched
 * off and stays off until the user has read what the app wrote, so a chart
 * that only counted real sends was blank for exactly the stretch when someone
 * is trying to work out whether any of this is working — and blank is what it
 * also looks like when the engine has died.
 *
 * One scale, one meaning: bar height is emails written that day, real or
 * rehearsed. Replies are far rarer than sends, so plotting them on the same
 * axis would draw them as invisible slivers — a day that got a reply is
 * marked with a dot above the bar instead.
 *
 * Bars are flex children with percentage heights rather than SVG, which keeps
 * it responsive for free and the whole file under a hundred lines. A charting
 * library for this would be several hundred kilobytes.
 */
export function ActivityChart({ points }: { points: DailyActivityPoint[] }) {
  const total = (p: DailyActivityPoint) => p.sent + p.rehearsed
  const max = Math.max(...points.map(total), 1)
  const anyReplies = points.some((p) => p.replies > 0)
  const anyRehearsals = points.some((p) => p.rehearsed > 0)
  const anyReal = points.some((p) => p.sent > 0)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-20 items-end gap-1">
        {points.map((point) => {
          const day = total(point)
          const parts = [
            point.sent > 0 ? `${point.sent} sent` : null,
            point.rehearsed > 0 ? `${point.rehearsed} rehearsed` : null,
            point.replies > 0
              ? `${point.replies} ${point.replies === 1 ? "reply" : "replies"}`
              : null,
          ].filter(Boolean)
          return (
            <div
              key={point.date}
              className="flex h-full flex-1 flex-col justify-end gap-1"
              title={`${formatDay(point.date)}: ${
                parts.length > 0 ? parts.join(", ") : "nothing"
              }`}
            >
              <div
                className="mx-auto size-1.5 shrink-0 rounded-full bg-primary"
                style={{ visibility: point.replies > 0 ? "visible" : "hidden" }}
              />
              {/* Two stacked segments, so a day that is part rehearsal and
                  part real reads as one bar of the right height. */}
              {point.sent > 0 && (
                <div
                  className="rounded-t-sm bg-foreground/40"
                  style={{ height: `${(point.sent / max) * 100}%` }}
                />
              )}
              {point.rehearsed > 0 && (
                <div
                  className="rounded-sm border border-dashed border-foreground/30 bg-foreground/[0.06]"
                  style={{ height: `${(point.rehearsed / max) * 100}%` }}
                />
              )}
              {day === 0 && (
                <div
                  className="rounded-sm bg-foreground/15 opacity-40"
                  style={{ height: 2 }}
                />
              )}
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{formatDay(points[0].date)}</span>
        <span className="flex items-center gap-3">
          {anyRehearsals && (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-[2px] border border-dashed border-foreground/40" />
              {anyReal ? "rehearsal" : "rehearsals only so far"}
            </span>
          )}
          {anyReplies && (
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-primary" />
              got a reply
            </span>
          )}
        </span>
        <span>Today</span>
      </div>
    </div>
  )
}
