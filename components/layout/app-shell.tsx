import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Bell, Layers, Link2 } from 'lucide-react'
import { getSession } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { SidebarNav } from './sidebar-nav'
import { UserMenu } from './user-menu'

export interface AppShellProps {
  children: React.ReactNode
}

export async function AppShell({ children }: AppShellProps) {
  const session = await getSession()
  if (!session) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Branded sidebar (BRAND.md §6) */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4">
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Layers className="size-5" />
          </div>
          <div className="leading-tight">
            <div className="font-heading text-lg font-black text-foreground">Krunchr</div>
            <div className="text-xs font-medium text-muted-foreground">Compliance Engine</div>
          </div>
        </div>

        <Link href="/income" className="mb-6 block">
          <Button className="w-full">Start New Filing</Button>
        </Link>

        <SidebarNav isAdmin={session.role === 'ADMIN'} />

        <div className="mt-auto flex items-center justify-between rounded-lg border border-sidebar-border bg-card px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Stellar Network</span>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <span className="size-2 rounded-full bg-primary" />
            Active
          </span>
        </div>
      </aside>

      {/* Content column */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-card px-4 md:px-10">
          <span className="font-heading text-xl font-bold text-foreground md:hidden">Krunchr</span>
          <div className="ml-auto flex items-center gap-4">
            <div className="hidden items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 sm:flex">
              <Link2 className="size-4 text-primary" />
              <span className="text-xs font-semibold text-muted-foreground">
                Blockchain Status: Secured
              </span>
            </div>
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
