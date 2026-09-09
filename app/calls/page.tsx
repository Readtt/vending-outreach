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
        description="Businesses you emailed a day or two ago that have gone quiet, and have a phone number."
      />

      {items.length === 0 ? (
        <EmptyState title="Nobody to call right now.">
          This fills in about a day after emails go out, once someone has not
          replied.
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
