'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { SidebarHeader } from './sidebar-header'
import { SidebarFooter } from './sidebar-footer'
import { SidebarNav } from './sidebar-nav'

interface MobileSidebarProps {
  isAdmin: boolean
}

export function MobileSidebar({ isAdmin }: MobileSidebarProps) {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open navigation menu"
            className="md:hidden"
          >
            <Menu className="size-6" />
          </Button>
        }
      />
      <SheetContent side="left" className="w-[280px] bg-sidebar p-0">
        <SheetHeader className="p-4 pb-0 text-left">
          <SheetTitle className="sr-only">Navigation menu</SheetTitle>
          <SidebarHeader />
        </SheetHeader>
        <div className="flex flex-1 flex-col px-4 py-2">
          <Link href="/income" className="mb-4 block" onClick={() => setOpen(false)}>
            <Button className="w-full">Start New Filing</Button>
          </Link>
          <SidebarNav isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
          <SidebarFooter />
        </div>
      </SheetContent>
    </Sheet>
  )
}
