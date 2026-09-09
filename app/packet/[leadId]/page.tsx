import Link from "next/link"
import { notFound } from "next/navigation"
import { getPacketData } from "./data"
import { PrintButton } from "./print-button"

// Reads the local SQLite DB directly on every request — see app/settings/page.tsx.
export const dynamic = "force-dynamic"

export default async function PacketPage({
  params,
}: {
  params: Promise<{ leadId: string }>
}) {
  const { leadId } = await params
  const packet = getPacketData(leadId)
  if (!packet) notFound()

  const { sender } = packet
  const senderIncomplete =
    !sender.name.trim() || !sender.company.trim() || !sender.address.trim()

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white text-black print:static print:overflow-visible">
      <style>{`
        @media print {
          @page { margin: 0.6in; }
        }
      `}</style>

      <div className="mx-auto flex min-h-full max-w-2xl flex-col px-10 py-10 print:px-0 print:py-0">
        <PrintButton />

        {senderIncomplete && (
          <div className="mb-6 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 print:hidden">
            Your name, company and address are not filled in yet. Add them under{" "}
            <Link href="/settings" className="underline underline-offset-2">
              Settings → About you
            </Link>{" "}
            before you hand this out. A real postal address belongs on anything
            you leave behind.
          </div>
        )}

        <header className="border-b-2 border-black pb-4">
          <p className="text-xs tracking-wide text-neutral-500 uppercase">
            Vending machine offer
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{packet.businessName}</h1>
          {packet.businessAddress && (
            <p className="mt-1 text-sm text-neutral-600">
              {packet.businessAddress}
            </p>
          )}
        </header>

        <section className="mt-6 flex flex-col gap-4 text-[15px] leading-relaxed">
          <p>
            {sender.company || "We"} would like to install a vending machine at{" "}
            {packet.businessName}
            {/* "About you" asks for a phrase ("a share of what it sells, no
                fees"), not a sentence, so it is joined with a comma. Ending
                the sentence first and starting the next one lowercase is what
                it used to do, and it read like a typo. */}
            {sender.offerTerms
              ? `, at no cost to you — ${sender.offerTerms}.`
              : ", at no cost to you. We own it, stock it, and keep it running, and you get a share of what it sells. No fees, nothing for you to manage."}
          </p>

          {packet.fact && <p>We noticed: {packet.fact}</p>}

          <div>
            <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              How it works
            </h2>
            <ol className="mt-1.5 list-decimal pl-5">
              <li>We deliver and install the machine. It costs you nothing.</li>
              <li>We stock it and keep it running.</li>
              <li>
                You get a share of what it sells. Nothing for you to manage.
              </li>
            </ol>
          </div>

          <p>
            Reply to the note left with this, or get in touch using the details
            below. Happy to answer questions before you decide.
          </p>
        </section>

        <footer className="mt-10 border-t border-neutral-300 pt-4 text-sm">
          <p className="font-medium">{sender.name || "—"}</p>
          {sender.company && <p>{sender.company}</p>}
          {sender.phone && <p>{sender.phone}</p>}
          <p>{sender.address || "—"}</p>
        </footer>
      </div>
    </div>
  )
}
