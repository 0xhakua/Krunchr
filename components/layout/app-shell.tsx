import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Bell } from 'lucide-react'
import { getSession } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { SidebarNav } from './sidebar-nav'
import { UserMenu } from './user-menu'
import { SidebarHeader } from './sidebar-header'
import { SidebarFooter } from './sidebar-footer'
import { MobileSidebar } from './mobile-sidebar'

export interface AppShellProps {
  children: React.ReactNode
}

export async function AppShell({ children }: AppShellProps) {
  const session = await getSession()
  if (!session) {
    redirect('/login')
  }

  const isAdmin = session.role === 'ADMIN'

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Branded sidebar (BRAND.md §6) — sticky on desktop, hidden on mobile */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4">
        <SidebarHeader />

        <Link href="/income" className="mb-4 block">
          <Button className="w-full">Start New Filing</Button>
        </Link>

        <SidebarNav isAdmin={isAdmin} />

        <SidebarFooter />
      </aside>

      {/* Content column */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-card px-4 md:px-10">
          <div className="flex items-center gap-3">
            <MobileSidebar isAdmin={isAdmin} />
            <Link href="/dashboard" className="font-heading text-xl font-bold text-foreground md:hidden">
              Krunchr
            </Link>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <button
              type="button"
              aria-label="Notifications"
              className="text-muted-foreground transition-colors hover:text-primary"
            >
              <Bell className="size-5" />
            </button>
            <UserMenu username={session.username} role={session.role} />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 md:px-10 md:py-8">
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </main>
      </div>
    </div>
  )
}
