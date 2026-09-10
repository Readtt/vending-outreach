import { AutoRefresh } from "@/components/auto-refresh"
import { EmptyState, Page, PageHeader } from "@/components/page"
import { countLeads } from "@/lib/db"
import { getTargetingSettings } from "../settings/data"
import { ApprovalBanner } from "./approval-banner"
import { ClearLeadsButton } from "./clear-leads-button"
import { FindLocationsDialog } from "./find-locations-dialog"
import { LeadTable } from "./lead-table"
import { RetryAbandonedButton } from "./retry-abandoned-button"
import {
  getAbandonedCount,
  getBusinessTypeOptions,
  getLeadListData,
} from "./data"

// Reads the local SQLite DB directly on every request — see app/settings/page.tsx.
export const dynamic = "force-dynamic"

export default function LeadsPage() {
  const { items, total, cap } = getLeadListData()
  const typeOptions = getBusinessTypeOptions()
  const heldCount = countLeads({ status: ["held"] })
  const targeting = getTargetingSettings()
  const abandoned = getAbandonedCount()

  return (
    <Page width="full">
      <AutoRefresh />
      <PageHeader
        title="Leads"
        description="Every business found so far, and what has happened with each one."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ClearLeadsButton count={total} />
            <RetryAbandonedButton count={abandoned} />
            <FindLocationsDialog
              typeOptions={typeOptions}
              defaults={targeting}
            />
          </div>
        }
      />

      <ApprovalBanner heldCount={heldCount} />

      {items.length === 0 ? (
        <EmptyState title="No businesses yet.">
          Use <strong>Find businesses</strong> to search a town, a ZIP code, or
          a postal code for places nearby.
        </EmptyState>
      ) : (
        <LeadTable items={items} total={total} cap={cap} />
      )}
    </Page>
  )
}
