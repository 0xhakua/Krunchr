import { notFound } from 'next/navigation'
import { CoordPickerClient } from './coord-picker-client'

/**
 * Dev-only coordinate picker for BIR form overlay fields.
 *
 * This route is intentionally inaccessible in production. It renders the
 * interactive picker only when NODE_ENV === 'development'. Middleware also
 * opens /dev to unauthenticated requests in development for convenience.
 */
export default function CoordPickerPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  return <CoordPickerClient />
}
