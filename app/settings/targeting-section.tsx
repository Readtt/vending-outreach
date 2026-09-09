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
import { COUNTRIES, COUNTRY_LABELS } from "@/lib/geo"
import { saveTargetingSettingsAction } from "./actions"
import { LabeledRangeSlider } from "./labeled-range-slider"
import { BUSINESS_TYPES, type TargetingSettings } from "./data"

export function TargetingSection({
  settings,
}: {
  settings: TargetingSettings
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Who to find</CardTitle>
        <CardDescription>
          Where to look and what kinds of business to look for. These are the
          starting values on the Leads page, where you can change them for any
          one search.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={saveTargetingSettingsAction}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col gap-2">
            <Label>Countries</Label>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {COUNTRIES.map((code) => (
                <label key={code} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="countries"
                    value={code}
                    defaultChecked={settings.countries.includes(code)}
                    className="size-4 rounded border-input accent-primary"
                  />
                  {COUNTRY_LABELS[code]}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Canadian businesses are emailed under CASL rather than CAN-SPAM,
              which is stricter in two ways this handles for you: it only uses
              an address the business published on its own website, and it puts
              your phone number or website in the email next to your address.
              Fill in your phone under &ldquo;About you&rdquo; if you tick
              Canada.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="location">Town, ZIP, or postal code</Label>
            <Input
              id="location"
              name="location"
              defaultValue={settings.location}
              placeholder="Columbus, OH — London, ON — 43215 — K1A 0B1"
            />
          </div>

          <LabeledRangeSlider
            name="radiusMiles"
            label="How far to look"
            defaultValue={[settings.radiusMiles]}
            min={1}
            max={60}
            unit="miles"
          />

          <div className="flex flex-col gap-2">
            <Label>Kinds of business</Label>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {BUSINESS_TYPES.map((type) => (
                <label
                  key={type.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="businessTypes"
                    value={type.id}
                    defaultChecked={settings.businessTypes.includes(type.id)}
                    className="size-4 rounded border-input accent-primary"
                  />
                  {type.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
