/**
 * Server-only data shaping for the printable packet. Static composition —
 * the business name, the offer (from Settings → "About you"), and the
 * lead's own fact — not a model call. This page has to be reliable at
 * doorstep-visit time, including for leads that failed enrichment and have
 * no fact at all, so it deliberately has no dependency on an AI provider
 * being configured.
 */

import { getLeadById } from "@/lib/db"
import { getAboutSettings } from "../../settings/data"

export interface PacketData {
  businessName: string
  businessAddress: string | null
  fact: string | null
  sender: {
    name: string
    company: string
    phone: string
    address: string
    offerTerms: string
  }
}

export function getPacketData(leadId: string): PacketData | null {
  const lead = getLeadById(leadId)
  if (!lead) return null

  const about = getAboutSettings()
  return {
    businessName: lead.name ?? "Business",
    businessAddress: lead.address,
    fact: lead.personalization_fact,
    sender: {
      name: about.name,
      company: about.company,
      phone: about.phone,
      address: about.address,
      offerTerms: about.offerTerms,
    },
  }
}
