/**
 * Tests for the country tables.
 *
 * The bounding strips are the part worth testing hardest. They exist to keep
 * a Canadian business out of a US search and vice versa, and the only way to
 * know they do is to check them against real coordinates on both sides of the
 * border — including the places where the two countries interleave and the
 * strips are documented as giving up.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  CA_BOUNDS,
  clampToCountries,
  countryForPoint,
  countryFromAddress,
  describeCountries,
  formatPhone,
  isWithinCountries,
  timezoneForPoint,
  US_BOUNDS,
  type BBox,
} from "./geo.ts"

/** A tiny box around a point, the shape a "search here" query produces. */
function pointBox(lat: number, lng: number): BBox {
  return { south: lat, north: lat, west: lng, east: lng }
}

// ---------------------------------------------------------------------------
// The strips
// ---------------------------------------------------------------------------

const CANADIAN_CITIES: [string, number, number][] = [
  ["Vancouver BC", 49.2827, -123.1207],
  ["Victoria BC", 48.4284, -123.3656],
  ["Calgary AB", 51.0447, -114.0719],
  ["Edmonton AB", 53.5461, -113.4938],
  ["Saskatoon SK", 52.1332, -106.667],
  ["Regina SK", 50.4452, -104.6189],
  ["Winnipeg MB", 49.8951, -97.1384],
  ["Thunder Bay ON", 48.3809, -89.2477],
  ["London ON", 42.9849, -81.2453],
  ["Hamilton ON", 43.2557, -79.8711],
  ["St. Catharines ON", 43.1594, -79.2469],
  ["Toronto ON", 43.6532, -79.3832],
  ["Oshawa ON", 43.8971, -78.8658],
  ["Kingston ON", 44.2312, -76.486],
  ["Ottawa ON", 45.4215, -75.6972],
  ["Montreal QC", 45.5019, -73.5674],
  ["Sherbrooke QC", 45.4042, -71.8929],
  ["Quebec City QC", 46.8139, -71.208],
  ["Saint John NB", 45.2733, -66.0633],
  ["Moncton NB", 46.0878, -64.7782],
  ["Halifax NS", 44.6488, -63.5752],
  ["Charlottetown PE", 46.2382, -63.1311],
  ["St. John's NL", 47.5615, -52.7126],
  ["Whitehorse YT", 60.7212, -135.0568],
  ["Yellowknife NT", 62.454, -114.3718],
]

const US_CITIES: [string, number, number][] = [
  ["Seattle WA", 47.6062, -122.3321],
  ["Blaine WA", 48.9937, -122.7466],
  ["Portland OR", 45.5152, -122.6784],
  ["Minneapolis MN", 44.9778, -93.265],
  ["International Falls MN", 48.6023, -93.4108],
  ["Buffalo NY", 42.8864, -78.8784],
  ["Rochester NY", 43.1566, -77.6088],
  ["Cleveland OH", 41.4993, -81.6944],
  ["Erie PA", 42.1292, -80.0851],
  ["Dunkirk NY", 42.4795, -79.3339],
  ["Jamestown NY", 42.097, -79.2353],
  ["Olcott NY", 43.3384, -78.7178],
  ["Port Huron MI", 42.9709, -82.425],
  ["Baudette MN", 48.7125, -94.5999],
  ["Massena NY", 44.9284, -74.8918],
  ["Burlington VT", 44.4759, -73.2121],
  ["Bangor ME", 44.8016, -68.7712],
  ["Calais ME", 45.1856, -67.2792],
  ["Anchorage AK", 61.2181, -149.9003],
  ["Honolulu HI", 21.3069, -157.8583],
  ["Miami FL", 25.7617, -80.1918],
]

test("every Canadian city of consequence sits inside a Canadian strip", () => {
  for (const [name, lat, lng] of CANADIAN_CITIES) {
    assert.ok(
      isWithinCountries(pointBox(lat, lng), ["CA"]),
      `${name} should be inside Canada`
    )
  }
})

