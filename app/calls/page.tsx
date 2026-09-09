import { CallCard } from "./call-card"
import { getCallListItems } from "./data"

// Reads the local SQLite DB directly on every request — see app/settings/page.tsx.
export const dynamic = "force-dynamic"

export default function CallsPage() {
  const items = getCallListItems()

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-lg font-medium">Calls</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Leads emailed 18–96 hours ago that are still quiet, with a phone number
        on file.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
            <p className="text-sm font-medium">No one to call right now.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This list fills in once emailed leads go quiet for about a day.
            </p>
          </div>
        ) : (
          items.map((item) => <CallCard key={item.id} item={item} />)
        )}
      </div>
    </div>
  )
}
