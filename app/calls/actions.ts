"use server"

/**
 * Server actions backing the Calls page: generating (and caching) a call
 * script, and recording an outcome.
 */

import { revalidatePath } from "next/cache"
import { generateGuarded } from "@/lib/ai"
import { getLeadById, updateLead, type LeadStatus } from "@/lib/db"
import { buildCallScriptSystemPrompt } from "@/lib/prompts"
import { getAboutSettings } from "../settings/data"
import { parseResearchJson } from "./data"
import type { CallOutcome } from "./types"

/**
 * Writes (and caches on the lead) a call script. Checks the cache first —
 * even a double-click can't trigger a second model call — and merges into
 * `research_json` rather than overwriting it, since enrichment and the OSM
 * import already store their own keys there.
 */
export async function generateCallScriptAction(
  leadId: string
): Promise<string> {
  const lead = getLeadById(leadId)
  if (!lead) {
    throw new Error("This lead no longer exists.")
  }

  const research = parseResearchJson(lead.research_json)
  if (typeof research.callScript === "string" && research.callScript.trim()) {
    return research.callScript
  }

  const about = getAboutSettings()
  if (!about.name.trim() || !about.company.trim() || !about.address.trim()) {
    throw new Error(
      'Add your name, company, and address under Settings → "About you" before generating a call script.'
    )
  }

  const system = buildCallScriptSystemPrompt({
    name: about.name,
    company: about.company,
    address: about.address,
    ...(about.phone ? { phone: about.phone } : {}),
    ...(about.offerTerms ? { offerTerms: about.offerTerms } : {}),
  })

  // The call-script system prompt is deliberately fact-agnostic ("must work
  // for any business type, since the caller may not have researched this
  // one") — unlike the first email, the user prompt here carries no
  // personalization_fact, matching that design on purpose.
  const businessName = lead.name?.trim() || "the business"
  const prompt =
    `Business name: ${businessName}` +
    (lead.type ? `\nBusiness type: ${lead.type}` : "") +
    `\n\nWrite the call script now.`

  const result = await generateGuarded({
    role: "writer",
    prompt,
    system,
    leadId,
  })
  const script = result.text.trim()

  updateLead(leadId, {
    research_json: JSON.stringify({
      ...research,
      callScript: script,
      callScriptGeneratedAt: Date.now(),
    }),
  })

  revalidatePath("/calls")
  return script
}

const OUTCOME_STATUS: Record<CallOutcome, LeadStatus> = {
  // Treated as the phone equivalent of an email reply: they engaged.
  reached: "replied",
  // No real signal yet — leave the lead as contacted.
  left_voicemail: "contacted",
  not_interested: "dead",
  // Verbal interest needs a human next step, same as an inbound "let's talk" email.
  interested: "hot",
}

export async function setCallOutcomeAction(
  leadId: string,
  outcome: CallOutcome
): Promise<void> {
  updateLead(leadId, { status: OUTCOME_STATUS[outcome] })
  revalidatePath("/calls")
  revalidatePath("/")
}
