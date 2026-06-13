'use client'

import { useRouter } from 'next/navigation'
import { useStudioStore } from '@/lib/studio-store'

interface Props {
  className?: string
  children: React.ReactNode
}

export default function NewProjectButton({ className, children }: Props) {
  const router = useRouter()
  const reset = useStudioStore((s) => s.reset)

  function handleClick() {
    reset()
    router.push('/studio')
  }

  return (
    <button type="button" onClick={handleClick} className={className}>
      {children}
    </button>
  )
}
