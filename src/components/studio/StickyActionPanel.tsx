'use client'

interface StickyActionPanelProps {
  stepLabel?: string
  costLine?: string
  primaryLabel: string
  primaryDisabled?: boolean
  onPrimary: () => void
  secondaryLabel?: string
  onSecondary?: () => void
}

export default function StickyActionPanel({
  stepLabel,
  costLine,
  primaryLabel,
  primaryDisabled,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: StickyActionPanelProps) {
  return (
    <div
      className="sticky top-6 flex flex-col gap-3 rounded-2xl p-5"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {stepLabel && (
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          {stepLabel}
        </p>
      )}
      {costLine && (
        <p className="text-sm text-slate-300">{costLine}</p>
      )}
      <button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled}
        className="w-full py-3 btn-gradient text-white font-semibold rounded-xl text-sm disabled:opacity-40"
      >
        {primaryLabel}
      </button>
      {secondaryLabel && onSecondary && (
        <button
          type="button"
          onClick={onSecondary}
          className="w-full py-2.5 btn-ghost-dark font-medium rounded-xl text-sm"
        >
          {secondaryLabel}
        </button>
      )}
    </div>
  )
}
