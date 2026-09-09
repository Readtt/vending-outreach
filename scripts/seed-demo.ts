/**
 * Fills the database with a fortnight of plausible history, so every screen
 * can be looked at with something on it.
 *
 * This exists because most of this app's screens only mean anything once
 * there is history behind them — the Calls list needs a lead emailed a day or
 * two ago and still silent, the Inbox needs a reply that triage escalated,
 * the dashboard chart needs two weeks of sends. Getting there for real takes
 * two weeks and a live mailbox, which is a bad loop to design a screen in.
 *
 * Two things it will not do:
 *
 *  - It refuses to run against a database that already has leads in it,
 *    unless `--force` says otherwise. Nobody should lose real outreach to a
 *    mistyped command.
 *  - Every message it writes is marked `dry_run = 1`, and no mailbox or
 *    provider is created. Nothing here can be mistaken for a real send, and
 *    nothing here makes the app capable of one.
 *
 * Usage:
 *   pnpm seed:demo            # into data/app.db, refusing to clobber
 *   pnpm seed:demo --force    # wipe what is there first
 */

import { randomUUID } from "node:crypto"

import {
  closeDb,
  countLeads,
  enqueue,
  getDb,
  insertLead,
  logEvent,
  updateLead,
  type LeadStatus,
} from "../lib/db.ts"
import { timezoneForPoint, type Country } from "../lib/geo.ts"
import { resolveDbPath } from "../lib/db.ts"

const HOUR = 3600_000
const DAY = 24 * HOUR
const now = Date.now()

// ---------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------

interface Seed {
  name: string
  type: string
  city: string
  region: string
  postcode: string
  country: Country
  lat: number
  lng: number
  phone: string | null
  website: string | null
  email: string | null
  status: LeadStatus
  score: number
  fact: string | null
  factCategory: string | null
  /** How the lead got where it is. Drives the messages and events written. */
  arc:
    | "new"
    | "researching"
    | "ready"
    | "held"
    | "contacted"
    | "awaiting_call"
    | "replied_interested"
    | "replied_question"
    | "won"
    | "refused"
    | "has_vendor"
    | "bounced"
    | "no_website"
    | "no_email"
    | "low_score"
}

/**
 * Deliberately lopsided. Roughly half of what a real OSM import produces is
 * unqualified — no website, no address on the site, nothing worth saying —
 * and a screen that only ever shows the happy path teaches the wrong thing
 * about what to expect.
 */
