export type Roundness = 'sharp' | 'soft' | 'pill'
export type Density = 'tight' | 'balanced' | 'airy'
export type VisualFeel = 'classic' | 'modern' | 'editorial'

export type DesignTokens = {
  typePairing: {
    id: string
    headingFont: string
    bodyFont: string
    label: string
  }
  roundness: Roundness
  density: Density
  visualFeel: VisualFeel
}
