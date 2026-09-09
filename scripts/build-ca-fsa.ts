/**
 * Regenerates `lib/ca-fsa-data.ts` from GeoNames' Canadian postal code dump.
 *
 * ### Why this table exists at all
 *
 * Nominatim cannot geocode a Canadian postal code. Not the full six
 * characters, not the three-character FSA, not through the structured
 * `postalcode=` parameter — every one of them comes back as an empty array.
 * This is not a query we were phrasing badly: Canada Post asserts copyright
 * over the postal code database, so OpenStreetMap does not carry it and no
 * amount of tuning the Nominatim call will change that. US ZIPs (and ZIP+4)
 * resolve fine, which is exactly why the gap went unnoticed.
 *
 * GeoNames publishes FSA-level centroids for Canada under CC BY 4.0, which is
 * the licence the attribution in `lib/ca-fsa-data.ts` satisfies. The whole
 * country is 1,652 forward sortation areas and about 80KB, so it ships with
 * the app rather than being fetched at search time. That is the reliable
 * choice as well as the local-first one: no third upstream to be down, no
 * latency on the search path, and it works with the network unplugged.
 *
 * ### Why FSA precision is enough
 *
 * An FSA is the first three characters — "M1E" of "M1E 4C2" — and covers
 * roughly a neighbourhood. The last three narrow that to a block or a single
 * large building, which would matter for posting a letter and does not matter
 * here: the coordinate it produces is the centre of a search whose smallest
 * allowed radius is a mile. Resolving "M1E 4C2" to the centre of M1E puts the
 * box within a few hundred metres of where a full-precision geocoder would.
 *
 * Usage:
 *   node --disable-warning=ExperimentalWarning scripts/build-ca-fsa.ts
 *   node --disable-warning=ExperimentalWarning scripts/build-ca-fsa.ts --from ./CA.txt
 *
 * The `--from` form takes an already-extracted CA.txt, for running this
 * without network access.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { inflateRawSync } from "node:zlib"

const GEONAMES_URL = "https://download.geonames.org/export/zip/CA.zip"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT_PATH = path.join(HERE, "..", "lib", "ca-fsa-data.ts")

// ---------------------------------------------------------------------------
// A minimal ZIP reader
// ---------------------------------------------------------------------------

/**
 * Extracts one file from a ZIP archive.
 *
 * Node ships `zlib` but no ZIP container reader, and this script is the only
 * thing in the repo that needs one — adding a dependency to the whole app to
 * run a generator a couple of times a year is the wrong trade. The central
 * directory is read rather than the local file headers because a local header
 * is allowed to leave the sizes as zero and defer them to a trailing data
 * descriptor; the central directory always carries the real values.
 */
function readZipEntry(zip: Buffer, wantedName: string): Buffer {
  const EOCD_SIG = 0x06054b50
  const CD_SIG = 0x02014b50

  // The end-of-central-directory record sits at the end, behind a comment of
  // up to 65535 bytes, so it has to be searched for backwards.
  let eocd = -1
  for (let i = zip.length - 22; i >= 0 && i >= zip.length - 22 - 0xffff; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error("not a ZIP archive: no end-of-central-directory")

  const entryCount = zip.readUInt16LE(eocd + 10)
  let offset = zip.readUInt32LE(eocd + 16)

  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(offset) !== CD_SIG) {
      throw new Error(`corrupt ZIP: central directory entry ${i} has no signature`)
    }
    const method = zip.readUInt16LE(offset + 10)
    const compSize = zip.readUInt32LE(offset + 20)
    const nameLen = zip.readUInt16LE(offset + 28)
    const extraLen = zip.readUInt16LE(offset + 30)
    const commentLen = zip.readUInt16LE(offset + 32)
    const localOffset = zip.readUInt32LE(offset + 42)
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLen)

    if (name === wantedName) {
      // The local header repeats the name and extra fields, and its own
      // lengths are the ones that say where the data starts.
      const localNameLen = zip.readUInt16LE(localOffset + 26)
      const localExtraLen = zip.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localNameLen + localExtraLen
      const data = zip.subarray(start, start + compSize)
      if (method === 0) return Buffer.from(data)
      if (method === 8) return inflateRawSync(data)
      throw new Error(`${name}: unsupported compression method ${method}`)
    }

    offset += 46 + nameLen + extraLen + commentLen
  }

  throw new Error(`${wantedName} is not in the archive`)
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface Fsa {
  fsa: string
  lat: number
  lng: number
  place: string
  province: string
}

