/**
 * Display formatting shared by every screen.
 *
 * Pure and dependency-free, so client components can import it without
 * dragging `node:sqlite` into the browser bundle — the same rule each
 * screen's own `types.ts` follows.
 *
 * ## Why the locale is pinned
 *
 * `toLocaleString(undefined, …)` asks the *runtime* for a locale, and in a
 * Next.js app there are two runtimes. Node resolves it from the operating
 * system; the browser resolves it from its own language settings. On a
 * machine set to Canadian English, the server renders "2:00 p.m." and the
 * browser renders "2:00 PM" — different text for the same timestamp, which
 * React reports as a hydration failure and recovers from by throwing away the
 * server's markup and re-rendering the whole tree on the client.
 *
 * Every screen here shows timestamps, so that was happening on every page
 * load. Naming the locale makes both runtimes agree.
 */

/**
 * The one locale this app formats in.
 *
 * en-US rather than the operating system's, because the value of a stable
 * choice here outweighs the difference it makes: the only thing that varies
 * between the North American English locales at these field widths is whether
 * the meridiem reads "PM" or "p.m.".
 */
const LOCALE = "en-US"

/** "Sep 9, 2:00 PM" — a timestamp at the precision these screens care about. */
export function formatDateTime(epochMs: number | null): string {
  if (epochMs === null) return ""
  return new Date(epochMs).toLocaleString(LOCALE, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/** "Sep 9" — for an axis label, where the time would be noise. */
export function formatDay(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(LOCALE, {
    month: "short",
    day: "numeric",
  })
}

/**
 * "Columbus, OH" out of "1200 N High St, Columbus, OH 43201".
 *
 * Addresses arrive as one string built by `lib/osm.ts` from the tags a
 * business happens to have, so this reads the tail rather than parsing: the
 * last two comma-separated parts are the town and the state or province, and
 * the postal code is whatever trails the latter. Anything that does not look
 * like that is handed back whole, because a shortened address that has lost
 * the town is worse than a long one.
 */
export function shortLocation(address: string | null): string {
  if (!address) return ""
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (parts.length < 2) return address.trim()

  const town = parts[parts.length - 2]
  // "OH 43201" and "ON K1A 0B1" both leave just the region behind.
  const region = parts[parts.length - 1].split(/\s+/)[0]
  return region ? `${town}, ${region}` : town
}

/** "3 hours" / "1 hour" / "2 days" — a gap, said the way a person would. */
export function formatElapsed(hours: number): string {
  if (hours < 1) return "less than an hour"
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`
  return `${Math.round(hours / 24)} days`
}
