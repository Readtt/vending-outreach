import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { saveAboutSettingsAction } from "./actions"
import type { AboutSettings } from "./data"

export function AboutSection({ settings }: { settings: AboutSettings }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>About you</CardTitle>
        <CardDescription>
          This goes at the bottom of every email. Nothing gets written until the
          address is filled in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={saveAboutSettingsAction} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={settings.name}
                placeholder="Jordan Rivera"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="company">Business name</Label>
              <Input
                id="company"
                name="company"
                defaultValue={settings.company}
                placeholder="Buckeye Vending Co."
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              defaultValue={settings.phone}
              placeholder="(614) 555-0100"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address">Postal address</Label>
            <Input
              id="address"
              name="address"
              defaultValue={settings.address}
              placeholder="123 Main St, Columbus, OH 43215"
              required
            />
            <p className="text-xs text-muted-foreground">
              US law requires a real address on every sales email. A PO box is
              fine. This is why nothing sends until you fill it in.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="offerTerms">What you are offering</Label>
            <Textarea
              id="offerTerms"
              name="offerTerms"
              defaultValue={settings.offerTerms}
              placeholder="e.g. a share of what the machine sells, no fees, no minimums, we stock it and fix it"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              This is the deal every email offers. The more exact you are, the
              better the emails read.
            </p>
          </div>

          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
