import type { Metadata } from 'next'
import StepWizard from '@/components/studio/StepWizard'

export const metadata: Metadata = { title: 'Студия' }

export default function StudioPage() {
  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-100">Студия генерации</h1>
        <p className="text-slate-500 text-sm mt-1">
          Создайте YouTube-видео за 8 шагов
        </p>
      </div>
      <StepWizard />
    </div>
  )
}
