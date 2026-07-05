import Link from 'next/link'
import { Button } from '@/components/ui/button'

export function SidebarCTA() {
  return (
    <Link href="/income" className="mb-6 block">
      <Button className="w-full">Start New Filing</Button>
    </Link>
  )
}
