"use client"

import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { UnfoldMoreIcon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface ComboboxOption {
  value: string
  label: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value?: string
  onValueChange: (value: string) => void
  /** Shown on the closed button when nothing is picked yet. */
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
  id?: string
}

/**
 * A dropdown you can type in, for lists too long to scroll — the model
 * catalogue is the only one in this app, and some providers return hundreds.
 *
 * Built on the Popover and Command pieces already in `components/ui`. It
 * replaced a 727-line registry component whose extras (reasoning-effort
 * radios, groups, separators, sticky effort state) this app never used.
 */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Choose one",
  searchPlaceholder = "Search…",
  emptyText = "Nothing found.",
  disabled,
  className,
  id,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        // Model names are long and the trigger is narrow, so the full name has
        // to be reachable without opening the list.
        title={selected?.label}
        className={cn(
          "flex h-8 items-center justify-between gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:border-input dark:bg-input/30",
          className
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          strokeWidth={2}
          className="size-3.5 shrink-0 opacity-50"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 min-w-(--anchor-width) overflow-hidden p-0"
      >
        <Command className="bg-transparent">
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                // Both, so typing either the pretty name or the raw id finds it.
                value={`${option.label} ${option.value}`}
                data-checked={option.value === value}
                onSelect={() => {
                  onValueChange(option.value)
                  setOpen(false)
                }}
              >
                <span className="truncate">{option.label}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
