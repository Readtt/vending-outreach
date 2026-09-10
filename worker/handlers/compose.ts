/**
 * `compose` — write one email in the sequence and hand it to a `send` task.
 *
 * Steps 1, 4 and 9 all come through here. That is deliberate: a follow-up is
 * not a separate feature with its own idea of whether this person still wants
 * mail, it is the same code path with a different system prompt.
 *
 * Nothing here talks to SMTP. The output is a `send` task whose payload
 * carries the draft, which is also what makes spec §9.2's approval queue free:
 * a held lead's pending `send` payload IS the draft the UI reviews.
 */

import {
  enqueue,
  getLeadById,
  isSuppressed,
  logEvent,
  updateLead,
  type LeadRow,
} from "../../lib/db.ts"
import type { Country } from "../../lib/geo.ts"
import { generateGuardedText, hasRoleModel } from "./ai-bridge.ts"
import {
  buildFirstEmailSystemPrompt,
  buildFollowUpDay4SystemPrompt,
  buildFollowUpDay9SystemPrompt,
  expandSpintax,
  fillTemplate,
  type SenderInfo,
} from "../../lib/prompts.ts"
import { containsUrlOrEmail, fence } from "../../lib/untrusted.ts"
import {
  deadLetter,
  done,
  hasEverReplied,
  isSequenceStep,
  isTerminalLeadStatus,
  loadSenderInfo,
  parsePayload,
  readEarliestOutbound,
  type HandlerOutcome,
  type SequenceStep,
  type TaskLike,
} from "./common.ts"

// ---------------------------------------------------------------------------
// Subject lines
// ---------------------------------------------------------------------------

/**
 * The subject is ours, not the model's. Every system prompt in `prompts.ts`
 * ends with "Output the email body only. No subject line", so there is no
 * model-authored subject to validate in the first place — and a subject line
 * is the one part of a cold email with a legal shape (spec §5: `Re:` on a
 * message they never answered is deceptive under CAN-SPAM).
 *
 * Spintax varies the fixed skeleton so a few hundred recipients do not all get
 * a byte-identical subject. It runs BEFORE the business name is substituted,
 * because spintax must never be applied to per-lead content — a business
 * called "Bob's {Pizza|Subs}" would otherwise be silently renamed.
 */
export const STEP_1_SUBJECT_SKELETON =
  "{Quick question about %%business%%|Question about %%business%%|%%business%% - quick question}"

const REPLY_PREFIX_RE =
  /^\s*(?:(?:re|aw|sv|antw|res|fwd?|fw|tr|vs)\s*(?:\[\d+\])?\s*:\s*)+/i

export function buildSubject(
  step: SequenceStep,
  businessName: string,
  priorSubject: string | null,
  expand: (text: string) => string = expandSpintax
): string {
  if (step !== 1 && priorSubject !== null && priorSubject.trim().length > 0) {
    // Follow-ups keep the original subject so the thread reads as one
    // conversation. The visible `Re:` is NOT added here — `buildMime` gates it
    // on whether the recipient actually replied, and by definition they have
    // not (a reply cancels the sequence before this runs).
    return priorSubject.trim()
  }
  return fillTemplate(expand(STEP_1_SUBJECT_SKELETON), {
    business: businessName,
  })
}

// ---------------------------------------------------------------------------
// Output validation
// ---------------------------------------------------------------------------

/** Body length bounds per step, in characters. */
const LENGTH_BOUNDS: Record<SequenceStep, { min: number; max: number }> = {
  // ~80 words plus a sign-off and the CAN-SPAM postal address.
  1: { min: 150, max: 2500 },
  // "2-3 sentences, under 40 words" plus sign-off and address.
  4: { min: 60, max: 1200 },
  9: { min: 60, max: 1200 },
}

export interface DraftValidation {
  ok: boolean
  problems: string[]
}

export interface DraftToValidate {
  step: SequenceStep
  subject: string
  body: string
  businessName: string
  /**
   * The sender's physical postal address, from Settings -> About you.
   *
   * Required on every commercial email by CAN-SPAM, which is why
   * `loadSenderInfo` refuses to build a sender without one. The prompt asks
   * the model to reproduce it; this is where that is checked.
   */
  senderAddress: string
}

