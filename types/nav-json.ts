// The JSON contract emitted to the deliverable zip as `nav.json`. Consumed by
// the Phase II client-site template's NavBar and Footer.

export type NavItem = {
  label: string
  url: string
  children?: NavItem[]  // one level of nesting only
}

export type NavJson = {
  primary: NavItem[]
  cta?: { label: string; url: string }  // header CTA button (optional)
}
