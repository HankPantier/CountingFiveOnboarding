export type PaletteSwatch = { hex: string; name: string }

export type PaletteData = {
  primary: PaletteSwatch
  secondary: PaletteSwatch
  complementary: PaletteSwatch
  action: PaletteSwatch
  nearBlack: PaletteSwatch
  nearWhite: PaletteSwatch
}
