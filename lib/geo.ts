/**
 * Where a campaign is allowed to reach, and what that implies.
 *
 * Two countries are supported, and which one a business is in changes real
 * behaviour, not just a label:
 *
 *  - **United States.** CAN-SPAM. Cold email is legal without prior consent
 *    as long as the message carries a real postal address, an honest subject
 *    line, and a working opt-out.
 *  - **Canada.** CASL, which requires consent — but not necessarily express
 *    consent. Section 10(9)(b) gives *implied* consent where the recipient
 *    conspicuously published their address, did not attach a "no unsolicited
 *    mail" notice to it, and the message is relevant to their business role.
 *    A vending pitch to an address a business publishes on its own contact
 *    page is exactly that case, and unlike the express-consent clock, this
 *    kind of implied consent does not expire.
 *
 *    Two things follow, and both are enforced rather than documented:
 *    `lib/leads.ts` will not send to a Canadian lead whose address came from
 *    an OpenStreetMap tag rather than the business's own website (a map entry
 *    someone else typed is not the recipient publishing anything), and
 *    `lib/prompts.ts` requires a phone number or website alongside the postal
 *    address, which CASL asks for and CAN-SPAM does not.
 *
 * The bounding boxes are the coarse half of keeping those two apart. They are
 * lists of longitude strips rather than one rectangle per country because the
 * border is not rectangle-separable: a single box around the lower 48
 * contains Toronto. Each strip's border edge is rounded *away* from the
 * border, so both tables under-cover on purpose. Under-coverage costs leads;
 * over-coverage sends a US-compliant email to a Canadian business, or a
 * Canadian one to somebody in Ohio.
 */

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------

export type Country = "US" | "CA"

export const COUNTRIES: readonly Country[] = ["US", "CA"]

export const COUNTRY_LABELS: Record<Country, string> = {
  US: "United States",
  CA: "Canada",
}

/** Adjective form, for sentences like "a Canadian business". */
export const COUNTRY_ADJECTIVES: Record<Country, string> = {
  US: "American",
  CA: "Canadian",
}

/**
 * Names the selected countries for the middle of a sentence: "the United
 * States", "Canada", "the United States or Canada".
 *
 * The article belongs to the name and not to the sentence around it, which is
 * why this exists rather than callers writing `the ${COUNTRY_LABELS[c]}` —
 * that is how the search error came to read "did not match anywhere in the
 * Canada".
 */
