// 7-segment progress indicator for the onboarding intake. Filled segments are
// teal; remaining segments use the default border color.
export default function PhaseStepper({ phase, total = 7 }: { phase: number; total?: number }) {
  return (
    <div className="flex items-center gap-[3px]" aria-label={`Phase ${phase} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-[5px] w-[15px] rounded-[2px] ${i < phase ? 'bg-brand-cyan' : 'bg-border-default'}`}
        />
      ))}
    </div>
  )
}