const SEEDS: Seed[] = [
  // --- United States --------------------------------------------------------
  {
    name: "Iron Anvil Strength Co.",
    type: "gym",
    city: "Columbus",
    region: "OH",
    postcode: "43201",
    country: "US",
    lat: 39.9925,
    lng: -83.0044,
    phone: "+1 614-555-0142",
    website: "https://ironanvilstrength.example",
    email: "front.desk@ironanvilstrength.example",
    status: "replied",
    score: 12,
    fact: "open 24 hours a day, seven days a week",
    factCategory: "hours",
    arc: "replied_question",
  },
  {
    name: "Scioto Auto Works",
    type: "car_repair",
    city: "Grandview Heights",
    region: "OH",
    postcode: "43212",
    country: "US",
    lat: 39.9795,
    lng: -83.0413,
    phone: "+1 614-555-0118",
    website: "https://sciotoautoworks.example",
    email: "service@sciotoautoworks.example",
    status: "hot",
    score: 11,
    fact: "a waiting room with free coffee and wifi for customers",
    factCategory: "amenity",
    arc: "replied_interested",
  },
  {
    name: "Buckeye Self Storage",
    type: "storage",
    city: "Columbus",
    region: "OH",
    postcode: "43214",
    country: "US",
    lat: 40.0512,
    lng: -83.0189,
    phone: "+1 614-555-0170",
    website: "https://buckeyeselfstorage.example",
    email: "office@buckeyeselfstorage.example",
    status: "contacted",
    score: 9,
    fact: "climate-controlled units and gate access from 6am to 10pm",
    factCategory: "hours",
    arc: "awaiting_call",
  },
  {
    name: "Olentangy Family Dental",
    type: "clinic",
    city: "Worthington",
    region: "OH",
    postcode: "43085",
    country: "US",
    lat: 40.0931,
    lng: -83.0179,
    phone: "+1 614-555-0155",
    website: "https://olentangyfamilydental.example",
    email: "hello@olentangyfamilydental.example",
    status: "contacted",
    score: 10,
    fact: "seeing patients in Worthington since 1994",
    factCategory: "years_in_business",
    arc: "awaiting_call",
  },
  {
    name: "Great Lakes Freight Terminal",
    type: "warehouse",
    city: "Cleveland",
    region: "OH",
    postcode: "44115",
    country: "US",
    lat: 41.4901,
    lng: -81.6689,
    phone: "+1 216-555-0133",
    website: "https://greatlakesfreight.example",
    email: "ops@greatlakesfreight.example",
    status: "won",
    score: 13,
    fact: "a 40-person shift working around the clock",
    factCategory: "staff",
    arc: "won",
  },
  {
    name: "Riverside Suites Hotel",
    type: "hotel",
    city: "Cincinnati",
    region: "OH",
    postcode: "45202",
    country: "US",
    lat: 39.1031,
    lng: -84.512,
    phone: "+1 513-555-0164",
    website: "https://riversidesuites.example",
    email: "frontdesk@riversidesuites.example",
    status: "contacted",
    score: 10,
    fact: "128 rooms and a lobby staffed overnight",
    factCategory: "capacity",
    arc: "contacted",
  },
  {
    name: "Spin Cycle Laundromat",
    type: "laundry",
    city: "Dayton",
    region: "OH",
    postcode: "45402",
    country: "US",
    lat: 39.7589,
    lng: -84.1916,
    phone: "+1 937-555-0129",
    website: "https://spincyclelaundry.example",
    email: "info@spincyclelaundry.example",
    status: "ready",
    score: 8,
    fact: "open from 6am until midnight every day",
    factCategory: "hours",
    arc: "ready",
  },
  {
    name: "Tri-State Trade Institute",
    type: "trade_school",
    city: "Toledo",
    region: "OH",
    postcode: "43604",
    country: "US",
    lat: 41.6528,
    lng: -83.5379,
    phone: "+1 419-555-0187",
    website: "https://tristatetrade.example",
    email: "admissions@tristatetrade.example",
    status: "ready",
    score: 11,
    fact: "welding and HVAC programs running day and evening",
    factCategory: "services",
    arc: "ready",
  },
  {
    name: "Maple Ridge Apartments",
    type: "apartments",
    city: "Akron",
    region: "OH",
    postcode: "44311",
    country: "US",
    lat: 41.0648,
    lng: -81.5197,
    phone: "+1 330-555-0176",
    website: "https://mapleridgeliving.example",
    email: "leasing@mapleridgeliving.example",
    status: "held",
    score: 8,
    fact: "220 units with a shared laundry room on every floor",
    factCategory: "capacity",
    arc: "held",
  },
  {
    name: "Northside Motors",
    type: "car_dealer",
    city: "Indianapolis",
    region: "IN",
    postcode: "46202",
    country: "US",
    lat: 39.7869,
    lng: -86.1585,
    phone: "+1 317-555-0192",
    website: "https://northsidemotors.example",
    email: "sales@northsidemotors.example",
    status: "dead",
    score: 7,
    fact: "a service bay open Saturdays until 4pm",
    factCategory: "hours",
    arc: "refused",
  },
  {
    name: "Prairie Wind Fitness",
    type: "gym",
    city: "Des Moines",
    region: "IA",
    postcode: "50309",
    country: "US",
    lat: 41.5868,
    lng: -93.625,
    phone: "+1 515-555-0148",
    website: "https://prairiewindfitness.example",
    email: "team@prairiewindfitness.example",
    status: "suppressed",
    score: 7,
    fact: "a members-only lounge upstairs",
    factCategory: "amenity",
    arc: "has_vendor",
  },
  {
    name: "Cascade Auto Body",
    type: "car_repair",
    city: "Portland",
    region: "OR",
    postcode: "97209",
    country: "US",
    lat: 45.5289,
    lng: -122.6836,
    phone: "+1 503-555-0111",
    website: "https://cascadeautobody.example",
    email: "shop@cascadeautobody.example",
    status: "dead",
    score: 8,
    fact: "a courtesy shuttle within five miles of the shop",
    factCategory: "services",
    arc: "bounced",
  },
  {
    name: "Sunset Coin Laundry",
    type: "laundry",
    city: "Phoenix",
    region: "AZ",
    postcode: "85004",
    country: "US",
    lat: 33.4484,
    lng: -112.074,
    phone: "+1 602-555-0139",
    website: null,
    email: null,
    status: "unqualified",
    score: 0,
    fact: null,
    factCategory: null,
    arc: "no_website",
  },
  {
    name: "Lakeshore Physio",
    type: "clinic",
    city: "Chicago",
    region: "IL",
    postcode: "60611",
    country: "US",
    lat: 41.8955,
    lng: -87.6244,
    phone: "+1 312-555-0157",
    website: "https://lakeshorephysio.example",
    email: null,
    status: "unqualified",
    score: 0,
    fact: null,
    factCategory: null,
    arc: "no_email",
  },
  {
    name: "Depot Street Offices",
    type: "office",
    city: "Nashville",
    region: "TN",
    postcode: "37203",
    country: "US",
    lat: 36.1533,
    lng: -86.7911,
    phone: null,
    website: "https://depotstreetoffices.example",
    email: "contact@depotstreetoffices.example",
    status: "unqualified",
    score: 3,
    fact: null,
    factCategory: null,
    arc: "low_score",
  },
  {
    name: "Copper Kettle Brewing",
    type: "warehouse",
    city: "Denver",
    region: "CO",
    postcode: "80205",
    country: "US",
    lat: 39.7599,
    lng: -104.9781,
    phone: "+1 303-555-0166",
    website: "https://copperkettlebrewing.example",
    email: null,
    status: "enriching",
    score: 0,
    fact: null,
    factCategory: null,
    arc: "researching",
  },
  {
    name: "Harborview Dental Group",
    type: "clinic",
    city: "Seattle",
    region: "WA",
    postcode: "98101",
    country: "US",
    lat: 47.6101,
    lng: -122.3344,
    phone: "+1 206-555-0173",
    website: "https://harborviewdental.example",
    email: null,
    status: "new",
    score: 0,
    fact: null,
    factCategory: null,
    arc: "new",
  },
  // --- Canada ---------------------------------------------------------------
  {
    name: "Queen Street Fitness",
    type: "gym",
    city: "Toronto",
    region: "ON",
    postcode: "M5V 2A8",
    country: "CA",
    lat: 43.6465,
    lng: -79.3961,
    phone: "+1 416-555-0121",
    website: "https://queenstreetfitness.example",
    email: "hello@queenstreetfitness.example",
    status: "hot",
    score: 12,
    fact: "a 5am opening for shift workers",
    factCategory: "hours",
    arc: "replied_interested",
  },
  {
    name: "Rideau Auto Service",
    type: "car_repair",
    city: "Ottawa",
    region: "ON",
    postcode: "K1N 5X5",
    country: "CA",
    lat: 45.4275,
    lng: -75.6919,
    phone: "+1 613-555-0184",
    website: "https://rideauauto.example",
    email: "service@rideauauto.example",
    status: "contacted",
    score: 10,
    fact: "family-run on Rideau Street for three generations",
    factCategory: "years_in_business",
    arc: "awaiting_call",
  },
  {
    name: "Pacific Coast Storage",
    type: "storage",
    city: "Vancouver",
    region: "BC",
    postcode: "V6A 1M9",
    country: "CA",
    lat: 49.2795,
    lng: -123.0964,
    phone: "+1 604-555-0158",
    website: "https://pacificcoaststorage.example",
    email: "info@pacificcoaststorage.example",
    status: "contacted",
    score: 9,
    fact: "drive-up units and 24-hour gate access",
    factCategory: "hours",
    arc: "awaiting_call",
  },
  {
    name: "Bow River Logistics",
    type: "warehouse",
    city: "Calgary",
    region: "AB",
    postcode: "T2G 0P6",
    country: "CA",
    lat: 51.0392,
    lng: -114.0537,
    phone: "+1 403-555-0195",
    website: "https://bowriverlogistics.example",
    email: "dispatch@bowriverlogistics.example",
    status: "ready",
    score: 12,
    fact: "a dispatch desk staffed on two shifts",
    factCategory: "staff",
    arc: "ready",
  },
  {
    name: "Sainte-Catherine Clinique",
    type: "clinic",
    city: "Montreal",
    region: "QC",
    postcode: "H3B 1A7",
    country: "CA",
    lat: 45.5031,
    lng: -73.5698,
    phone: "+1 514-555-0126",
    website: "https://cliniquestecatherine.example",
    email: "accueil@cliniquestecatherine.example",
    status: "held",
    score: 9,
    fact: "walk-in hours on Saturday mornings",
    factCategory: "hours",
    arc: "held",
  },
  {
    name: "Portage Avenue Laundromat",
    type: "laundry",
    city: "Winnipeg",
    region: "MB",
    postcode: "R3B 2B9",
    country: "CA",
    lat: 49.8894,
    lng: -97.1471,
    phone: "+1 204-555-0102",
    website: "https://portagelaundry.example",
    email: null,
    status: "unqualified",
    score: 0,
    fact: null,
    factCategory: null,
    // CASL's implied consent needs the business to have published the address
    // itself, so an OSM tag is not enough on the Canadian side.
    arc: "no_email",
  },
  {
    name: "Halifax Harbour Inn",
    type: "hotel",
    city: "Halifax",
    region: "NS",
    postcode: "B3J 1S9",
    country: "CA",
    lat: 44.6476,
    lng: -63.5728,
    phone: "+1 902-555-0147",
    website: "https://halifaxharbourinn.example",
    email: "stay@halifaxharbourinn.example",
    status: "new",
    score: 0,
    fact: null,
    factCategory: null,
    arc: "new",
  },
]

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const SENDER = {
  name: "Jordan Rivera",
  company: "Buckeye Vending Co.",
  phone: "(614) 555-0100",
  website: "https://buckeyevending.example",
  address: "1200 N High St, Suite 240, Columbus, OH 43201",
}

