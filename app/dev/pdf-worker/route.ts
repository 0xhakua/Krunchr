import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Dev-only proxy for the pdfjs-dist worker script.
 *
 * Serves the worker from node_modules so the browser loads it same-origin,
 * avoiding CSP and CDN/network issues. The route 404s in production because
 * /dev/coord-picker is also unavailable there.
 */
export const runtime = 'nodejs'

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return new NextResponse('Not found', { status: 404 })
  }

  const filePath = path.join(
    process.cwd(),
    'node_modules',
    'pdfjs-dist',
    'build',
    'pdf.worker.mjs',
  )
  const content = await readFile(filePath, 'utf-8')

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
    },
  })
}