export function describeCountries(countries: readonly Country[]): string {
  const names = countries.map((c) => (c === "US" ? "the United States" : "Canada"))
  if (names.length === 0) return "the selected countries"
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`
}

export function isCountry(value: unknown): value is Country {
  return value === "US" || value === "CA"
}

/** ISO 3166-1 alpha-2 codes, lowercased, for Nominatim's `countrycodes`. */
export function countryCodesParam(countries: readonly Country[]): string {
  return countries.map((c) => c.toLowerCase()).join(",")
}

// ---------------------------------------------------------------------------
// Bounding boxes
// ---------------------------------------------------------------------------

export interface BBox {
  south: number
  west: number
  north: number
  east: number
}

export function assertValidBBox(bbox: BBox, label = "bbox"): void {
  for (const [name, value] of Object.entries(bbox)) {
    if (!Number.isFinite(value)) {
      throw new Error(`${label}: ${name} is not a finite number (${value})`)
    }
  }
  if (bbox.south < -90 || bbox.north > 90) {
    throw new Error(
      `${label}: latitudes must be within [-90, 90] (got ${bbox.south}..${bbox.north})`
    )
  }
  if (bbox.west < -180 || bbox.east > 180) {
    throw new Error(
      `${label}: longitudes must be within [-180, 180] (got ${bbox.west}..${bbox.east})`
    )
  }
  if (bbox.south > bbox.north) {
    throw new Error(
      `${label}: south (${bbox.south}) is north of north (${bbox.north})`
    )
  }
  if (bbox.west > bbox.east) {
    // An antimeridian-crossing box is legal in some APIs and is silently
    // wrong in Overpass, which reads it as a box spanning the whole globe the
    // other way round. Refuse rather than issue that query.
    throw new Error(
      `${label}: west (${bbox.west}) is east of east (${bbox.east}). ` +
        "A box crossing the antimeridian must be split into two."
    )
  }
}

/**
 * US bounding regions, as longitude strips whose northern (and, along the
 * Rio Grande, southern) edge steps to stay on the US side of the border.
 *
 * ### Why this is a list of strips and not one rectangle
 *
 * Spec §0.5 makes US-only bboxes a non-negotiable invariant: a bbox reaching
 * into Canada puts the campaign under CASL, which — unlike CAN-SPAM — has no
 * cold-email carve-out. One `24.4..49.4 / -125..-66.9` rectangle contains
 * Toronto, Windsor, and the whole Niagara peninsula, so it would satisfy the
 * type signature and none of the requirement.
 *
 * Each strip's north edge is set to the border latitude at that longitude,
 * rounded toward the US. The values are approximate by design and always err
 * inward: under-coverage costs leads, over-coverage costs a legal exposure.
 *
 * ### Known under-coverage — read before "fixing" a value
 *
 * The border is not rectangle-separable everywhere, and three places are
 * genuinely impossible rather than merely unrefined:
 *
 *  - **Detroit / Windsor.** Windsor ON sits *south-east* of downtown Detroit
 *    (both ≈42.3°N, ≈-83.05°). Ontario also dips to 41.68°N at Middle Island.
 *    No axis-aligned rectangle contains Detroit and excludes Ontario, so the
 *    `-83.30..-82.40` strip stops at 41.65°N and Detroit is outside it.
 *  - **Niagara Falls NY** (43.09°N, -79.06°) is inside the same kind of
 *    pocket as Fort Erie ON; the `-79.00..-76.50` strip starts east of it.
 *    Buffalo (42.89°N, -78.85°) *is* covered.
 *  - **The Alaska panhandle.** Juneau/Sitka/Ketchikan are a coastal ribbon
 *    with British Columbia immediately inland; every rectangle around them
 *    contains BC. It is omitted entirely.
 *
 * The correct fix is a point-in-polygon test against a US boundary polygon,
 * or an Overpass `area["ISO3166-1"="US"]` filter. Both are real work and
 * neither is what a rectangle-clamping API can express. `searchOverpass`
 * additionally drops any candidate tagged `addr:country` other than the US,
 * which is defence in depth rather than a substitute.
 */
export const US_BOUNDS: readonly BBox[] = [
  // --- Lower 48, west to east ---------------------------------------------
  // north edge: below Vancouver Island (Victoria BC is 48.43°N)
  { south: 32.5, west: -124.8, north: 48.3, east: -123.0 },
  // north edge: the 49th parallel border, which runs from -123.32 to -95.15
  { south: 32.5, west: -123.0, north: 48.99, east: -117.2 },
  // south edge: the California/Baja line at 32.53°N
  { south: 32.5, west: -117.2, north: 48.99, east: -114.5 },
  // south edge: the Arizona/Sonora line at 31.33°N
  { south: 31.3, west: -114.5, north: 48.99, east: -108.2 },
  // south edge: the New Mexico bootheel step up to 31.78°N
  { south: 31.75, west: -108.2, north: 48.99, east: -106.5 },
  // south edge: the Rio Grande, which runs diagonally from El Paso to the Gulf
  { south: 29.3, west: -106.5, north: 48.99, east: -104.0 },
  { south: 29.8, west: -104.0, north: 48.99, east: -102.0 },
  { south: 28.6, west: -102.0, north: 48.99, east: -100.0 },
  { south: 26.4, west: -100.0, north: 48.99, east: -98.0 },
  // south edge: Brownsville TX, the southern tip of the lower 48
  { south: 25.9, west: -98.0, north: 48.99, east: -96.5 },
  // south edge: the Florida Keys (Key West is 24.55°N)
  { south: 24.4, west: -96.5, north: 48.99, east: -95.2 },
  // north edge: the Rainy River / Lake Superior border, ≥47.9°N here
  { south: 24.4, west: -95.2, north: 47.8, east: -90.0 },
  // north edge: below Sault Ste. Marie MI (46.49°N)
  { south: 24.4, west: -90.0, north: 46.2, east: -84.6 },
  // north edge: Michigan's lower peninsula, below the Lake Huron border
  { south: 24.4, west: -84.6, north: 45.5, east: -83.3 },
  // north edge: Ontario reaches 41.68°N here. See the note above.
  { south: 24.4, west: -83.3, north: 41.65, east: -82.4 },
  // north edge: the Lake Erie north shore, ≥42.25°N east of Point Pelee
  { south: 24.4, west: -82.4, north: 42.2, east: -79.0 },
  // north edge: below the Lake Ontario border; covers Buffalo and Rochester
  { south: 24.4, west: -79.0, north: 43.2, east: -76.5 },
  // north edge: below the St. Lawrence
  { south: 24.4, west: -76.5, north: 44.1, east: -74.8 },
  // north edge: the 45th parallel border (NY / VT / NH)
  { south: 24.4, west: -74.8, north: 44.95, east: -71.5 },
  // north edge: western Maine, where the border turns up the height of land
  { south: 24.4, west: -71.5, north: 45.3, east: -70.2 },
  { south: 24.4, west: -70.2, north: 46.6, east: -69.2 },
  // north edge: the St. John river (Fort Kent ME is 47.26°N)
  { south: 24.4, west: -69.2, north: 47.3, east: -67.8 },
  // north edge: Down East Maine, west of the New Brunswick line
  { south: 24.4, west: -67.8, north: 44.95, east: -66.9 },
  // --- Alaska ---------------------------------------------------------------
  // Everything west of the 141st meridian border. The panhandle is omitted.
  { south: 54.5, west: -168.2, north: 71.5, east: -141.0 },
  // The western Aleutians, which sit east of the antimeridian
  { south: 51.0, west: 172.0, north: 53.5, east: 179.99 },
  // --- Hawaii ---------------------------------------------------------------
  { south: 18.86, west: -160.3, north: 22.3, east: -154.75 },
]

/**
 * Canadian bounding regions — the mirror of `US_BOUNDS`, as longitude strips
 * whose *southern* edge steps to stay on the Canadian side of the border.
 *
 * ### Known under-coverage — read before "fixing" a value
 *
 * The border cities are the whole difficulty, because most of Canada's
 * population lives on it. Where a Canadian city sits at or below the latitude
 * of the US city across the river, no axis-aligned rectangle can take one and
 * leave the other, and the rule above says we drop the Canadian one:
 *
 *  - **Windsor and southwestern Ontario below 42.3°N.** Windsor is *south* of
 *    downtown Detroit. Leamington and Point Pelee (41.9°N) are further south
 *    still — the southernmost mainland in Canada, below the north coast of
 *    Ohio. Sarnia is opposite Port Huron at the same latitude.
 *  - **Sault Ste. Marie, Ontario** (46.52°N) faces Sault Ste. Marie, Michigan
 *    (46.49°N) across half a mile of river.
 *  - **Fort Frances, Ontario** (48.61°N) faces International Falls, Minnesota
 *    (48.60°N).
 *  - **Niagara Falls, Ontario** (43.09°N, -79.085°) and its neighbours Fort
 *    Erie and Niagara-on-the-Lake. The Niagara River is 300m wide and the two
 *    Niagara Falls sit across it from each other; Grand Island NY is in the
 *    middle of it. St. Catharines and Hamilton, further west, are covered.
 *  - **Sarnia, Ontario** (42.97°N, -82.41°) faces Port Huron, Michigan at the
 *    same latitude, 2km east.
 *  - **The Thousand Islands** — Gananoque and Brockville, Ontario — where the
 *    two countries interleave island by island down the St. Lawrence.
 *  - **Edmundston, New Brunswick** (47.37°N) faces Madawaska, Maine (47.36°N).
 *  - **Prince Rupert, BC** (54.31°N), which is south of the Alaska
 *    panhandle's inland reach rather than across a river from it.
 *
 * Everything else clears comfortably: Vancouver, Victoria, Calgary, Edmonton,
 * Winnipeg, Thunder Bay, London, Hamilton, Toronto, Ottawa, Montreal, Quebec
 * City, Saint John, Halifax and St. John's are all inside a strip.
 */
export const CA_BOUNDS: readonly BBox[] = [
  // --- Yukon, and the mainland north of the Alaska panhandle ---------------
  // south edge: the panhandle reaches 60°N; Alaska proper is west of -141.
  { south: 60.0, west: -141.0, north: 84.0, east: -130.0 },
  // --- British Columbia -----------------------------------------------------
  // south edge: the 49th parallel. West edge steps in past the panhandle.
  { south: 49.0, west: -130.0, north: 60.0, east: -123.3 },
  // Vancouver Island's south end. Cape Flattery WA, the northwest corner of
  // the lower 48, is 48.38°N, so 48.42 takes Victoria and leaves Washington.
  { south: 48.42, west: -128.5, north: 49.0, east: -123.3 },
  // --- The 49th parallel, BC interior to Manitoba ---------------------------
  // east edge: Minnesota's Northwest Angle starts here and reaches 49.38°N.
  { south: 49.0, west: -123.3, north: 84.0, east: -95.15 },
  { south: 49.4, west: -95.15, north: 84.0, east: -94.7 },
  // --- Northwestern Ontario -------------------------------------------------
  // south edge: above the Rainy River border, whose US bank tops out at
  // Baudette MN (48.71°N). Fort Frances is outside.
  { south: 48.85, west: -94.7, north: 84.0, east: -91.5 },
  // south edge: above the Boundary Waters, which reach 48.25°N.
  { south: 48.4, west: -91.5, north: 84.0, east: -89.5 },
  // south edge: above Isle Royale MI (48.22°N). Takes Thunder Bay (48.38°N).
  { south: 48.3, west: -89.5, north: 84.0, east: -84.6 },
  // --- Northern Ontario, the St. Marys River and Lake Huron -----------------
  // south edge: above Sault Ste. Marie MI. See the note above.
  { south: 46.6, west: -84.6, north: 84.0, east: -82.4 },
  // --- Southwestern Ontario -------------------------------------------------
  // south edge: above Presque Isle PA (42.16°N) and the Ohio shore. Takes
  // London and Chatham; Windsor and Leamington are below it.
  { south: 42.3, west: -82.4, north: 46.6, east: -80.5 },
  // south edge: above the New York shore of Lake Erie, which climbs from
  // 42.0°N at the Pennsylvania line to 42.65°N by -79.1. Takes Hamilton,
  // St. Catharines, Welland and Port Colborne.
  { south: 42.7, west: -80.5, north: 46.6, east: -79.1 },
  // --- Eastern Ontario ------------------------------------------------------
  // south edge: above the New York shore of Lake Ontario, whose high point is
  // Point Breeze at 43.37°N. Takes Toronto, Oshawa, Peterborough, Kingston.
  { south: 43.45, west: -79.1, north: 84.0, east: -76.6 },
  // Kingston, which sits on open water 30km north of the nearest US land
  // (Point Peninsula NY, 44.06°N) and would otherwise be swallowed by the
  // Thousand Islands strip below.
  { south: 44.15, west: -76.6, north: 84.0, east: -76.38 },
  // south edge: above the St. Lawrence at Akwesasne NY (44.99°N). Takes
  // Cornwall by 4km, and Ottawa comfortably. The Thousand Islands between
  // here and Kingston are interleaved and belong to neither table.
  { south: 45.03, west: -76.38, north: 84.0, east: -74.7 },
  // --- Quebec ---------------------------------------------------------------
  // south edge: the 45th parallel border with New York and Vermont.
  { south: 45.02, west: -74.7, north: 84.0, east: -71.5 },
  // south edge: western Maine, where the border turns up the height of land.
  { south: 45.4, west: -71.5, north: 84.0, east: -70.2 },
  { south: 46.7, west: -70.2, north: 84.0, east: -69.2 },
  // --- New Brunswick --------------------------------------------------------
  // south edge: above Madawaska ME (47.36°N). Edmundston is outside.
  { south: 47.45, west: -69.2, north: 84.0, east: -67.8 },
  // south edge: above Calais ME (45.19°N). Takes Saint John, Fredericton.
  { south: 45.25, west: -67.8, north: 84.0, east: -66.9 },
  // --- Nova Scotia, PEI, Newfoundland and Labrador --------------------------
  // No US territory east of -66.9, so this one is just the Atlantic coast.
  { south: 43.0, west: -66.9, north: 84.0, east: -52.0 },
]

export const COUNTRY_BOUNDS: Record<Country, readonly BBox[]> = {
  US: US_BOUNDS,
  CA: CA_BOUNDS,
}

/** Every strip belonging to any of `countries`, in the order given. */
export function boundsFor(countries: readonly Country[]): readonly BBox[] {
  if (countries.length === 0) {
    throw new Error("boundsFor: no countries were selected")
  }
  return countries.flatMap((country) => COUNTRY_BOUNDS[country])
}

function intersectBBox(a: BBox, b: BBox): BBox | undefined {
  const south = Math.max(a.south, b.south)
  const north = Math.min(a.north, b.north)
  const west = Math.max(a.west, b.west)
  const east = Math.min(a.east, b.east)
  if (south >= north || west >= east) return undefined
  return { south, west, north, east }
}

function bboxArea(bbox: BBox): number {
  return (bbox.north - bbox.south) * (bbox.east - bbox.west)
}

function containsPoint(region: BBox, lat: number, lng: number): boolean {
  return (
    lat >= region.south &&
    lat <= region.north &&
    lng >= region.west &&
    lng <= region.east
  )
}

/**
 * Sample coordinates along one axis: every region edge that falls strictly
 * inside `[lo, hi]`, plus the two endpoints, reduced to one representative
 * value per resulting interval.
 *
 * Region membership is constant across each interval — the only places it can
 * change are the region edges — so testing one point per interval is exact,
 * not a heuristic. A degenerate span (`lo === hi`, i.e. a point or line bbox)
 * collapses to the single value, which is why a point query works at all.
 */
function sampleAxis(
  lo: number,
  hi: number,
  edges: readonly number[]
): number[] {
  if (lo === hi) return [lo]
  const cuts = [lo, hi]
  for (const edge of edges) {
    if (edge > lo && edge < hi) cuts.push(edge)
  }
  cuts.sort((a, b) => a - b)

  const samples: number[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const mid = (cuts[i] + cuts[i + 1]) / 2
    // A midpoint that rounds onto a cut would test the boundary instead of
    // the interval; only possible for spans near the float epsilon.
    if (mid > cuts[i] && mid < cuts[i + 1]) samples.push(mid)
  }
  // The endpoints matter in their own right: a bbox whose north edge sits
  // exactly on a border latitude is inside, one a hair above is not.
  samples.push(lo, hi)
  return samples
}

/**
 * True only if every point of `bbox` lies inside some strip of some selected
 * country.
 *
 * ### Why the union, and why a sweep
 *
 * The union across strips is what "inside the country" means here: the strips
 * only exist because one rectangle cannot describe a country, so a box
 * straddling two of them — a 25-mile box around Kansas City sits on the
 * `-96.50 / -95.20` seam — is inside, not outside.
 *
 * Implemented as a sweep over the arrangement the strip edges induce on the
 * bbox rather than by rectangle subtraction: subtraction drops zero-area
 * pieces, which silently makes every degenerate (single-point) bbox read as
 * "covered by nothing" and therefore outside — a check that returns `false`
 * for Columbus, Ohio and for Lagos alike is not a check.
 */
export function isWithinCountries(
  bbox: BBox,
  countries: readonly Country[]
): boolean {
  assertValidBBox(bbox)
  const regions = boundsFor(countries)

  const lats = sampleAxis(
    bbox.south,
    bbox.north,
    regions.flatMap((r) => [r.south, r.north])
  )
  const lngs = sampleAxis(
    bbox.west,
    bbox.east,
    regions.flatMap((r) => [r.west, r.east])
  )

  for (const lat of lats) {
    for (const lng of lngs) {
      if (!regions.some((region) => containsPoint(region, lat, lng))) {
        return false
      }
    }
  }
  return true
}

/**
 * Clamps `bbox` so the result is entirely inside the selected countries, or
 * throws when there is nothing to clamp to (a box over Europe has no American
 * or Canadian part to keep).
 *
 * A box already inside is returned unchanged. Otherwise two candidates are
 * considered and the larger wins:
 *
 *  1. the intersection with the single best-overlapping strip, and
 *  2. the box with its latitudes pulled in to what *every* overlapping strip
 *     can accept, which preserves the full longitude span.
 *
 * (2) exists because (1) alone answers "a bbox from -96 to -94" by throwing
 * away half the longitude range, when pulling the north edge down by 1.2° is
 * both a smaller change and closer to what the caller asked for.
 */
export function clampToCountries(
  bbox: BBox,
  countries: readonly Country[]
): BBox {
  assertValidBBox(bbox)
  if (isWithinCountries(bbox, countries)) return bbox

  const overlapping = boundsFor(countries)
    .map((region) => ({ region, overlap: intersectBBox(bbox, region) }))
    .filter(
      (entry): entry is { region: BBox; overlap: BBox } =>
        entry.overlap !== undefined
    )

  if (overlapping.length === 0) {
    const names = countries.map((c) => COUNTRY_LABELS[c]).join(" or ")
    throw new Error(
      `clampToCountries: the bbox ${JSON.stringify(bbox)} does not overlap ` +
        `${names}, so there is nothing to clamp it to. Searching outside the ` +
        "selected countries is not allowed: an email into the EU or the UK " +
        "lands under GDPR and PECR, which this app has no story for."
    )
  }

  let best = overlapping[0].overlap
  for (const { overlap } of overlapping) {
    if (bboxArea(overlap) > bboxArea(best)) best = overlap
  }

  // Candidate 2: keep the longitude span, tighten the latitudes to the
  // strictest overlapping strip.
  const south = Math.max(bbox.south, ...overlapping.map((e) => e.region.south))
  const north = Math.min(bbox.north, ...overlapping.map((e) => e.region.north))
  if (north > south) {
    const widened: BBox = { south, north, west: bbox.west, east: bbox.east }
    if (
      bboxArea(widened) > bboxArea(best) &&
      isWithinCountries(widened, countries)
    ) {
      best = widened
    }
  }

  return best
}

/** `isWithinCountries` for the US alone. */
export function isWithinUs(bbox: BBox): boolean {
  return isWithinCountries(bbox, ["US"])
}

/** `clampToCountries` for the US alone. */
export function clampToUs(bbox: BBox): BBox {
  return clampToCountries(bbox, ["US"])
}

/**
 * Which country a point is in, or undefined where the strips cannot say.
 *
 * Undefined is a real answer, not a failure: the strips deliberately leave a
 * gap either side of the border, so a business in Windsor or Sault Ste. Marie
 * lands in neither table. Callers decide what to do about that — `lib/leads.ts`
 * treats an unknown country as Canada, because guessing CAN-SPAM for a
 * Canadian business is the expensive direction to be wrong in.
 */
export function countryForPoint(lat: number, lng: number): Country | undefined {
  for (const country of COUNTRIES) {
    if (COUNTRY_BOUNDS[country].some((r) => containsPoint(r, lat, lng))) {
      return country
    }
  }
  return undefined
}

/**
 * Mean miles per degree of latitude. Exported so a caller (and the tests) can
 * check `bboxAround`'s span without re-deriving the constant.
 */
export const MILES_PER_DEGREE_LATITUDE = 69.0547

/**
 * Above this a single Overpass query stops being a search and becomes an
 * outage for everyone else on the instance.
 */
export const MAX_RADIUS_MILES = 250

/**
 * A radius search is not expressible in Overpass's bbox filter, so the radius
 * becomes the *circumscribing* box: the north-south span is exactly
 * `2 * radiusMiles`, and the east-west span is widened by `1/cos(lat)` so it
 * covers the same distance on the ground rather than the same number of
 * degrees.
 */
export function bboxAround(
  lat: number,
  lng: number,
  radiusMiles: number
): BBox {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`bboxAround: latitude ${lat} is out of range`)
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error(`bboxAround: longitude ${lng} is out of range`)
  }
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) {
    throw new Error(
      `bboxAround: radiusMiles must be positive (got ${radiusMiles})`
    )
  }
  if (radiusMiles > MAX_RADIUS_MILES) {
    // A 250-mile radius is already a 500-mile box and several minutes of
    // Overpass time. Refusing beats issuing a query that will time out after
    // consuming a large slice of shared capacity.
    throw new Error(
      `bboxAround: radiusMiles ${radiusMiles} exceeds ${MAX_RADIUS_MILES}. ` +
        "Run several smaller searches instead — Overpass is donated capacity."
    )
  }

  const latDelta = radiusMiles / MILES_PER_DEGREE_LATITUDE
  // At high latitude cos() collapses and the longitude delta explodes; the
  // floor keeps the divisor sane and the clamps below keep the box legal.
  const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.01)
  const lngDelta = radiusMiles / (MILES_PER_DEGREE_LATITUDE * cos)

  return {
    south: Math.max(-90, lat - latDelta),
    north: Math.min(90, lat + latDelta),
    west: Math.max(-180, lng - lngDelta),
    east: Math.min(180, lng + lngDelta),
  }
}

// ---------------------------------------------------------------------------
// States, provinces, and the timezone a business keeps
// ---------------------------------------------------------------------------

/**
 * The timezone each state and province is treated as being in.
 *
 * Several of these are genuinely split — Florida, Michigan, Indiana, Kentucky,
 * Tennessee, Texas, Idaho, Ontario and Nunavut all have two zones — and the
 * entry is the one the large majority of the population lives in. The cost of
 * being wrong is an email arriving at 8am instead of 9am, so a table that is
 * right for most addresses beats a dependency on a full timezone shapefile.
 * Longitude decides when there is no state or province to read.
 *
 * The two entries that matter more than the rest are Arizona and
 * Saskatchewan, which do not observe daylight saving. Guessing those from
 * longitude puts every send an hour out for half the year.
 */
const REGION_TIMEZONES: Readonly<Record<string, string>> = {
  // --- United States --------------------------------------------------------
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DE: "America/New_York",
  DC: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  ID: "America/Boise",
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago",
  KS: "America/Chicago",
  KY: "America/New_York",
  LA: "America/Chicago",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/Detroit",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  MT: "America/Denver",
  NE: "America/Chicago",
  NV: "America/Los_Angeles",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NY: "America/New_York",
  NC: "America/New_York",
  ND: "America/Chicago",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  UT: "America/Denver",
  VT: "America/New_York",
  VA: "America/New_York",
  WA: "America/Los_Angeles",
  WV: "America/New_York",
  WI: "America/Chicago",
  WY: "America/Denver",
  // --- Canada ---------------------------------------------------------------
  AB: "America/Edmonton",
  BC: "America/Vancouver",
  MB: "America/Winnipeg",
  NB: "America/Moncton",
  NL: "America/St_Johns",
  NS: "America/Halifax",
  NT: "America/Yellowknife",
  NU: "America/Iqaluit",
  ON: "America/Toronto",
  PE: "America/Halifax",
  QC: "America/Toronto",
  SK: "America/Regina",
  YT: "America/Whitehorse",
}

/** The thirteen Canadian codes. Every other code in the table is American. */
const CA_REGION_CODES: readonly string[] = [
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
]

/**
 * Which country a state or province code belongs to.
 *
 * A lookup rather than a guess because the two lists are disjoint: no
 * Canadian province shares a postal abbreviation with a US state, which is
 * what makes "ON" or "SK" on its own conclusive.
 */
const REGION_COUNTRIES: Readonly<Record<string, Country>> = Object.fromEntries(
  Object.keys(REGION_TIMEZONES).map((code) => [
    code,
    CA_REGION_CODES.includes(code) ? "CA" : "US",
  ])
)

/** Full names, for the addresses that spell the province or state out. */
const REGION_NAMES: Readonly<Record<string, string>> = {
  ALBERTA: "AB",
  "BRITISH COLUMBIA": "BC",
  MANITOBA: "MB",
  "NEW BRUNSWICK": "NB",
  NEWFOUNDLAND: "NL",
  "NEWFOUNDLAND AND LABRADOR": "NL",
  "NOVA SCOTIA": "NS",
  "NORTHWEST TERRITORIES": "NT",
  NUNAVUT: "NU",
  ONTARIO: "ON",
  "PRINCE EDWARD ISLAND": "PE",
  QUEBEC: "QC",
  SASKATCHEWAN: "SK",
  YUKON: "YT",
}

/** The two-letter code for a state or province, or undefined. */
function regionCode(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  // Accents are stripped so "Québec" and "Quebec" are one key.
  const trimmed = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
  if (trimmed.length === 2 && trimmed in REGION_TIMEZONES) return trimmed
  return REGION_NAMES[trimmed]
}

/** ISO codes and the spellings OSM's `addr:country` actually contains. */
const COUNTRY_TAG_VALUES: Readonly<Record<string, Country>> = {
  US: "US",
  USA: "US",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  CA: "CA",
  CAN: "CA",
  CANADA: "CA",
}

/** A Canadian postal code: `K1A 0B1`, with the space optional. */
const CA_POSTCODE = /^[ABCEGHJ-NPRSTVXY]\d[A-Z][ -]?\d[A-Z]\d$/i

/** A US ZIP: five digits, optionally plus four. */
const US_ZIPCODE = /^\d{5}(?:-\d{4})?$/

export interface AddressParts {
  /** The raw `addr:country` tag, if the business has one. */
  country?: string | null
  /** The raw `addr:state` tag — a province code lives here too. */
  state?: string | null
  postcode?: string | null
  lat?: number
  lng?: number
}

/**
 * Which country a business is in, read from the strongest evidence available.
 *
 * The order matters. An explicit `addr:country` is the business saying so. A
 * province code is next, because the two lists of codes are disjoint and a
 * postal abbreviation is rarely wrong. A postal code shape is nearly as good:
 * no US ZIP looks like `K1A 0B1`. Coordinates come last, because the strips go
 * quiet either side of the border, which is exactly where the question is
 * hardest.
 *
 * Returns undefined only when none of the four says anything.
 */
export function countryFromAddress(parts: AddressParts): Country | undefined {
  const tagged = parts.country?.trim().toUpperCase()
  if (tagged && tagged in COUNTRY_TAG_VALUES) return COUNTRY_TAG_VALUES[tagged]

  const code = regionCode(parts.state)
  if (code) return REGION_COUNTRIES[code]

  const postcode = parts.postcode?.trim()
  if (postcode) {
    if (CA_POSTCODE.test(postcode)) return "CA"
    if (US_ZIPCODE.test(postcode)) return "US"
  }

  if (parts.lat !== undefined && parts.lng !== undefined) {
    return countryForPoint(parts.lat, parts.lng)
  }
  return undefined
}

/**
 * The timezone to schedule a business's mail in.
 *
 * Falls back to longitude bands when there is no state or province to read,
 * which is most of the time — OSM's `addr:state` coverage is thin. The bands
 * are the standard meridians for North America, and are accurate to the hour
 * everywhere in either country that has people in it.
 */
export function timezoneForPoint(
  lat: number,
  lng: number,
  country?: Country,
  state?: string | null
): string {
  const code = regionCode(state)
  if (code) return REGION_TIMEZONES[code]

  const resolved = country ?? countryForPoint(lat, lng) ?? "US"

  if (resolved === "CA") {
    if (lng >= -59.5 && lat >= 46.0) return "America/St_Johns"
    if (lng >= -68.0) return "America/Halifax"
    if (lng >= -90.0) return "America/Toronto"
    if (lng >= -102.0) return "America/Winnipeg"
    // Saskatchewan, which sits on Central time all year round.
    if (lng >= -110.0 && lat < 60.0) return "America/Regina"
    if (lat >= 60.0 && lng <= -123.8) return "America/Whitehorse"
    if (lng >= -120.0) return "America/Edmonton"
    return "America/Vancouver"
  }

  // Hawaii and Alaska sit far west of the mainland bands.
  if (lat < 23.5 && lng <= -154.0) return "Pacific/Honolulu"
  if (lng <= -130.0 || lng > 0) return "America/Anchorage"
  if (lng <= -114.5) return "America/Los_Angeles"
  if (lng <= -102.0) return "America/Denver"
  if (lng <= -87.5) return "America/Chicago"
  return "America/New_York"
}

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

/**
 * Formats a North American number for a person about to dial it.
 *
 * The US and Canada share one numbering plan, so one formatter covers both.
 * Anything that is not ten digits (or eleven starting with a 1) is handed back
 * untouched — an extension, a vanity number, or something OSM simply has wrong
 * is still more useful on screen than a mangled version of itself.
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return ""
  const trimmed = raw.trim()
  const digits = trimmed.replace(/\D/g, "")
  const national =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (national.length !== 10) return trimmed
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
}
