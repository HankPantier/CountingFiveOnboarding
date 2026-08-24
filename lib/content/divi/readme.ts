// The README.txt shipped inside the export zip — operator import instructions.
// Part of the throwaway Divi/WordPress export bridge (see ./README.md).

export function buildReadme(opts: {
  firmName: string
  filenameBase: string
  pageCount: number
  imageCount: number
  hasLogo: boolean
}): string {
  return `Divi / WordPress import bundle — ${opts.firmName}
${'='.repeat(60)}

This bundle was generated from the client's approved content as a bridge to
get the site live on the shared Divi boilerplate. It contains:

  ${opts.filenameBase}.wxr                ${opts.pageCount} page(s) + the primary nav menu
  ${opts.filenameBase}-divi-library.json  branded Header (Client Center) + Footer
  README.txt                              this file

Images: ${opts.imageCount} stock image(s) are hot-linked to Pexels CDN URLs — no
media upload is performed. They render immediately but live off-site; re-upload
to the Media Library if you want them permanent.

Import steps (start from a FRESH copy of the c5d5 boilerplate):

  1. Pages + menu:
     WP Admin -> Tools -> Import -> WordPress -> run the importer ->
     upload ${opts.filenameBase}.wxr. (Install the "WordPress Importer" plugin
     if prompted.) Pages import as DRAFTS so you can review before publishing.

  2. Header / Footer:
     Divi -> Divi Library -> Import & Export (portability icon) -> Import ->
     upload ${opts.filenameBase}-divi-library.json. Two layouts appear:
     "${opts.firmName} — Header" and "${opts.firmName} — Footer".
     Then Divi -> Theme Builder -> assign them to the Default Website Template
     (add global Header / Footer, insert the imported layout in each).

  3. Menu location (IMPORTANT — this also drives the header nav):
     Appearance -> Menus -> select "Primary Menu" -> Manage Locations ->
     assign it to the boilerplate's Primary location. The header's menu module
     has no menu hard-coded, so it shows whatever is on the Primary location —
     assign "Primary Menu" there and the header nav + dropdowns light up. (If it
     doesn't, open the Header layout and pick "Primary Menu" in the menu module.)
     Pages import with their parent/child nesting from the site nav, so child
     page URLs become /parent/child (expected for a freshly stood-up site).

  4. Front page:
     Settings -> Reading -> "Your homepage displays" -> A static page ->
     Homepage = the imported "Home" page.

  5. Brand polish (Customizer / Theme Options):
     - Logo:${opts.hasLogo ? ' a signed logo URL is embedded in the header layout but EXPIRES — re-upload the logo in Appearance -> Customize and swap the header image.' : ' no logo asset was on file — upload one in Appearance -> Customize.'}
     - Global colors: set the Divi global accent to the client's primary color.

Review each page in the Divi Builder before publishing. Blocks without a
dedicated Divi template (pricing tables, stats bars, forms, testimonials) render
as clean styled text — restyle those by hand if needed.
`
}
