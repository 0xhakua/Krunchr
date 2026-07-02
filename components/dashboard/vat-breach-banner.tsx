import { TriangleAlert } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export function VatBreachBanner({ className }: { className?: string }) {
  return (
    <Card className={`border-red-200 bg-red-50/50 ${className ?? ''}`}>
      <CardContent className="flex items-start gap-3 py-4">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div className="text-sm text-red-900">
          <p className="font-semibold">VAT threshold breached</p>
          <p>
            Kuwenta only supports non-VAT taxpayers. Register for VAT with the BIR
            to continue. Form 1701A generation is blocked until VAT registration is
            resolved.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
