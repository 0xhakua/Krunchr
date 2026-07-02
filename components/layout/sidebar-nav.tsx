'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  UserPlus,
  FileUp,
  Scale,
  Network,
  Coins,
  FileSpreadsheet,
  BookText,
  ShieldCheck,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type NavItem = { href: string; label: string; icon: LucideIcon }

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/onboarding', label: 'Onboarding', icon: UserPlus },
  { href: '/income', label: 'Form 2307', icon: FileUp },
  { href: '/election', label: 'Tax Election', icon: Scale },
  { href: '/returns', label: 'Returns', icon: Network },
  { href: '/prior-year-credit', label: 'Prior Year Credit', icon: Coins },
  { href: '/sawt', label: 'SAWT', icon: FileSpreadsheet },
  { href: '/journal', label: 'Journal', icon: BookText },
  { href: '/stellar', label: 'Stellar', icon: ShieldCheck },
]

export function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const items = isAdmin
    ? [...NAV, { href: '/admin', label: 'Admin', icon: Settings }]
    : NAV

  return (
    <nav className="flex-1 space-y-1">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition-colors',
              active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-bold'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon className="size-5 shrink-0" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