/**
 * Reads GeoNames' tab-separated postal dump into one row per FSA.
 *
 * Two things in the real file need handling rather than trusting. A couple of
 * rows carry a full six-character code where every other row carries three,
 * so the FSA is sliced out rather than assumed. And several FSAs appear more
 * than once — L9X is listed four times, for Barrie and three smaller places
 * around it — so the first row wins, which is the order GeoNames already puts
 * the largest place in. The alternative, averaging the points, moves the
 * centre into a field between the towns.
 */
function parseGeoNames(text: string): Fsa[] {
  const out: Fsa[] = []
  const seen = new Set<string>()

  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    const cols = line.split("\t")
    if (cols.length < 12) continue
    if (cols[0] !== "CA") continue

    const fsa = cols[1].trim().slice(0, 3).toUpperCase()
    if (!/^[A-Z]\d[A-Z]$/.test(fsa)) continue
    if (seen.has(fsa)) continue

    const lat = Number(cols[9])
    const lng = Number(cols[10])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    seen.add(fsa)
    out.push({
      fsa,
      lat,
      lng,
      place: cols[2].trim(),
      province: cols[4].trim().toUpperCase(),
    })
  }

  out.sort((a, b) => a.fsa.localeCompare(b.fsa))
  return out
}

// ---------------------------------------------------------------------------
// Emitting
// ---------------------------------------------------------------------------

/**
 * The table is emitted as one tab-separated line per FSA inside a template
 * literal, parsed into a Map on first use, rather than as an object literal
 * with 1,652 keys. It is a third of the size, it diffs one line per FSA when
 * GeoNames revises the data, and the parse is a few milliseconds once per
 * process.
 */
function emit(rows: Fsa[]): string {
  const lines = rows
    .map((r) => {
      // Enough digits for the centre of a neighbourhood; more is noise given
      // the smallest search radius is a mile.
      const lat = r.lat.toFixed(4)
      const lng = r.lng.toFixed(4)
      // Tabs and newlines are the record separators, and a backtick or `${`
      // would end the template literal early. None appear in the current
      // data; this makes that a guarantee rather than an observation.
      const place = r.place.replace(/[\t\n`]/g, " ").replace(/\$\{/g, "$ {")
      return `${r.fsa}\t${lat}\t${lng}\t${r.province}\t${place}`
    })
    .join("\n")

  return `/**
 * Every Canadian forward sortation area, with the centre of each.
 *
 * GENERATED FILE — do not edit by hand. Regenerate with:
 *   node --disable-warning=ExperimentalWarning scripts/build-ca-fsa.ts
 *
 * Source: GeoNames postal code data (https://www.geonames.org/), used under
 * the Creative Commons Attribution 4.0 licence. That attribution is a licence
 * condition, so it stays in this file and is shown to the user in the Find
 * businesses dialog, alongside OpenStreetMap's.
 *
 * ${rows.length} FSAs. See \`scripts/build-ca-fsa.ts\` for why this ships with the
 * app instead of being looked up over the network, and \`lib/ca-postal.ts\` for
 * how a postal code is turned into a search centre.
 *
 * Columns, tab separated: FSA, latitude, longitude, province, place name.
 */

export const CA_FSA_ATTRIBUTION =
  "Canadian postal code locations from GeoNames (geonames.org), CC BY 4.0."

export const CA_FSA_COUNT = ${rows.length}

export const CA_FSA_TABLE = \`${lines}\`
`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const fromFlag = process.argv.indexOf("--from")
  let text: string

  if (fromFlag !== -1) {
    const src = process.argv[fromFlag + 1]
    if (!src) throw new Error("--from needs a path to an extracted CA.txt")
    console.log(`Reading ${src}`)
    text = fs.readFileSync(src, "utf8")
  } else {
    console.log(`Downloading ${GEONAMES_URL}`)
    const res = await fetch(GEONAMES_URL, {
      headers: { "User-Agent": "vending-outreach/0.0.1 (build script)" },
    })
    if (!res.ok) {
      throw new Error(`GeoNames returned HTTP ${res.status}`)
    }
    const zip = Buffer.from(await res.arrayBuffer())
    console.log(`  ${zip.length} bytes`)
    text = readZipEntry(zip, "CA.txt").toString("utf8")
  }

  const rows = parseGeoNames(text)
  if (rows.length < 1500) {
    // The real file has had ~1,650 rows for years. A sharp drop means the
    // format changed or the download was truncated, and quietly shipping a
    // half-empty table would turn into "some postal codes do not work".
    throw new Error(
      `only ${rows.length} FSAs parsed, expected ~1650. Refusing to write a ` +
        "table that would silently fail for most of Canada."
    )
  }

  fs.writeFileSync(OUT_PATH, emit(rows), "utf8")
  console.log(`Wrote ${rows.length} FSAs to ${path.relative(process.cwd(), OUT_PATH)}`)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
