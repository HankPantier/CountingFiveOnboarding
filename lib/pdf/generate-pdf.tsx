import { Document, renderToBuffer } from '@react-pdf/renderer'
import { CoverPage } from './components/CoverPage'
import { DataPage, Field, Subheading } from './components/DataPage'
import type { Database } from '@/types/database'

type Session = Database['public']['Tables']['sessions']['Row']
type SchemaObj = Record<string, unknown>

export async function generateIntakePdf(session: Session): Promise<Buffer> {
  const s = (session.schema_data as SchemaObj) ?? {}
  const contact    = s.contact    as Record<string, unknown> | undefined
  const business   = s.business   as Record<string, unknown> | undefined
  const brand      = s.brand      as Record<string, unknown> | undefined
  const technical  = s.technical  as Record<string, unknown> | undefined
  const culture    = s.culture    as Record<string, unknown> | undefined
  const assets     = s.assets     as Record<string, unknown> | undefined
  const additional = s.additional as Record<string, unknown> | undefined
  const locations  = (s.locations as Record<string, unknown>[]) ?? []
  const team       = (s.team      as Record<string, unknown>[]) ?? []
  const services   = (s.services  as Record<string, unknown>[]) ?? []
  const niches     = (s.niches    as Record<string, unknown>[]) ?? []

  const doc = (
    <Document title={`Intake Summary — ${(business?.name as string) ?? session.website_url}`}>
      <CoverPage schema={s} approvedAt={session.approved_at} />

      <DataPage title="Locations & Technical">
        {locations.map((loc, i) => (
          <Subheading key={i}>{(loc.name as string) || `Location ${i + 1}`}</Subheading>
        ))}
        {locations.map((loc, i) => (
          <Field key={`addr-${i}`} label="Address" value={[loc.street, loc.city, loc.state, loc.zip].filter(Boolean).join(', ')} />
        ))}
        <Subheading>Domain &amp; Hosting</Subheading>
        <Field label="Registrar"          value={technical?.registrar as string} />
        <Field label="Registration Date"  value={technical?.registrationDate as string} />
        <Field label="Expiry Date"        value={technical?.expiryDate as string} />
        <Field label="Hosting Provider"   value={technical?.hostingProvider as string} />
        <Field label="Registrar Username" value={technical?.registrarUsername as string} />
      </DataPage>

      <DataPage title="Team">
        {team.map((member, i) => (
          <>
            <Subheading key={`name-${i}`}>{member.name as string}</Subheading>
            <Field key={`title-${i}`}  label="Title"           value={member.title as string} />
            <Field key={`cert-${i}`}   label="Certifications"  value={Array.isArray(member.certifications) ? (member.certifications as string[]).join(', ') : undefined} />
            <Field key={`spec-${i}`}   label="Specializations" value={Array.isArray(member.specializations) ? (member.specializations as string[]).join(', ') : undefined} />
            <Field key={`bio-${i}`}    label="Bio"             value={member.bio as string} />
          </>
        ))}
      </DataPage>

      <DataPage title="Services & Industries Served">
        <Subheading>Services</Subheading>
        {services.map((svc, i) => (
          <Field key={i} label={svc.name as string} value={svc.description as string} />
        ))}
        <Subheading>Industries Served</Subheading>
        {niches.map((niche, i) => (
          <>
            <Field key={`niche-${i}`} label={niche.name as string} value={niche.description as string} />
            <Field key={`icp-${i}`}   label="Ideal Client"         value={niche.icp as string} />
          </>
        ))}
      </DataPage>

      <DataPage title="Business &amp; Positioning">
        <Field label="Founded"              value={business?.foundingYear as string} />
        <Field label="Tagline"              value={business?.tagline as string} />
        <Field label="Positioning Option"   value={business?.positioningOption as string} />
        <Field label="Positioning Statement" value={business?.positioningStatement as string} />
        <Field label="Differentiators"      value={business?.differentiators as string} />
        <Field label="Firm History"         value={business?.firmHistory as string} />
        <Field label="Geographic Scope"     value={business?.geographicScope as string} />
        <Field label="How Clients Find Them" value={business?.howClientsFind as string} />
      </DataPage>

      <DataPage title="Brand &amp; Tone">
        <Subheading>Voice</Subheading>
        <Field label="Current Voice"      value={brand?.currentTone as string} />
        <Field label="Aspirational Voice" value={brand?.aspirationalTone as string} />
        <Field label="Tone Adjectives"    value={Array.isArray(brand?.toneAdjectives) ? (brand.toneAdjectives as string[]).join(', ') : undefined} />
        <Field label="Avoid"              value={Array.isArray(brand?.toneToAvoid) ? (brand.toneToAvoid as string[]).join(', ') : undefined} />
        <Field label="Voice Example"      value={brand?.voiceExample as string} />
        <Field label="Brand Personality"  value={brand?.brandPersonality as string} />
        <Subheading>Visual Identity</Subheading>
        <Field label="Brand Colors"       value={brand?.primaryColors as string} />
        <Field label="Typography"         value={brand?.typography as string} />
        <Field label="Logo Style"         value={brand?.logoStyle as string} />
        <Field label="Has Brand Guide"    value={brand?.hasBrandGuide ? 'Yes' : undefined} />
      </DataPage>

      <DataPage title="Culture, Assets &amp; Additional">
        <Field label="Mission / Values"  value={culture?.missionVisionValues as string} />
        <Field label="Team Culture"      value={culture?.teamDescription as string} />
        <Field label="Social Channels"   value={Array.isArray(culture?.socialMediaChannels) ? (culture.socialMediaChannels as string[]).join(', ') : undefined} />
        <Subheading>Assets</Subheading>
        <Field label="Headshots"         value={Array.isArray(assets?.headshotsAvailable) ? (assets.headshotsAvailable as string[]).join(', ') : undefined} />
        <Field label="Office Photos"     value={assets?.officePhotosAvailable ? 'Yes' : undefined} />
        <Field label="Testimonials"      value={Array.isArray(assets?.testimonialsAvailable) ? (assets.testimonialsAvailable as string[]).join('; ') : undefined} />
        <Field label="Additional Notes"  value={additional?.otherDetails as string} />
      </DataPage>
    </Document>
  )

  return renderToBuffer(doc)
}
