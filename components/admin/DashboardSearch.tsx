'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ListSearchInput from '@/components/admin/ListSearchInput'

// Debounced, instant-as-you-type search for the dashboard. The list is
// server-paginated, so filtering stays server-side (via the ?q= param) — this
// just pushes a debounced URL update instead of requiring an Enter/submit.
export default function DashboardSearch({
  initialQuery,
  status,
}: {
  initialQuery: string
  status: string
}) {
  const router = useRouter()
  const [value, setValue] = useState(initialQuery)
  const firstRun = useRef(true)
  const statusRef = useRef(status)
  // Keep the latest status in a ref so the debounced navigation reads it without
  // re-arming the timer on every status change. Writing the ref in an effect (not
  // during render) satisfies react-hooks/refs.
  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    // Don't navigate on mount — only when the user actually types.
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams()
      const q = value.trim()
      if (q) params.set('q', q)
      if (statusRef.current !== 'all') params.set('status', statusRef.current)
      const s = params.toString()
      router.replace(`/admin/dashboard${s ? `?${s}` : ''}`, { scroll: false })
    }, 300)
    return () => clearTimeout(timer)
  }, [value, router])

  return (
    <ListSearchInput
      value={value}
      onChange={setValue}
      placeholder="Search by client or website…"
      ariaLabel="Search sessions by client or website"
    />
  )
}
