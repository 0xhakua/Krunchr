import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function AdminSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="h-full">
            <CardHeader className="pb-2">
              <Skeleton className="mb-2 h-5 w-24" />
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-full max-w-sm" />
      </div>

      <div className="rounded-md border">
        <div className="grid grid-cols-5 gap-4 border-b p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-20" />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="grid grid-cols-5 items-center gap-4 border-b p-4 last:border-0">
            {Array.from({ length: 4 }).map((__, j) => (
              <Skeleton key={j} className="h-4 w-20" />
            ))}
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

export default function AdminLoading() {
  return <AdminSkeleton />
}
