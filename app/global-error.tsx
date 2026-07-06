'use client'

// Last-resort boundary: catches errors thrown by the root layout itself, where
// app/error.tsx can't render. Must provide its own <html>/<body> and cannot
// rely on the layout's fonts or globals, so styling is deliberately inline-safe.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'Inter, Helvetica, Arial, sans-serif', background: '#F8FAFC' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: '14px', color: '#64748B', marginBottom: '16px' }}>
              An unexpected error interrupted the app.
            </p>
            <button
              onClick={reset}
              style={{
                borderRadius: '40px',
                padding: '8px 20px',
                fontSize: '14px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: '#098195',
                color: '#FFFFFF',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
