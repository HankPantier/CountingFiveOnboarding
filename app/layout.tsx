import type { Metadata } from 'next'
import { Inter, Open_Sans } from 'next/font/google'
import './globals.css'
import { cn } from '@/lib/utils'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const openSans = Open_Sans({
  subsets: ['latin'],
  variable: '--font-open-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'CountingFive Onboarding',
  description: 'Website onboarding for CountingFive clients.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={cn('h-full', inter.variable, openSans.variable)}>
      <body className="min-h-full flex flex-col bg-surface-page text-text-primary font-body antialiased">
        {children}
      </body>
    </html>
  )
}
