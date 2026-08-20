// The JSON contract emitted to the deliverable zip as `brand.json`. Consumed by
// the Phase II client-site template to render firm identity, contact info,
// social links, and certifications. Distinct from `brand.md` (narrative for
// LLM crawlers via llms-full.txt).

export type SocialLink = {
  platform: 'linkedin' | 'facebook' | 'twitter' | 'instagram' | 'youtube' | 'appleMaps' | 'googleMaps' | 'other'
  url: string
}

export type Address = {
  street: string
  line2?: string
  city: string
  state: string
  zip: string
}

export type Certification = {
  src: string   // filename or absolute URL of the logo
  alt: string
  url?: string  // organization website
}

export type BrandJson = {
  firm: {
    name: string
    tagline?: string
    foundingYear?: string
  }
  contact: {
    address?: Address
    phone?: string
    fax?: string
    email?: string
    hours?: Record<string, string>  // e.g. { Mon: '9–5', Tue: '9–5', ... }
  }
  palette: {
    primary: string
    secondary: string
    complementary: string
    action: string
    nearBlack: string
    nearWhite: string
  }
  social: SocialLink[]
  certifications: Certification[]
  logo: {
    primary: string  // filename in /content/assets/
    alt: string
  }
}
