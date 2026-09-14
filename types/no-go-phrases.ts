// Request/response contracts for the admin no-go-phrases registry
// (Admin → No-go phrases). The global, admin-curated list of phrases that must
// never appear in any AI-generated content across all client sites.

export interface NoGoPhraseSummary {
  id: string
  phrase: string
  note: string | null
  created_at: string
}

export interface ListNoGoPhrasesResponse {
  phrases: NoGoPhraseSummary[]
}

export interface CreateNoGoPhraseRequest {
  phrase: string
  note?: string
}

export interface CreateNoGoPhraseResponse {
  phrase: NoGoPhraseSummary
}

export interface UpdateNoGoPhraseRequest {
  phrase?: string
  note?: string | null
}

// One offending page found by the "scan existing content" pass.
export interface NoGoScanHit {
  sessionId: string
  pageTitle: string
  pageUrl: string
  matchedPhrases: string[]
}

export interface NoGoScanResponse {
  scanned: number
  hits: NoGoScanHit[]
}
