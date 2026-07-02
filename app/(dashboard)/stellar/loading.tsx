import { Skeleton } from "@/components/ui/skeleton"

export default function StellarLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-5 w-56" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full max-w-2xl" />
        ))}
      </div>

      <div className="rounded-md border">
        <div className="grid grid-cols-6 gap-4 border-b p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-16" />
          ))}
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="grid grid-cols-6 items-center gap-4 border-b p-4 last:border-0">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-24" />
            <div className="flex justify-end gap-2">
              <Skeleton className="h-7 w-14" />
              <Skeleton className="h-7 w-14" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
