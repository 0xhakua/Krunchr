"use client"

import * as React from "react"
import * as TooltipPrimitive from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

const BaseTooltip = TooltipPrimitive.Tooltip

type ProviderProps = React.ComponentProps<typeof BaseTooltip.Provider>

function TooltipProvider({ delay = 100, ...props }: ProviderProps) {
  return <BaseTooltip.Provider delay={delay} {...props} />
}

function Tooltip({ ...props }: React.ComponentProps<typeof BaseTooltip.Root>) {
  return <BaseTooltip.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ className, ...props }: React.ComponentProps<typeof BaseTooltip.Trigger>) {
  return (
    <BaseTooltip.Trigger
      data-slot="tooltip-trigger"
      className={cn("focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      {...props}
    />
  )
}

function TooltipContent({
  className,
  children,
  side = "top",
  ...props
}: React.ComponentProps<typeof BaseTooltip.Positioner> & { children: React.ReactNode }) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner side={side} {...props}>
        <BaseTooltip.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 max-w-xs rounded-lg bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10",
            "data-[instant=delay]:duration-200 data-[instant=delay]:ease-out",
            "data-[side=top]:origin-bottom data-[side=bottom]:origin-top data-[side=left]:origin-right data-[side=right]:origin-left",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            className
          )}
        >
          {children}
          <BaseTooltip.Arrow className="fill-popover stroke-foreground/10" />
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