/**
 * Normalizes for a "does this text contain that text" check.
 *
 * The model reproduces the address inside a signature block, so line breaks
 * and spacing vary run to run. Everything but letters and digits is collapsed
 * so "1 Main St, Columbus, OH 43215" still matches across a line wrap.
 */
function normalizeForContains(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * A reply-to-opt-out line, in the shapes the prompts actually produce.
 *
 * CAN-SPAM requires a working opt-out mechanism, and spec §2 deliberately uses
 * reply-based opt-out rather than an unsubscribe link (a link is a spam
 * signal, and the inbound side already suppresses on opt-out language). So the
 * line has to genuinely be there, not merely have been requested in a prompt.
 */
const OPT_OUT_INVITE_RE = /\b(reply|let me know|say the word|tell me)\b/i
const OPT_OUT_EFFECT_RE =
  /(leave you alone|leave you be|stop (emailing|reaching|contacting)|no more emails|won'?t (email|follow|bother)|not a fit|drop it|off (my|the) list)/i

/**
 * The gate between a model and a stranger's inbox.
 *
 * Everything checked here is a property the prompt already asked for, checked
 * anyway, because "the prompt said not to" is not a control. A failure is
 * never a reason to send a fixed-up version — the handler regenerates once and
 * then escalates to a human.
 */
export function validateDraft(draft: DraftToValidate): DraftValidation {
  const problems: string[] = []
  const { step, subject, body, businessName } = draft

  // Spec §4: URLs and email addresses are forbidden in ALL model-authored
  // output. A link is what an injection most wants to get into an outgoing
  // message, and the fastest route to a spam filter.
  if (containsUrlOrEmail(body)) {
    problems.push("body contains a URL or email address")
  }
  if (containsUrlOrEmail(subject)) {
    problems.push("subject contains a URL or email address")
  }

  const bounds = LENGTH_BOUNDS[step]
  const length = body.trim().length
  if (length < bounds.min) {
    problems.push(`body is ${length} chars, under the ${bounds.min} minimum`)
  }
  if (length > bounds.max) {
    problems.push(`body is ${length} chars, over the ${bounds.max} maximum`)
  }

  // The business name is the one fact the whole email hangs on. Missing it
  // means the model wrote generic filler, which reads as bulk mail.
  const name = businessName.trim()
  if (name.length > 0 && !body.toLowerCase().includes(name.toLowerCase())) {
    problems.push(`body never mentions the business name "${name}"`)
  }

  // An unresolved `{{ }}` means a template variable never got filled, and
  // "Hi {{owner_name}}," is the single most recognisable mass-mail tell.
  if (/\{\{[^}]*\}\}/.test(body) || /\{\{[^}]*\}\}/.test(subject)) {
    problems.push("unresolved {{ }} placeholder")
  }

  // Spec §5. Only checked for step 1, because steps 4 and 9 inherit the
  // step-1 subject and `buildMime` strips a stray prefix there anyway.
  if (step === 1 && REPLY_PREFIX_RE.test(subject)) {
    problems.push(
      'step 1 subject starts with a reply prefix ("Re:"), which is a ' +
        "deceptive subject line under CAN-SPAM on a message they never answered"
    )
  }

  // CAN-SPAM: a physical postal address and a working opt-out on every
  // commercial message. Both were previously only asked for in the prompt,
  // which by this file's own doctrine is not a control — a model that drops
  // the signature block turns every email into a statutory defect, on the
  // highest-volume message the app sends.
  const address = draft.senderAddress.trim()
  if (address.length === 0) {
    problems.push("no sender postal address was supplied to validate against")
  } else if (
    !normalizeForContains(body).includes(normalizeForContains(address))
  ) {
    problems.push(
      "body does not carry the sender's postal address, which CAN-SPAM requires"
    )
  }

  if (!OPT_OUT_INVITE_RE.test(body) || !OPT_OUT_EFFECT_RE.test(body)) {
    problems.push(
      "body has no reply-to-opt-out line, which is the opt-out mechanism " +
        "CAN-SPAM requires (there is deliberately no unsubscribe link)"
    )
  }

  return { ok: problems.length === 0, problems }
}

