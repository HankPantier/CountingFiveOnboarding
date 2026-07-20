'use client'

import { useEffect, useState } from 'react'

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

// Time-of-day greeting resolved in the browser: the server runs in UTC on
// Vercel, so computing it there would greet against the wrong clock. Renders a
// neutral fallback until mounted to avoid a hydration mismatch.
export default function HomeGreeting({ firstName }: { firstName: string }) {
  const [part, setPart] = useState<string | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPart(greetingFor(new Date().getHours()))
  }, [])

  const name = firstName ? `, ${firstName}` : ''
  return (
    <div>
      <h1 className="text-3xl font-heading font-bold text-brand-navy">
        {part ?? 'Hello'}{name}
      </h1>
      <p className="text-text-secondary font-body mt-1.5">
        What do you want to do today?
      </p>
    </div>
  )
}
