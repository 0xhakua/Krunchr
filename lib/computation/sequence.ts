import { SEQUENCE_DEPENDENCIES_4, SEQUENCE_DEPENDENCIES_8 } from './constants'
import type { FormTypeValue } from './constants'

export function getDependencies(corIncludes2551Q: boolean): Record<number, number[]> {
  return corIncludes2551Q ? SEQUENCE_DEPENDENCIES_8 : SEQUENCE_DEPENDENCIES_4
}

type SequenceReturnInput = {
  sequenceOrder: number
  formType: FormTypeValue
  status: string
}

/**
 * Determine the effective status of a return in the filing sequence.
 *
 * A VAT threshold breach (BR-12) overrides everything except an already-filed
 * return for Form 1701A, because Kuwenta only supports non-VAT taxpayers and
 * the annual 1701A is out of scope once the taxpayer must register for VAT.
 */
export function determineReturnStatus(
  sequenceOrder: number,
  allReturns: Array<SequenceReturnInput>,
  corIncludes2551Q: boolean,
  vatBreached = false
): 'BLOCKED' | 'PENDING' | 'GENERATED' | 'FILED' {
  const current = allReturns.find((r) => r.sequenceOrder === sequenceOrder)
  if (!current) return 'BLOCKED'
  if (current.status === 'FILED') return 'FILED'
  if (vatBreached && current.formType === 'FORM_1701A') return 'BLOCKED'
  if (current.status === 'GENERATED') return 'GENERATED'

  const dependencies = getDependencies(corIncludes2551Q)[sequenceOrder] ?? []
  const depsFiled = dependencies.every((depOrder) => {
    const dep = allReturns.find((r) => r.sequenceOrder === depOrder)
    return dep?.status === 'FILED'
  })

  return depsFiled ? 'PENDING' : 'BLOCKED'
}

const VAT_BREACH_BLOCK_REASON =
  'VAT threshold breached — register for VAT with the BIR before filing Form 1701A.'

/**
 * Return a human-readable reason when a return is hard-blocked by business
 * rules (currently VAT breach for Form 1701A). Returns undefined when the
 * return is not blocked or is blocked only by ordinary sequence dependencies.
 */
export function getReturnBlockReason(
  current: { formType: FormTypeValue; status: string },
  vatBreached = false
): string | undefined {
  if (vatBreached && current.formType === 'FORM_1701A' && current.status !== 'FILED') {
    return VAT_BREACH_BLOCK_REASON
  }
  return undefined
}
