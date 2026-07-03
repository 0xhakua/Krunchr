import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import OnboardingForm from './onboarding-form'

export default async function OnboardingPage() {
  const session = await getSession()
  if (!session) {
    redirect('/login')
  }

  const profile = await prisma.taxpayerProfile.findUnique({
    where: { userId: session.sub },
  })

  if (profile) {
    redirect('/dashboard')
  }

  return <OnboardingForm />
}