test("no Canadian strip reaches a US city", () => {
  for (const [name, lat, lng] of US_CITIES) {
    assert.ok(
      !CA_BOUNDS.some(
        (r) =>
          lat >= r.south && lat <= r.north && lng >= r.west && lng <= r.east
      ),
      `${name} is American and must not be inside a Canadian strip`
    )
  }
})

test("no US strip reaches a Canadian city", () => {
  for (const [name, lat, lng] of CANADIAN_CITIES) {
    assert.ok(
      !US_BOUNDS.some(
        (r) =>
          lat >= r.south && lat <= r.north && lng >= r.west && lng <= r.east
      ),
      `${name} is Canadian and must not be inside a US strip`
    )
  }
})

test("the documented border gaps really are gaps, not silent leaks", () => {
  // Each of these is a Canadian city no rectangle can hold without also
  // holding the American city across the river. The rule is that we drop the
  // Canadian one, so `countryForPoint` should say "I don't know" rather than
  // confidently returning US — which would email them under the wrong law.
  const gaps: [string, number, number][] = [
    ["Windsor ON", 42.3149, -83.0364],
    ["Sault Ste. Marie ON", 46.5136, -84.3358],
    ["Fort Frances ON", 48.6103, -93.4008],
    ["Niagara Falls ON", 43.0896, -79.0849],
    ["Sarnia ON", 42.9745, -82.4066],
    ["Edmundston NB", 47.3737, -68.3251],
  ]
  for (const [name, lat, lng] of gaps) {
    assert.notEqual(
      countryForPoint(lat, lng),
      "US",
      `${name} is in Canada; the strips must not claim it for the US`
    )
  }
})

test("countryForPoint places the clear cases on both sides", () => {
  assert.equal(countryForPoint(43.6532, -79.3832), "CA") // Toronto
  assert.equal(countryForPoint(39.9612, -82.9988), "US") // Columbus
  assert.equal(countryForPoint(51.5072, -0.1276), undefined) // London, England
})

test("clampToCountries keeps a cross-border box inside what was asked for", () => {
  // Buffalo across to Fort Erie: a box that genuinely spans the border.
  const box: BBox = { south: 42.7, north: 43.1, west: -79.2, east: -78.7 }

  const us = clampToCountries(box, ["US"])
  assert.ok(isWithinCountries(us, ["US"]))
  assert.ok(us.north <= box.north, "clamping may only shrink the box")

  // Both countries selected still cannot produce a box straddling the gap
  // between the two tables, because the gap belongs to neither.
  const both = clampToCountries(box, ["US", "CA"])
  assert.ok(isWithinCountries(both, ["US", "CA"]))
})

test("clampToCountries refuses a box with nothing to keep", () => {
  const london: BBox = { south: 51.3, north: 51.7, west: -0.5, east: 0.3 }
  assert.throws(
    () => clampToCountries(london, ["US", "CA"]),
    /does not overlap/
  )
})

// ---------------------------------------------------------------------------
// Reading a country off an address
// ---------------------------------------------------------------------------

test("an explicit addr:country wins over everything else", () => {
  assert.equal(countryFromAddress({ country: "CA" }), "CA")
  assert.equal(countryFromAddress({ country: "United States" }), "US")
  // Even when the coordinates disagree, which is the point of it winning.
  assert.equal(
    countryFromAddress({ country: "CA", lat: 39.96, lng: -82.99 }),
    "CA"
  )
})

test("a province or state code is conclusive on its own", () => {
  assert.equal(countryFromAddress({ state: "ON" }), "CA")
  assert.equal(countryFromAddress({ state: "SK" }), "CA")
  assert.equal(countryFromAddress({ state: "OH" }), "US")
  assert.equal(countryFromAddress({ state: "Ontario" }), "CA")
  // Accents are normalised, so both spellings of Quebec resolve.
  assert.equal(countryFromAddress({ state: "Québec" }), "CA")
  assert.equal(countryFromAddress({ state: "Quebec" }), "CA")
})

test("a postal code shape separates the two when nothing else does", () => {
  assert.equal(countryFromAddress({ postcode: "K1A 0B1" }), "CA")
  assert.equal(countryFromAddress({ postcode: "k1a0b1" }), "CA")
  assert.equal(countryFromAddress({ postcode: "43215" }), "US")
  assert.equal(countryFromAddress({ postcode: "43215-1234" }), "US")
})

