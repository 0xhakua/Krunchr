import { Layers } from 'lucide-react'

export function SidebarHeader() {
  return (
    <div className="mb-6 flex items-center gap-3 px-2">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Layers className="size-5" />
      </div>
      <div className="leading-tight">
        <div className="font-heading text-lg font-black text-foreground">Krunchr</div>
        <div className="text-xs font-medium text-muted-foreground">Compliance Engine</div>
      </div>
    </div>
  )
}
