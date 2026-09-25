// Pure. Fence untrusted text (admin brief, admin input notes, page HTML) as
// DATA. Any occurrence of the fence tag inside the text is neutralized so the
// content can't close the fence early and smuggle instructions after it.
export function fenceData(tag: string, text: string): string {
  const safe = text.split(tag).join('[fence removed]')
  return `<<<${tag}\n${safe}\n${tag}`
}