function firstEmail(seed: Seed): string {
  const casl =
    seed.country === "CA"
      ? `\n${SENDER.company} · ${SENDER.phone}\n${SENDER.address}`
      : `\n${SENDER.name}, ${SENDER.company}\n${SENDER.address}`
  return [
    `Hi — I noticed ${seed.name} is ${seed.fact ?? "busy most of the day"}.`,
    "",
    "I place vending machines with local businesses around here. No cost to you, no contract, and a share of what it sells comes back to you. I stock it and I fix it.",
    "",
    "Worth a two-minute look, or should I leave you to it? Just reply and I'll leave you alone either way.",
    "",
    `Thanks,`,
    SENDER.name + casl,
  ].join("\n")
}

function followUp(seed: Seed): string {
  return [
    `Following up on this one — no pressure either way.`,
    "",
    `If a machine at ${seed.name} isn't a fit, just say so and I'll stop.`,
    "",
    SENDER.name,
    SENDER.address,
  ].join("\n")
}

const REPLIES: Record<string, string> = {
  replied_question:
    "Thanks for reaching out. What sort of footprint does the machine need, and who restocks it? We're tight on floor space near the front desk but there might be room by the lockers.",
  replied_interested:
    "This could work for us. We've been meaning to sort something out for the waiting area. Can you call me this week? Mornings are best.",
  won: "Sounds good — let's do it. Come by Tuesday morning and we'll show you where it can go.",
  refused: "No thanks, not interested. Please take us off your list.",
  has_vendor:
    "We already have a vending supplier under contract. Please remove us.",
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const db = getDb()

function insertMessage(input: {
  leadId: string
  direction: "in" | "out"
  step: number | null
  subject: string
  body: string
  sentAt: number
  bounced?: boolean
}): void {
  db.prepare(
    `INSERT INTO messages (id, lead_id, mailbox_id, direction, sequence_step,
                           subject, body, outreach_id, message_id, status,
                           error, sent_at, created_at, dry_run)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, 1)`
  ).run(
    randomUUID(),
    input.leadId,
    input.direction,
    input.step,
    input.subject,
    input.body,
    input.direction === "out" ? randomUUID() : null,
    `<${randomUUID()}@seed.local>`,
    input.bounced ? JSON.stringify({ bounce: "hard" }) : null,
    input.sentAt,
    input.sentAt
  )
}

/** Events carry their own timestamps, which `logEvent` does not expose. */
function eventAt(
  at: number,
  type: string,
  leadId: string | null,
  detail?: unknown
): void {
  db.prepare(
    `INSERT INTO events (lead_id, type, detail_json, created_at) VALUES (?, ?, ?, ?)`
  ).run(leadId, type, detail !== undefined ? JSON.stringify(detail) : null, at)
}

function seedOne(seed: Seed): void {
  const address = `${seed.city}, ${seed.region} ${seed.postcode}`
  const lead = insertLead({
    name: seed.name,
    type: seed.type,
    address,
    phone: seed.phone,
    website: seed.website,
    lat: seed.lat,
    lng: seed.lng,
    timezone: timezoneForPoint(seed.lat, seed.lng, seed.country, seed.region),
    country: seed.country,
    source: "osm",
    osmId: `node/${Math.floor(Math.random() * 9_000_000) + 1_000_000}`,
  })

  const importedAt = now - 13 * DAY + Math.floor(Math.random() * DAY)
  db.prepare(`UPDATE leads SET created_at = ? WHERE id = ?`).run(
    importedAt,
    lead.id
  )

  updateLead(lead.id, {
    status: seed.status,
    score: seed.score,
    email: seed.email,
    personalization_fact: seed.fact,
    fact_category: seed.factCategory,
    research_json: JSON.stringify({
      osm: {
        osmId: lead.osm_id,
        name: seed.name,
        type: seed.type,
        country: seed.country,
        address,
        phone: seed.phone,
        website: seed.website,
        email: null,
        openingHours: "Mo-Su 06:00-22:00",
        lat: seed.lat,
        lng: seed.lng,
        importedAt,
      },
      chosenEmail: seed.email,
      outcome: seed.status,
    }),
  })

  eventAt(importedAt, "leads.imported", lead.id, {
    inserted: 1,
    skipped: 0,
    total: 1,
  })

  const subject = `Vending machine for ${seed.name}?`

  switch (seed.arc) {
    case "new":
      enqueue("enrich", { leadId: lead.id })
      break

    case "researching":
      enqueue("enrich", { leadId: lead.id })
      eventAt(importedAt + HOUR, "lead.enriched", lead.id, {
        status: "pending",
      })
      break

    case "no_website":
      eventAt(importedAt + HOUR, "lead.unqualified", lead.id, {
        reason: "no_website",
        detail: "the business has no website tag in OpenStreetMap",
      })
      break

    case "no_email":
      eventAt(importedAt + HOUR, "lead.unqualified", lead.id, {
        reason: "no_email",
        detail:
          seed.country === "CA"
            ? "no email address appeared anywhere on the site (a Canadian business has to have published it themselves)"
            : "no email address appeared on the site or in OSM",
      })
      break

    case "low_score":
      eventAt(importedAt + HOUR, "lead.unqualified", lead.id, {
        reason: "low_score",
        detail: "scored 21, below the threshold of 40",
      })
      break

    case "ready":
    case "held": {
      const at = importedAt + 2 * HOUR
      eventAt(at, "lead.enriched", lead.id, { score: seed.score })
      eventAt(at + 60_000, "compose.drafted", lead.id, { step: 1 })
      enqueue("send", { leadId: lead.id, runAfter: now + 30 * 60_000 })
      break
    }

    case "contacted":
    case "awaiting_call": {
      // The Calls list wants a lead emailed 18 to 96 hours ago that has not
      // replied, so `awaiting_call` sits squarely in that window.
      const sentAt =
        seed.arc === "awaiting_call" ? now - 30 * HOUR : now - 6 * DAY
      eventAt(sentAt - 2 * HOUR, "lead.enriched", lead.id, {
        score: seed.score,
      })
      eventAt(sentAt - HOUR, "compose.drafted", lead.id, { step: 1 })
      insertMessage({
        leadId: lead.id,
        direction: "out",
        step: 1,
        subject,
        body: firstEmail(seed),
        sentAt,
      })
      eventAt(sentAt, "send.step_sent", lead.id, { step: 1 })
      if (seed.arc === "contacted") {
        const followUpAt = sentAt + 4 * DAY
        insertMessage({
          leadId: lead.id,
          direction: "out",
          step: 4,
          subject: `Re: ${subject}`,
          body: followUp(seed),
          sentAt: followUpAt,
        })
        eventAt(followUpAt, "send.step_sent", lead.id, { step: 4 })
        enqueue("send", { leadId: lead.id, runAfter: now + 2 * DAY })
      } else {
        enqueue("send", { leadId: lead.id, runAfter: sentAt + 4 * DAY })
      }
      break
    }

    case "replied_question":
    case "replied_interested":
    case "won": {
      const sentAt = now - 4 * DAY
      const replyAt = now - 2 * DAY - 3 * HOUR
      eventAt(sentAt - HOUR, "compose.drafted", lead.id, { step: 1 })
      insertMessage({
        leadId: lead.id,
        direction: "out",
        step: 1,
        subject,
        body: firstEmail(seed),
        sentAt,
      })
      eventAt(sentAt, "send.step_sent", lead.id, { step: 1 })
      insertMessage({
        leadId: lead.id,
        direction: "in",
        step: null,
        subject: `Re: ${subject}`,
        body: REPLIES[seed.arc],
        sentAt: replyAt,
      })
      eventAt(replyAt, "inbound.escalate", lead.id, { reason: "human reply" })
      eventAt(replyAt + 30_000, "classify.escalated", lead.id, {
        intent: seed.arc === "won" ? "ready_to_talk" : "send_more_info",
      })
      break
    }

    case "refused":
    case "has_vendor": {
      const sentAt = now - 8 * DAY
      const replyAt = now - 7 * DAY
      insertMessage({
        leadId: lead.id,
        direction: "out",
        step: 1,
        subject,
        body: firstEmail(seed),
        sentAt,
      })
      eventAt(sentAt, "send.step_sent", lead.id, { step: 1 })
      insertMessage({
        leadId: lead.id,
        direction: "in",
        step: null,
        subject: `Re: ${subject}`,
        body: REPLIES[seed.arc],
        sentAt: replyAt,
      })
      eventAt(replyAt + 30_000, "classify.silenced", lead.id, {
        intent:
          seed.arc === "refused" ? "not_interested" : "already_have_vending",
      })
      if (seed.arc === "has_vendor" && seed.email) {
        db.prepare(
          `INSERT OR IGNORE INTO suppressed (email, reason, created_at) VALUES (?, ?, ?)`
        ).run(seed.email, "already_have_vending", replyAt)
        eventAt(replyAt + 60_000, "suppressed", lead.id, {
          reason: "asked to stop",
        })
      }
      break
    }

    case "bounced": {
      const sentAt = now - 9 * DAY
      insertMessage({
        leadId: lead.id,
        direction: "out",
        step: 1,
        subject,
        body: firstEmail(seed),
        sentAt,
        bounced: true,
      })
      eventAt(sentAt, "send.step_sent", lead.id, { step: 1 })
      eventAt(sentAt + 2 * 60_000, "inbound.bounce", lead.id, {
        kind: "hard",
        detail: "550 5.1.1 user unknown",
      })
      break
    }
  }
}

/**
 * A fortnight of sends spread across leads that already exist, so the
 * dashboard chart has a shape instead of two spikes.
 */
function backfillChart(leadIds: string[]): void {
  if (leadIds.length === 0) return
  for (let daysAgo = 13; daysAgo >= 1; daysAgo--) {
    const at = new Date(now - daysAgo * DAY)
    // Weekends are empty, because the send window is weekdays-only and a
    // chart that ignores that is a chart of something else.
    if (at.getDay() === 0 || at.getDay() === 6) continue
    at.setHours(10, 0, 0, 0)
    // The warm-up ramp starts at 5/day and climbs, so early days are thin.
    const count = Math.min(14, 4 + Math.round((13 - daysAgo) * 0.8))
    for (let i = 0; i < count; i++) {
      const leadId = leadIds[(daysAgo * 7 + i) % leadIds.length]
      insertMessage({
        leadId,
        direction: "out",
        step: null,
        subject: "Vending machine?",
        body: "(one of the earlier sends, kept for the chart)",
        sentAt: at.getTime() + i * 11 * 60_000,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function main(): void {
  const force = process.argv.includes("--force")
  const existing = countLeads()

  if (existing > 0 && !force) {
    console.error(
      [
        "",
        `  There are already ${existing} leads in ${resolveDbPath()}.`,
        "",
        "  Seeding would mix demo businesses into real ones and there is no",
        "  way to tell them apart afterwards. Either point VENDING_DB_PATH at",
        "  a scratch file, or re-run with --force to wipe what is there:",
        "",
        "    pnpm seed:demo --force",
        "",
      ].join("\n")
    )
    process.exitCode = 1
    return
  }

  if (force) {
    db.exec(`
      DELETE FROM messages;
      DELETE FROM events;
      DELETE FROM tasks;
      DELETE FROM leads;
      DELETE FROM suppressed;
    `)
  }

  db.exec("BEGIN IMMEDIATE")
  try {
    for (const seed of SEEDS) seedOne(seed)
    db.exec("COMMIT")
  } catch (err) {
    db.exec("ROLLBACK")
    throw err
  }

  // Closed leads only. The Calls list keys off a lead's most recent send, so
  // hanging two weeks of backfill on a live lead would either bury it or
  // resurrect it, depending on which end of the window the backfill landed.
  const archived = db
    .prepare(`SELECT id FROM leads WHERE status IN ('won','dead','suppressed')`)
    .all() as unknown as { id: string }[]
  const contacted = db
    .prepare(`SELECT id FROM leads WHERE status = 'contacted'`)
    .all() as unknown as { id: string }[]
  db.exec("BEGIN IMMEDIATE")
  try {
    backfillChart(archived.map((r) => r.id))
    db.exec("COMMIT")
  } catch (err) {
    db.exec("ROLLBACK")
    throw err
  }

  // A dead-lettered job, so the "N jobs gave up" banner has something behind
  // it. Every screen that can show a problem should be reachable from here.
  const stuck = enqueue("enrich", { leadId: contacted[0]?.id })
  db.prepare(
    `UPDATE tasks SET status = 'failed', attempts = 5 WHERE id = ?`
  ).run(stuck)
  eventAt(now - 2 * HOUR, "task_dead_letter", contacted[0]?.id ?? null, {
    kind: "enrich",
    error: "fetch failed: the site did not respond after five tries",
  })

  logEvent("engine.started", { detail: { seeded: true } })

  const counts = db
    .prepare(
      `SELECT status, count(*) AS n FROM leads GROUP BY status ORDER BY n DESC`
    )
    .all() as unknown as { status: string; n: number }[]
  const messages = db.prepare(`SELECT count(*) AS n FROM messages`).get() as {
    n: number
  }

  console.log("")
  console.log(`  Seeded ${SEEDS.length} businesses into ${resolveDbPath()}`)
  console.log(`  ${Number(messages.n)} messages, all marked as practice runs.`)
  console.log("")
  for (const row of counts) {
    console.log(`    ${String(Number(row.n)).padStart(4)}  ${row.status}`)
  }
  console.log("")
  console.log("  Start the app with `pnpm dev` and open http://localhost:3000")
  console.log("")
}

main()
closeDb()
