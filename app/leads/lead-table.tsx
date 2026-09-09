"use client"

import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { LeadDetailDialog } from "./lead-detail-dialog"
import {
  leadFit,
  LEAD_FIT_EXPLANATION,
  LEAD_STATUS_BADGE_VARIANT,
  LEAD_STATUS_LABELS,
  type LeadListItem,
} from "./types"

// Base UI's Select renders the raw value in its closed state unless it is
// given a label for each option, which is how this filter used to sit there
// reading "all".
const STATUS_FILTER_ITEMS = [
  { value: "all", label: "All stages" },
  ...Object.entries(LEAD_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
]

interface LeadTableProps {
  items: LeadListItem[]
  total: number
  cap: number
}

export function LeadTable({ items, total, cap }: LeadTableProps) {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<string>("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return items.filter((item) => {
      if (status !== "all" && item.status !== status) return false
      if (!needle) return true
      return (item.name ?? "").toLowerCase().includes(needle)
    })
  }, [items, search, status])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          className="max-w-56"
        />
        <Select
          items={STATUS_FILTER_ITEMS}
          value={status}
          onValueChange={(v) => {
            if (v) setStatus(v)
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          Showing {filtered.length} of {items.length}
          {total > cap ? ` · ${total} in total, newest ${cap} shown` : ""}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead title={LEAD_FIT_EXPLANATION}>Fit</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Detail we&apos;ll mention</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground"
                >
                  Nothing matches.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((item) => (
              <TableRow
                key={item.id}
                className="cursor-pointer"
                onClick={() => setSelectedId(item.id)}
              >
                <TableCell
                  className="max-w-48 truncate font-medium"
                  title={item.name ?? undefined}
                >
                  {item.name ?? "No name"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.type ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={LEAD_STATUS_BADGE_VARIANT[item.status]}>
                    {LEAD_STATUS_LABELS[item.status]}
                  </Badge>
                </TableCell>
                <TableCell
                  className="text-muted-foreground"
                  title={LEAD_FIT_EXPLANATION}
                >
                  {leadFit(item.score)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.email ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.phone ?? "—"}
                </TableCell>
                <TableCell
                  className="max-w-64 truncate text-muted-foreground"
                  title={item.fact ?? undefined}
                >
                  {item.fact ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <LeadDetailDialog
        leadId={selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </div>
  )
}
