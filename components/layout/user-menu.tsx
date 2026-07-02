'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Loader2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface UserMenuProps {
  username: string
  role: 'ADMIN' | 'TAXPAYER'
}

const ROLE_LABEL: Record<UserMenuProps['role'], string> = {
  ADMIN: 'Administrator',
  TAXPAYER: 'Taxpayer',
}

export function UserMenu({ username, role }: UserMenuProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const initial = username?.[0]?.toUpperCase() ?? 'U'

  async function handleSignOut() {
    setError(null)
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? 'Sign out failed')
        return
      }
      startTransition(() => {
        router.replace('/login')
      })
    } catch {
      setError('Network error while signing out')
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={(next) => { setOpen(next); if (!next) setError(null) }}>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${username}`}
        className={cn(
          'flex size-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground',
          'transition-colors hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
          'data-[popup-open]:bg-accent/80',
        )}
        data-testid="user-menu-trigger"
      >
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="min-w-56"
        data-testid="user-menu-content"
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-foreground">{username}</span>
            <span className="text-xs text-muted-foreground">{ROLE_LABEL[role]}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {error ? (
          <p
            role="alert"
            className="px-1.5 py-1.5 text-xs text-destructive"
            data-testid="user-menu-error"
          >
            {error}
          </p>
        ) : null}
        <DropdownMenuItem
          variant="destructive"
          onClick={handleSignOut}
          disabled={pending}
          data-testid="user-menu-signout"
        >
          {pending ? <Loader2 className="animate-spin" /> : <LogOut />}
          <span>{pending ? 'Signing out...' : 'Sign out'}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
