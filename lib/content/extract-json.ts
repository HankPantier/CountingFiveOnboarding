// Pull the first JSON value out of a model response, tolerating ```json fences
// or surrounding prose. Throws if no parseable JSON is present — a truncated
// (unbalanced) array/object still throws, which is the caller's cue to retry.
export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // fall through to fence/bracket extraction below
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.search(/[[{]/)
  if (start < 0) throw new Error('No JSON found in model output')
  const slice = candidate.slice(start)
  // Walk back from the end to the matching closing bracket for a forgiving parse.
  const lastObj = slice.lastIndexOf('}')
  const lastArr = slice.lastIndexOf(']')
  const end = Math.max(lastObj, lastArr)
  if (end < 0) throw new Error('No JSON terminator in model output')
  return JSON.parse(slice.slice(0, end + 1))
}
