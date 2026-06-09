'use client'

import { useState } from 'react'

// Renders a repo image by streaming it from the admin-only asset route. The
// `version` prop is bumped by parents after a replace to defeat any in-memory
// browser cache for the same URL.
export default function AssetThumb({
  sessionId,
  assetPath,
  version = 0,
  className = '',
  alt = '',
}: {
  sessionId: string
  assetPath: string
  version?: number
  className?: string
  alt?: string
}) {
  const [errored, setErrored] = useState(false)
  const src = `/api/edit/${sessionId}/asset?path=${encodeURIComponent(assetPath)}&v=${version}`

  if (errored) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-subtle text-text-muted text-[10px] font-body text-center px-2 ${className}`}
      >
        Image not found
      </div>
    )
  }

  return (
    // bytes are streamed from a private admin route, not a public/optimizable URL.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={version}
      src={src}
      alt={alt}
      onError={() => setErrored(true)}
      className={`object-cover bg-surface-subtle ${className}`}
    />
  )
}
