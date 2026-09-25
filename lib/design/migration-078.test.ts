import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  CAPTURE_STATUSES,
  CHAT_ROLES,
  CONCEPT_STATUSES,
  DESIGN_INPUT_KINDS,
  PALETTE_FREEDOMS,
  RUN_ACTIVE_STATUSES,
  RUN_STATUSES,
  VERSION_SOURCES,
} from './studio-types'

const SQL = readFileSync(path.join(process.cwd(), 'supabase', '078_design_studio.sql'), 'utf-8')
const TABLES = ['design_inputs', 'design_runs', 'design_concepts', 'design_versions', 'design_chat_messages']

function tableBlock(table: string): string {
  const start = SQL.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`)
  if (start === -1) throw new Error(`table ${table} not found`)
  return SQL.slice(start, SQL.indexOf('\n);', start))
}

function quoted(list: string): string[] {
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

function checkList(table: string, column: string): string[] {
  const m = new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`).exec(tableBlock(table))
  if (!m) throw new Error(`no CHECK list for ${table}.${column}`)
  return quoted(m[1])
}

describe('migration 078 ⇔ studio-types parity', () => {
  it.each([
    ['design_inputs', 'kind', DESIGN_INPUT_KINDS],
    ['design_inputs', 'capture_status', CAPTURE_STATUSES],
    ['design_runs', 'status', RUN_STATUSES],
    ['design_runs', 'palette_freedom', PALETTE_FREEDOMS],
    ['design_concepts', 'status', CONCEPT_STATUSES],
    ['design_versions', 'source', VERSION_SOURCES],
    ['design_chat_messages', 'role', CHAT_ROLES],
  ] as const)('%s.%s matches', (table, column, values) => {
    expect(checkList(table, column)).toEqual([...values])
  })

  it('the one-active-run index covers exactly RUN_ACTIVE_STATUSES', () => {
    const m = /design_runs_one_active_per_session\s+ON design_runs \(session_id\)\s+WHERE status IN \(([^)]*)\)/.exec(SQL)
    expect(m).not.toBeNull()
    expect(quoted(m?.[1] ?? '')).toEqual([...RUN_ACTIVE_STATUSES])
  })

  it('versions are unique per session', () => {
    expect(tableBlock('design_versions')).toContain('UNIQUE (session_id, version_no)')
  })

  it.each(TABLES)('%s has RLS and an admin-tier policy', (table) => {
    expect(SQL).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`)
    expect(SQL).toMatch(new RegExp(`CREATE POLICY "Admin tier manages ${table}"[\\s\\S]*?admins\\.role = 'admin'`))
  })

  it.each(TABLES)('%s cascades from sessions', (table) => {
    expect(tableBlock(table)).toContain('REFERENCES sessions(id) ON DELETE CASCADE')
  })
})
