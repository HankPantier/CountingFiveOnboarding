export type MbpSuggestionStatus = 'pending' | 'approved' | 'dismissed' | 'superseded'
export type MbpSuggestionOrigin = 'page_edit' | 'outline_edit' | 'sitemap_confirm' | 'resource' | 'backfill' | 'content_edit' | 'generate_content' | 'site_structure' | 'pre_gen_enrichment' | 'mbp_chat'

// 'set' replaces the field with proposedValue; 'append' adds proposedValue
// (a parsed object) as a new entry to an array field (services, locations…).
export type MbpChangeOp = 'set' | 'append'

// The value at `path` when a suggestion was filed. Approval is refused (409)
// if the live value has changed since, so an old snapshot never clobbers newer
// data. Recorded for whole-array sets and for element changes that must still
// target the same entry (e.g. a niche drop keyed on that niche's name).
export interface MbpSuggestionBase {
  path: string
  value: unknown
}

export interface MbpSuggestionChange {
  op?: MbpChangeOp
  currentValue?: unknown
  proposedValue: unknown
  rationale: string
  base?: MbpSuggestionBase
}

export type MbpSuggestionChanges = Record<string, MbpSuggestionChange>

export interface MbpSuggestion {
  id: string
  session_id: string
  origin: MbpSuggestionOrigin
  source_ref: string | null
  changes: MbpSuggestionChanges
  summary: string
  status: MbpSuggestionStatus
  dedupe_key: string
  created_at: string
  resolved_at: string | null
  resolved_by: string | null
}

export interface SuggestionActionBody {
  action: 'approve' | 'dismiss'
}

// MBP document projection (lib/mbp/build-document.ts)
export interface MbpDocumentField {
  label: string
  fieldPath: string
  value: unknown
  empty: boolean
  // Advisory field origin from _meta.field_provenance (see lib/mbp/provenance.ts).
  // Undefined = seed/unverified. Drives the Review-UI origin badge only.
  provenance?: 'audit' | 'notes' | 'confirmed' | 'thin'
}

export interface MbpDocumentItem {
  heading: string
  fields: MbpDocumentField[]
}

export interface MbpDocumentSection {
  key: string
  title: string
  fields?: MbpDocumentField[]
  items?: MbpDocumentItem[]
  // Stored array length — the append index for "add item", so a new row lands
  // past the last stored slot even when the array has null holes before it.
  nextIndex?: number
}

export interface MbpDocument {
  sections: MbpDocumentSection[]
}
