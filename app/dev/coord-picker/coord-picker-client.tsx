'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Trash2, Copy, MousePointerClick } from 'lucide-react'
import type * as PDFJS from 'pdfjs-dist'

type FormKey = '2551Q' | '1701Q' | '1701A'

type Align = 'left' | 'right' | 'center'

type RecordedCoord = {
  key: string
  page: number
  x: number
  y: number
  fontSize: number
  maxWidth: number
  align: Align
}

const FORM_FILES: Record<FormKey, string> = {
  '2551Q': '/bir-forms/2551Q.pdf',
  '1701Q': '/bir-forms/1701Q.pdf',
  '1701A': '/bir-forms/1701A.pdf',
}

/**
 * Official BIR forms are US Letter (612 x 936 pt). The picker assumes all
 * three forms share this page size; adjust here if a form differs.
 */
const PAGE_SIZE: { width: number; height: number } = {
  width: 612,
  height: 936,
}

export function CoordPickerClient() {
  const [form, setForm] = useState<FormKey>('2551Q')
  const [scale, setScale] = useState(2)
  const [page, setPage] = useState(1)
  const [pdf, setPdf] = useState<PDFJS.PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(1)
  const [currentX, setCurrentX] = useState(0)
  const [currentY, setCurrentY] = useState(0)
  const [fieldName, setFieldName] = useState('')
  const [fontSize, setFontSize] = useState(9)
  const [maxWidth, setMaxWidth] = useState(100)
  const [align, setAlign] = useState<Align>('left')
  const [coords, setCoords] = useState<RecordedCoord[]>([])
  const [exportCopied, setExportCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const canvasRef = useRef<HTMLCanvasElement>(null)

  /**
   * Load the selected PDF with pdfjs-dist. The worker is loaded from a CDN
   * so the dev tool works without copying pdf.worker.mjs into public/.
   */
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setError(null)
        const pdfjs = (await import('pdfjs-dist')) as typeof PDFJS
        pdfjs.GlobalWorkerOptions.workerSrc = '/dev/pdf-worker'

        const loadingTask = pdfjs.getDocument({
          url: FORM_FILES[form],
        })
        const loadedPdf = await loadingTask.promise
        if (cancelled) return

        setPdf(loadedPdf)
        setNumPages(loadedPdf.numPages)
        setPage(1)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [form])

  /**
   * Render the currently selected page onto the canvas at the chosen scale.
   */
  useEffect(() => {
    if (!pdf || !canvasRef.current) return
    const pdfDoc = pdf
    let cancelled = false

    async function render() {
      try {
        const pdfPage = await pdfDoc.getPage(page)
        const viewport = pdfPage.getViewport({ scale })
        const canvas = canvasRef.current!
        canvas.width = Math.round(viewport.width)
        canvas.height = Math.round(viewport.height)
        canvas.style.width = `${Math.round(viewport.width)}px`
        canvas.style.height = `${Math.round(viewport.height)}px`
        setCanvasSize({ width: Math.round(viewport.width), height: Math.round(viewport.height) })

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        await pdfPage.render({ canvasContext: ctx, viewport, canvas }).promise
        if (!cancelled) setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }

    render()
    return () => {
      cancelled = true
    }
  }, [pdf, page, scale])

  function handleCanvasClick(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    const clickY = event.clientY - rect.top

    const pdfLibX = (clickX / rect.width) * PAGE_SIZE.width
    const pdfLibY = PAGE_SIZE.height - (clickY / rect.height) * PAGE_SIZE.height

    setCurrentX(Math.round(pdfLibX * 100) / 100)
    setCurrentY(Math.round(pdfLibY * 100) / 100)
  }

  function recordCoord() {
    const key = fieldName.trim()
    if (!key) return

    const existingIndex = coords.findIndex((c) => c.key === key && c.page === page)
    const next: RecordedCoord = {
      key,
      page,
      x: currentX,
      y: currentY,
      fontSize,
      maxWidth,
      align,
    }

    if (existingIndex >= 0) {
      setCoords((prev) =>
        prev.map((c, i) => (i === existingIndex ? next : c)),
      )
    } else {
      setCoords((prev) => [...prev, next])
    }

    setFieldName('')
  }

  function deleteCoord(index: number) {
    setCoords((prev) => prev.filter((_, i) => i !== index))
  }

  function exportCoords() {
    const constantName = `COORDS_${form}`
    const map = Object.fromEntries(
      coords.map((c) => [
        c.key,
        {
          page: c.page,
          x: c.x,
          y: c.y,
          fontSize: c.fontSize,
          maxWidth: c.maxWidth,
          align: c.align,
        },
      ]),
    )

    const body =
      `import type { BirFormCoord } from "./types";\n\n` +
      `// Generated by /dev/coord-picker\n\n` +
      `export const ${constantName}: Record<string, BirFormCoord> = ${JSON.stringify(
        map,
        null,
        2,
      )};\n`

    void navigator.clipboard.writeText(body).then(() => {
      setExportCopied(true)
      setTimeout(() => setExportCopied(false), 1500)
    })
  }

  function screenX(pdfX: number, canvasWidth: number) {
    return (pdfX / PAGE_SIZE.width) * canvasWidth
  }

  function screenY(pdfY: number, canvasHeight: number) {
    // pdf-lib y is bottom-up; screen y is top-down
    return canvasHeight - (pdfY / PAGE_SIZE.height) * canvasHeight
  }

  const canvasWidth = canvasSize.width
  const canvasHeight = canvasSize.height

  return (
    <div className="flex h-screen flex-col bg-muted/30">
      <header className="border-b bg-background px-6 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-lg font-semibold">BIR Coordinate Picker</h1>
          <div className="flex items-center gap-2">
            <Label htmlFor="form-select" className="text-sm">
              Form
            </Label>
            <Select
              value={form}
              onValueChange={(value) => setForm(value as FormKey)}
            >
              <SelectTrigger id="form-select" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2551Q">2551Q</SelectItem>
                <SelectItem value="1701Q">1701Q</SelectItem>
                <SelectItem value="1701A">1701A</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="page-select" className="text-sm">
              Page
            </Label>
            <Select
              value={page.toString()}
              onValueChange={(value) => setPage(Number(value))}
            >
              <SelectTrigger id="page-select" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
                  <SelectItem key={p} value={p.toString()}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="scale-select" className="text-sm">
              Render scale
            </Label>
            <Select
              value={scale.toString()}
              onValueChange={(value) => setScale(Number(value))}
            >
              <SelectTrigger id="scale-select" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1x</SelectItem>
                <SelectItem value="1.5">1.5x</SelectItem>
                <SelectItem value="2">2x</SelectItem>
                <SelectItem value="3">3x</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p className="text-sm text-destructive">Error: {error}</p>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="relative flex-1 overflow-auto p-6">
          <div className="relative inline-block shadow-sm">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="cursor-crosshair bg-white"
            />
            {canvasWidth > 0 &&
              canvasHeight > 0 &&
              coords
                .filter((c) => c.page === page)
                .map((c, i) => (
                  <div
                    key={`${c.key}-${i}`}
                    className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/40 bg-red-500 shadow-sm"
                    style={{
                      left: screenX(c.x, canvasWidth),
                      top: screenY(c.y, canvasHeight),
                    }}
                    title={`${c.key} (${c.x}, ${c.y})`}
                  />
                ))}
          </div>
        </main>

        <aside className="w-96 overflow-y-auto border-l bg-background p-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MousePointerClick className="h-4 w-4" />
                Record coordinate
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md bg-muted p-3 text-sm">
                <p className="font-medium">Current click</p>
                <p className="font-mono text-muted-foreground">
                  x: {currentX.toFixed(2)} &nbsp; y: {currentY.toFixed(2)}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="field-name">Field name</Label>
                <Input
                  id="field-name"
                  value={fieldName}
                  onChange={(e) => setFieldName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') recordCoord()
                  }}
                  placeholder="e.g. part1_tin"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="font-size">Font size</Label>
                  <Input
                    id="font-size"
                    type="number"
                    min={1}
                    max={72}
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-width">Max width</Label>
                  <Input
                    id="max-width"
                    type="number"
                    min={0}
                    value={maxWidth}
                    onChange={(e) => setMaxWidth(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="align">Align</Label>
                <Select
                  value={align}
                  onValueChange={(value) => setAlign(value as Align)}
                >
                  <SelectTrigger id="align">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">left</SelectItem>
                    <SelectItem value="right">right</SelectItem>
                    <SelectItem value="center">center</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={recordCoord}
                disabled={!fieldName.trim()}
                className="w-full"
              >
                Record
              </Button>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Recorded coordinates ({coords.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {coords.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Click the form, enter a field name, then press Record.
                </p>
              ) : (
                <ul className="space-y-2">
                  {coords.map((c, index) => (
                    <li
                      key={`${c.key}-${index}`}
                      className="flex items-start justify-between rounded-md border p-2 text-sm"
                    >
                      <div>
                        <p className="font-mono font-medium">{c.key}</p>
                        <p className="text-muted-foreground">
                          p{c.page} x:{c.x.toFixed(1)} y:{c.y.toFixed(1)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => deleteCoord(index)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <Button
                onClick={exportCoords}
                disabled={coords.length === 0}
                className="mt-4 w-full"
                variant="secondary"
              >
                <Copy className="mr-2 h-4 w-4" />
                {exportCopied ? 'Copied!' : 'Export TypeScript object'}
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