// ---------------------------------------------------------------------------
// Prompting
// ---------------------------------------------------------------------------

function systemPromptFor(
  step: SequenceStep,
  sender: SenderInfo,
  country: Country,
  hasFact: boolean
): string {
  switch (step) {
    case 1:
      // The user turn omits the fact block when there is no fact, so the
      // system turn has to stop asking for one — see the note on
      // `buildFirstEmailSystemPrompt`.
      return buildFirstEmailSystemPrompt(sender, country, { hasFact })
    case 4:
      return buildFollowUpDay4SystemPrompt(sender, country)
    case 9:
      return buildFollowUpDay9SystemPrompt(sender, country)
  }
}

/**
 * The user turn: the business name, and for step 1 the one grounded
 * personalization fact.
 *
 * The fact is fenced even though `lib/leads.ts` already validated it as a
 * verbatim span in an allowed category. It came off a web page, and spec §4
 * classifies scraped content as untrusted regardless of what has been checked
 * about it — the fence is what stops a page whose text is shaped like
 * instructions from becoming instructions.
 *
 * Steps 4 and 9 are given no fact at all: their prompts forbid introducing a
 * new claim, so handing the model fresh material to work with is the wrong
 * shape of help.
 */
export function buildUserPrompt(
  step: SequenceStep,
  lead: LeadRow,
  fenceFn: (label: string, untrusted: string) => { block: string } = fence
): string {
  const businessName = lead.name?.trim() ?? ""
  const lines = [`Business name: ${businessName}`]
  if (lead.type) lines.push(`Business type: ${lead.type}`)

  if (step === 1 && lead.personalization_fact) {
    lines.push(
      "",
      `One verified fact about this business${
        lead.fact_category ? ` (category: ${lead.fact_category})` : ""
      }, extracted verbatim from their own website:`,
      fenceFn(
        "a fact scraped from the business's website",
        lead.personalization_fact
      ).block
    )
  }

  lines.push(
    "",
    `Write the email body now. Mention the business name "${businessName}" ` +
      "somewhere in it, in a way that reads naturally."
  )
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ComposeDeps {
  now?: () => number
  getLeadById?: (id: string) => LeadRow | undefined
  isSuppressed?: (email: string) => boolean
  hasEverReplied?: (leadId: string) => boolean
  readEarliestOutbound?: typeof readEarliestOutbound
  loadSenderInfo?: typeof loadSenderInfo
  hasWriterModel?: () => boolean | Promise<boolean>
  generateText?: (params: {
    role: "writer"
    prompt: string
    system?: string
    leadId?: string
  }) => Promise<{ text: string }>
  expandSpintax?: (text: string) => string
  fence?: (label: string, untrusted: string) => { block: string }
  enqueue?: typeof enqueue
  updateLead?: typeof updateLead
  logEvent?: typeof logEvent
}

export async function handleCompose(
  task: TaskLike,
  deps: ComposeDeps = {}
): Promise<HandlerOutcome> {
  const leadId = task.lead_id
  if (leadId === null) return deadLetter("compose task has no lead_id")

  const payload = parsePayload(task.payload_json)
  const step = (payload as { step?: unknown } | null)?.step
  if (!isSequenceStep(step)) {
    return deadLetter(
      `compose payload must be {"step": 1 | 4 | 9}, got ${task.payload_json ?? "null"}`
    )
  }

  const now = (deps.now ?? Date.now)()
  const readLead = deps.getLeadById ?? getLeadById
  const suppressed = deps.isSuppressed ?? isSuppressed
  const replied = deps.hasEverReplied ?? hasEverReplied
  const emit = deps.logEvent ?? logEvent
  const patchLead = deps.updateLead ?? updateLead
  const add = deps.enqueue ?? enqueue

  // --- 1. Is this lead still someone we may email? -------------------------
  const lead = readLead(leadId)
  if (!lead) return deadLetter(`lead ${leadId} no longer exists`)

  if (isTerminalLeadStatus(lead.status)) {
    return done(`abandoned: lead is ${lead.status}`)
  }
  const email = lead.email?.trim() ?? ""
  if (email.length === 0) {
    return deadLetter(
      `lead ${leadId} has no email address; enrichment should have marked it unqualified`
    )
  }
  if (suppressed(email)) {
    return done(`abandoned: ${email} is on the suppression list`)
  }
  if (step !== 1 && replied(leadId)) {
    // Any reply pauses the sequence immediately. Checked here as well as at
    // send time because the cheapest place to stop a follow-up is before a
    // model has been paid to write it.
    return done(`abandoned: lead has replied, so step ${step} is cancelled`)
  }

  const businessName = lead.name?.trim() ?? ""
  if (businessName.length === 0) {
    return deadLetter(
      `lead ${leadId} has no business name; the email has nothing to personalize on`
    )
  }

  // --- 2. Sender identity --------------------------------------------------
  // Unknown country resolves to Canada, matching `enrichLead`: the strips go
  // quiet near the border, and CASL asks for strictly more than CAN-SPAM, so
  // the unknown case should satisfy both.
  const country: Country = lead.country ?? "CA"
  const senderResult = (deps.loadSenderInfo ?? loadSenderInfo)(
    undefined,
    country
  )
  if (!senderResult.sender) {
    // A config error, not a transient one: retrying cannot fill in a form.
    return deadLetter(
      `cannot compose without sender details. Fill in Settings -> ${senderResult.missing.join(
        ", "
      )}.`
    )
  }
  const sender = senderResult.sender

  const hasModel = deps.hasWriterModel ?? (() => hasRoleModel("writer"))
  if (!(await hasModel())) {
    return deadLetter(
      "no model is assigned to the Email writer role. Set one in Settings -> AI Providers."
    )
  }

  // --- 3 + 4. Generate, validate, regenerate once --------------------------
  const generate = deps.generateText ?? generateGuardedText
  const system = systemPromptFor(
    step,
    sender,
    country,
    Boolean(lead.personalization_fact?.trim())
  )
  const basePrompt = buildUserPrompt(step, lead, deps.fence)

  const prior = (deps.readEarliestOutbound ?? readEarliestOutbound)(leadId)
  const subject = buildSubject(
    step,
    businessName,
    prior?.subject ?? null,
    deps.expandSpintax
  )

  let body = ""
  let validation: DraftValidation = { ok: false, problems: ["not generated"] }

  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt =
      attempt === 1
        ? basePrompt
        : `${basePrompt}\n\nYour previous attempt was rejected for these reasons. ` +
          `Fix all of them:\n- ${validation.problems.join("\n- ")}`

    const result = await generate({
      role: "writer",
      system,
      prompt,
      leadId,
    })
    body = result.text.trim()
    validation = validateDraft({
      step,
      subject,
      body,
      businessName,
      senderAddress: sender.address,
    })
    if (validation.ok) break

    emit("compose.validation_failed", {
      leadId,
      detail: { step, attempt, problems: validation.problems },
    })
  }

  if (!validation.ok) {
    // Regenerating once is the whole allowance. Beyond that, a human looks at
    // it — the alternative is sending unvalidated model output to a stranger,
    // and there is no version of that which is the better risk.
    patchLead(leadId, { status: "hot" })
    emit("compose.escalated", {
      leadId,
      detail: {
        step,
        problems: validation.problems,
        reason:
          "draft failed validation twice; escalated for a human instead of sending",
      },
    })
    return done(
      `escalated to hot: draft failed validation twice (${validation.problems.join("; ")})`
    )
  }

  // --- 5. Hand the draft to a send task ------------------------------------
  // The draft rides in the payload. No schema change, and the pending `send`
  // task of a `held` lead is exactly what the approval queue displays.
  //
  // `run_after` is now for every step: the day-4 delay is already baked into
  // the `run_after` of THIS compose task (the send handler enqueued it four
  // days out), and pacing is owned end to end by the send handler. A second
  // opinion about timing here would just be a second thing to get wrong.
  const sendTaskId = add("send", {
    leadId,
    runAfter: now,
    payload: { step, subject, body },
  })

  emit("compose.drafted", {
    leadId,
    detail: {
      step,
      sendTaskId,
      subjectLength: subject.length,
      bodyLength: body.length,
      held: lead.status === "held",
    },
  })

  return done(`step ${step} drafted; send task ${sendTaskId} enqueued`)
}
