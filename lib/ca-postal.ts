/**
 * Turning a Canadian postal code into a place to search.
 *
 * Nominatim cannot do this. Not "does it badly" — it returns an empty array
 * for the full six characters, for the bare three-character FSA, and for the
 * structured `postalcode=` parameter alike, because Canada Post asserts
 * copyright over the postal code database and so OpenStreetMap does not carry
 * it. US ZIPs resolve through Nominatim perfectly well, which is how a
 * Canadian user could sit in front of the search box typing their own postal
 * code and be told it "did not match anywhere in Canada".
 *
 * So Canada is answered from a table that ships with the app —
 * `lib/ca-fsa-data.ts`, generated from GeoNames by `scripts/build-ca-fsa.ts`.
 * It covers every FSA in the country, needs no network, and cannot be down.
 *
 * ### Precision
 *
 * A postal code's first three characters (the forward sortation area, "M1E"
 * of "M1E 4C2") describe roughly a neighbourhood; the last three narrow it to
 * a block or one large building. Only the FSA is used, and that is not a
 * compromise worth apologising for: the coordinate becomes the centre of a
 * search whose smallest radius is a mile, so the last three characters would
 * move the box by less than its own rounding.
 */

import { CA_FSA_TABLE } from "./ca-fsa-data.ts"

/**
 * Canada Post never issues D, F, I, O, Q or U in any position — they are too
 * easily misread as O, E, 1, 0, O and V — and additionally never W or Z as
 * the first letter. Matching the real alphabet rather than `[A-Z]` is what
 * keeps `findPostalCodeIn` from claiming three characters out of the middle
 * of an ordinary place name.
 */
const FIRST = "ABCEGHJKLMNPRSTVXY"
const REST = "ABCEGHJKLMNPRSTVWXYZ"

/** The three-character forward sortation area, on its own. */
const FSA_RE = new RegExp(`^[${FIRST}]\\d[${REST}]$`)

/** A whole postal code: the FSA, then optionally the local delivery unit. */
const WHOLE_RE = new RegExp(
  `^[${FIRST}]\\d[${REST}](?:[\\s-]*\\d[${REST}]\\d)?$`,
  "i"
)

/** The same, found anywhere inside a longer string, on word boundaries. */
const EMBEDDED_RE = new RegExp(
  `(?:^|[\\s,])([${FIRST}]\\d[${REST}])[\\s-]*(\\d[${REST}]\\d)(?:$|[\\s,.])`,
  "i"
)

export interface FsaLocation {
  fsa: string
  lat: number
  lng: number
  /** Two-letter province code, e.g. "ON". */
  province: string
  /** GeoNames' name for the area, e.g. "Scarborough (Guildwood / …)". */
  place: string
}

let table: Map<string, FsaLocation> | undefined

/**
 * Parsed on first use rather than at import. The table is 1,652 rows behind a
 * module that Next pulls into the server bundle for any page importing the
 * geocoder, and a US-only user never touches it.
 */
function getTable(): Map<string, FsaLocation> {
  if (table) return table
  const built = new Map<string, FsaLocation>()
  for (const line of CA_FSA_TABLE.split("\n")) {
    if (!line) continue
    const [fsa, lat, lng, province, place] = line.split("\t")
    if (!fsa || !lat || !lng) continue
    built.set(fsa, {
      fsa,
      lat: Number(lat),
      lng: Number(lng),
      province: province ?? "",
      place: place ?? "",
    })
  }
  table = built
  return built
}

/** How many FSAs the bundled table knows. Exported for the tests. */
export function fsaTableSize(): number {
  return getTable().size
}

/**
 * The FSA of a string that is *entirely* a postal code, or undefined.
 *
 * Accepts "M1E 4C2", "m1e4c2", "M1E-4C2" and the bare "M1E", because all four
 * get typed and none of them is ambiguous. Anything with other words in it is
 * not handled here — see `findPostalCodeIn`.
 */
export function parsePostalCode(input: string): string | undefined {
  const cleaned = input.trim()
  if (!WHOLE_RE.test(cleaned)) return undefined
  const fsa = cleaned.slice(0, 3).toUpperCase()
  return FSA_RE.test(fsa) ? fsa : undefined
}

/**
 * The FSA of a postal code embedded in a longer string, or undefined.
 *
 * For "Toronto, ON M1E 4C2" and "M1E 4C2, Canada", which people paste in from
 * an address. Deliberately requires the full six characters here: three
 * characters loose in a sentence is a coincidence waiting to happen, six is
 * not.
 */
export function findPostalCodeIn(input: string): string | undefined {
  const match = EMBEDDED_RE.exec(input.trim())
  if (!match) return undefined
  const fsa = match[1].toUpperCase()
  return FSA_RE.test(fsa) ? fsa : undefined
}

/** Where an FSA is, or undefined if it is not a real one. */
export function lookupFsa(fsa: string): FsaLocation | undefined {
  return getTable().get(fsa.trim().toUpperCase())
}

/**
 * Resolves a string that is entirely a Canadian postal code.
 *
 * Returns undefined both for "this is not a postal code" and for "this is
 * shaped like one but no such FSA exists", because the caller does the same
 * thing either way: hand it to Nominatim and let that fail properly.
 */
export function locateCanadianPostalCode(
  input: string
): FsaLocation | undefined {
  const fsa = parsePostalCode(input)
  return fsa ? lookupFsa(fsa) : undefined
}

/** `locateCanadianPostalCode`, but for a code inside a longer string. */
export function locateEmbeddedPostalCode(
  input: string
): FsaLocation | undefined {
  const fsa = findPostalCodeIn(input)
  return fsa ? lookupFsa(fsa) : undefined
}

/**
 * How the resolved place is named back to the user, e.g.
 * "Scarborough (Guildwood / Morningside / Ellesmere), ON — postal code M1E".
 *
 * It names the FSA rather than echoing what was typed so that the difference
 * between "we found your exact address" and "we found your neighbourhood" is
 * visible on screen instead of implied.
 */
export function describeFsa(location: FsaLocation): string {
  const where = [location.place, location.province].filter(Boolean).join(", ")
  return where
    ? `${where} — postal code ${location.fsa}`
    : `postal code ${location.fsa}`
}
