import { prisma } from '../lib/prisma'

async function main() {
  const returns = await prisma.taxReturn.findMany({
    where: {
      taxYear: {
        taxpayer: { tin: '123-456-789-001' },
      },
    },
    include: { penalties: true },
    orderBy: { sequenceOrder: 'asc' },
  })
  console.log(JSON.stringify(returns, null, 2))
  await prisma.$disconnect()
}

main().catch(console.error)
