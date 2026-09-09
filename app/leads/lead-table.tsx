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
import { LEAD_STATUS_BADGE_VARIANT, LEAD_STATUS_LABELS, type LeadListItem } from "./types"

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
          value={status}
          onValueChange={(v) => {
            if (v) setStatus(v)
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(LEAD_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {items.length} shown
          {total > cap ? ` · ${total} leads total, showing the ${cap} most recent` : ""}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Personalization fact</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No leads match.
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
                  {item.name ?? "Unnamed"}
                </TableCell>
                <TableCell className="text-muted-foreground">{item.type ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={LEAD_STATUS_BADGE_VARIANT[item.status]}>
                    {LEAD_STATUS_LABELS[item.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{item.score}</TableCell>
                <TableCell className="text-muted-foreground">{item.email ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{item.phone ?? "—"}</TableCell>
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
