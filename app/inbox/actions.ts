"use server"

/**
 * Server action backing the Inbox's three outcome buttons. Mark won/dead
 * are terminal `LeadStatus` values already in the vocabulary. "Back to
 * nurture" maps to `replied` — worker/handlers/classify.ts's own comment on
 * the `send_more_info` path confirms `replied` (not `hot`) is the resting
 * status once the bot has handled a reply without needing a human, which is
 * exactly what "no longer needs you, but still in play" means here.
 */

import { revalidatePath } from "next/cache"
import { updateLead, type LeadStatus } from "@/lib/db"
import type { ThreadOutcome } from "./types"

const OUTCOME_STATUS: Record<ThreadOutcome, LeadStatus> = {
  won: "won",
  dead: "dead",
  nurture: "replied",
}

export async function setThreadOutcomeAction(
  leadId: string,
  outcome: ThreadOutcome
): Promise<void> {
  updateLead(leadId, { status: OUTCOME_STATUS[outcome] })
  revalidatePath("/inbox")
  revalidatePath("/")
}
