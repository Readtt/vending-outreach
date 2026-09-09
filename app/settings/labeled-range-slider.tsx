"use client"

import { useState } from "react"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"

type SliderUnit = "plain" | "minutes" | "miles" | "hour"

function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  const period = h < 12 ? "AM" : "PM"
  const displayHour = h % 12 === 0 ? 12 : h % 12
  return `${displayHour}:00 ${period}`
}

function formatValue(unit: SliderUnit, value: number): string {
  if (unit === "minutes") return `${value} min`
  if (unit === "miles") return `${value} mi`
  if (unit === "hour") return formatHour(value)
  return String(value)
}

interface LabeledRangeSliderProps {
  /** Form field name. A single-thumb slider submits one value; a two-thumb
   * slider (defaultValue has 2 entries) submits two — read both server-side
   * with `formData.getAll(name)`. */
  name: string
  label: string
  defaultValue: number[]
  min: number
  max: number
  step?: number
  /**
   * How to display the numeric value. A closed set of strings rather than a
   * formatter function: this component is rendered from Server Components
   * (the Sending/Targeting sections), and a function prop can't cross the
   * server/client boundary.
   */
  unit?: SliderUnit
  /** Shows `warnText` inline once any thumb's value exceeds this. */
  warnAbove?: number
  warnText?: string
}

export function LabeledRangeSlider({
  name,
  label,
  defaultValue,
  min,
  max,
  step = 1,
  unit = "plain",
  warnAbove,
  warnText,
}: LabeledRangeSliderProps) {
  const [value, setValue] = useState<number[]>(defaultValue)
  const warn = warnAbove !== undefined && value.some((v) => v > warnAbove)

  function handleValueChange(next: number | readonly number[]) {
    setValue(Array.isArray(next) ? [...next] : [next as number])
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <span className="text-sm text-muted-foreground tabular-nums">
          {value.length > 1
            ? `${formatValue(unit, value[0])}–${formatValue(unit, value[value.length - 1])}`
            : formatValue(unit, value[0])}
        </span>
      </div>
      <Slider
        name={name}
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={handleValueChange}
      />
      {warn && warnText && (
        <p className="text-xs text-amber-600 dark:text-amber-500">{warnText}</p>
      )}
    </div>
  )
}