test("countryFromAddress says nothing rather than guessing", () => {
  assert.equal(countryFromAddress({}), undefined)
  assert.equal(
    countryFromAddress({ state: "XX", postcode: "not a code" }),
    undefined
  )
})

// ---------------------------------------------------------------------------
// Timezones
// ---------------------------------------------------------------------------

test("a province or state picks the zone, including the two without DST", () => {
  assert.equal(timezoneForPoint(0, 0, undefined, "AZ"), "America/Phoenix")
  assert.equal(timezoneForPoint(0, 0, undefined, "SK"), "America/Regina")
  assert.equal(timezoneForPoint(0, 0, undefined, "ON"), "America/Toronto")
  assert.equal(timezoneForPoint(0, 0, undefined, "NL"), "America/St_Johns")
})

test("longitude covers the businesses with no state tag, which is most of them", () => {
  const cases: [string, number, number, string][] = [
    ["Vancouver", 49.2827, -123.1207, "America/Vancouver"],
    ["Calgary", 51.0447, -114.0719, "America/Edmonton"],
    ["Winnipeg", 49.8951, -97.1384, "America/Winnipeg"],
    ["Toronto", 43.6532, -79.3832, "America/Toronto"],
    ["Halifax", 44.6488, -63.5752, "America/Halifax"],
    ["St. John's", 47.5615, -52.7126, "America/St_Johns"],
    ["Los Angeles", 34.0522, -118.2437, "America/Los_Angeles"],
    ["Denver", 39.7392, -104.9903, "America/Denver"],
    ["Chicago", 41.8781, -87.6298, "America/Chicago"],
    ["New York", 40.7128, -74.006, "America/New_York"],
    ["Anchorage", 61.2181, -149.9003, "America/Anchorage"],
    ["Honolulu", 21.3069, -157.8583, "Pacific/Honolulu"],
  ]
  for (const [name, lat, lng, expected] of cases) {
    assert.equal(timezoneForPoint(lat, lng), expected, name)
  }
})

test("every timezone the tables produce is one Intl actually knows", () => {
  // A typo here would not throw until a send was attempted, at which point
  // the failure looks like a scheduling bug rather than a bad string.
  for (const [, lat, lng] of [...CANADIAN_CITIES, ...US_CITIES]) {
    const zone = timezoneForPoint(lat, lng)
    assert.doesNotThrow(
      () => new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0),
      `${zone} is not a timezone Intl recognises`
    )
  }
})

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

test("formatPhone handles both countries, which share a numbering plan", () => {
  assert.equal(formatPhone("+1 614-555-0100"), "(614) 555-0100")
  assert.equal(formatPhone("6135550142"), "(613) 555-0142")
  assert.equal(formatPhone("1 (416) 555 0199"), "(416) 555-0199")
})

test("formatPhone hands back anything it cannot parse, untouched", () => {
  assert.equal(formatPhone("+44 20 7946 0958"), "+44 20 7946 0958")
  assert.equal(formatPhone("614-555-0100 ext. 12"), "614-555-0100 ext. 12")
  assert.equal(formatPhone("call the shop"), "call the shop")
  assert.equal(formatPhone(null), "")
  assert.equal(formatPhone(""), "")
})

// ---------------------------------------------------------------------------
// describeCountries
// ---------------------------------------------------------------------------

test("countries are named with their own article, not the sentence's", () => {
  // The search error used to be built as `the ${COUNTRY_LABELS[c]}`, which
  // read "did not match anywhere in the Canada" to every Canadian user.
  assert.equal(describeCountries(["CA"]), "Canada")
  assert.equal(describeCountries(["US"]), "the United States")
  assert.equal(describeCountries(["US", "CA"]), "the United States or Canada")
  assert.equal(describeCountries(["CA", "US"]), "Canada or the United States")

  for (const selection of [["CA"], ["US"], ["US", "CA"]] as const) {
    assert.doesNotMatch(
      `nowhere in ${describeCountries(selection)}.`,
      /the Canada/,
      "an article was doubled up"
    )
  }
})
