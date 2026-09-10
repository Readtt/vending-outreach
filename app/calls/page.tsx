import { EmptyState, Page, PageHeader } from "@/components/page"
import { CallCard } from "./call-card"
import { getCallListItems } from "./data"

// Reads the local SQLite DB directly on every request — see app/settings/page.tsx.
export const dynamic = "force-dynamic"

export default function CallsPage() {
  const items = getCallListItems()

  return (
    <Page>
      <PageHeader
        title="Calls"
        description="Businesses with a phone number worth ringing — the ones you emailed a day or two ago who have gone quiet, and the ones no email address exists for at all."
      />

      {items.length === 0 ? (
        <EmptyState title="Nobody to call right now.">
          This fills in as businesses are researched — immediately for the ones
          with a phone number and no email address anywhere, and about a day
          after emails go out for the ones who have not replied.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((item) => (
            <CallCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </Page>
  )
}
