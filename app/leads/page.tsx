import { countLeads } from "@/lib/db"
import { ApprovalBanner } from "./approval-banner"
import { FindLocationsDialog } from "./find-locations-dialog"
import { LeadTable } from "./lead-table"
import { getBusinessTypeOptions, getLeadListData } from "./data"

// Reads the local SQLite DB directly on every request — see app/settings/page.tsx.
export const dynamic = "force-dynamic"

export default function LeadsPage() {
  const { items, total, cap } = getLeadListData()
  const typeOptions = getBusinessTypeOptions()
  const heldCount = countLeads({ status: ["held"] })

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-medium">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every business this app knows about, and where each one stands.
          </p>
        </div>
        <FindLocationsDialog typeOptions={typeOptions} />
      </div>

      <div className="mt-6">
        <ApprovalBanner heldCount={heldCount} />
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
            <p className="text-sm font-medium">No leads yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Use &quot;Find locations&quot; to search a city or ZIP for nearby
              businesses.
            </p>
          </div>
        ) : (
          <LeadTable items={items} total={total} cap={cap} />
        )}
      </div>
    </div>
  )
}
