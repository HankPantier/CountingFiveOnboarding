import { Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { ReactNode } from 'react'

const styles = StyleSheet.create({
  page:       { padding: 48, backgroundColor: '#ffffff' },
  heading:    { fontSize: 16, fontWeight: 'bold', color: '#003B71', marginBottom: 14, paddingBottom: 6, borderBottom: '1pt solid #E2E8F0' },
  subheading: { fontSize: 12, fontWeight: 'bold', color: '#1E293B', marginTop: 12, marginBottom: 6 },
  section:    { marginBottom: 8 },
  label:      { fontSize: 9, color: '#94A3B8', marginBottom: 2 },
  value:      { fontSize: 11, color: '#1E293B', lineHeight: 1.5 },
})

export function DataPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.heading}>{title}</Text>
      {children}
    </Page>
  )
}

export function Field({ label, value }: { label: string; value: string | number | undefined | null }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <Text style={styles.value}>{String(value)}</Text>
    </View>
  )
}

export function Subheading({ children }: { children: string }) {
  return <Text style={styles.subheading}>{children}</Text>
}
