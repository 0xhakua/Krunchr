import * as React from 'react'
import { cn } from '@/lib/utils'

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number
  max?: number
  indicatorClassName?: string
}

export function Progress({ value, max = 100, className, indicatorClassName, ...props }: ProgressProps) {
  const percent = Math.min(Math.max((value / max) * 100, 0), 100)
  return (
    <div
      className={cn('h-2.5 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <div
        className={cn('h-full rounded-full transition-all', percent >= 80 ? 'bg-red-500' : 'bg-primary', indicatorClassName)}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}
