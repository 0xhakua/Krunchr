export function SidebarFooter() {
  return (
    <div className="mt-auto flex items-center justify-between rounded-lg border border-sidebar-border bg-card px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">Stellar Network</span>
      <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
        <span className="size-2 rounded-full bg-primary" />
        Active
      </span>
    </div>
  )
}
