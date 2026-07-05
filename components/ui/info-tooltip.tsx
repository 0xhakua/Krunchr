"use client"

import { Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export interface InfoTooltipProps {
  children: React.ReactNode
  side?: "top" | "bottom" | "left" | "right"
  className?: string
}

export function InfoTooltip({ children, side = "top", className }: InfoTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        className={`inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground ${className ?? ""}`}
        aria-label="More info"
      >
        <Info className="h-4 w-4" />
      </TooltipTrigger>
      <TooltipContent side={side}>{children}</TooltipContent>
    </Tooltip>
  )
}
