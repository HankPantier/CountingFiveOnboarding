// The README.txt shipped inside the export zip — operator import instructions.
// Part of the throwaway Divi/WordPress export bridge (see ./README.md).

export function buildReadme(opts: {
  firmName: string
  filenameBase: string
  pageCount: number
  imageCount: number
  hasLogo: boolean
  navConfigured: boolean
  menuPageCount: number
  notInNavCount: number
  hasSitemapPdf: boolean
  hasSitemapPng: boolean
  fonts: { heading: string; body: string }
}): string {
  const sitemapFiles = [
    opts.hasSitemapPdf ? `  ${opts.filenameBase}-sitemap.pdf         site map: summary, schematic, page directory (URLs + SEO)` : '',
    `  ${opts.filenameBase}-sitemap.svg         site map schematic (opens in any browser)`,
    opts.hasSitemapPng ? `  ${opts.filenameBase}-sitemap.png         site map schematic (image)` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const missing = [!opts.hasSitemapPdf && 'PDF', !opts.hasSitemapPng && 'PNG'].filter(Boolean)
  const navNote =
    !opts.navConfigured
      ? `No navigation was configured in the content editor, so "Primary Menu" imports
EMPTY. Build it by hand in Appearance -> Menus (see the site map for every page).`
      : `The Primary Menu is the navigation from the content editor's Pages sidebar —
same items, order and dropdown nesting (${opts.menuPageCount} page(s) in the menu).`
  return `Divi / WordPress import bundle — ${opts.firmName}
${'='.repeat(60)}

This bundle was generated from the client's approved content as a bridge to
get the site live on the shared Divi boilerplate. It contains:

  ${opts.filenameBase}-divi-customizer.json  client styling (colors, fonts, H1-H6, buttons, brand CSS)
  ${opts.filenameBase}.wxr                ${opts.pageCount} page(s) + the primary nav menu
  ${opts.filenameBase}-divi-library.json  branded Header (Client Center) + Footer
${sitemapFiles}
  README.txt                              this file
${missing.length ? `\n(The site map ${missing.join(' and ')} could not be rendered this time — re-export to get ${missing.length > 1 ? 'them' : 'it'}.)\n` : ''}
Site structure:
${navNote}
${opts.notInNavCount} page(s) are "Not in navigation" in the editor: they import as normal
pages but are NOT assigned to any menu. The site map lists them separately.

Images: ${opts.imageCount} stock image(s) are hot-linked to Pexels CDN URLs — no
media upload is performed. They render immediately but live off-site; re-upload
to the Media Library if you want them permanent.

Styling: the client's palette ships as six Divi Global Colors ("gcid-c5-*"),
and every page module is linked to them, so changing a Global Color updates the
whole site. Fonts: ${opts.fonts.heading} (headings) / ${opts.fonts.body} (body).
H1-H6 follow the client site's responsive type scale. Not carried over: Design
Studio custom CSS and style axes (they target the client site's own markup).

Import steps (start from a FRESH copy of the c5d5 boilerplate):

  0. Styling (do this FIRST):
     Divi -> Theme Customizer -> portability icon (up/down arrows at the top of
     the Customizer sidebar) -> Import -> upload
     ${opts.filenameBase}-divi-customizer.json.
     WARNING: this REPLACES the site's Customizer settings and Additional CSS
     with the boilerplate's plus this client's styling. That is intended on a
     fresh boilerplate copy; don't run it on a site with hand-made Customizer
     changes you want to keep. The client styling sits in a marked
     "Revaltus brand" block at the end of Additional CSS.

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
     - Colors: already set (step 0). Adjust a Global Color in any module's
       color picker to restyle the whole site.

Review each page in the Divi Builder before publishing. Blocks without a
dedicated Divi template (pricing tables, stats bars, forms, testimonials) render
as clean styled text — restyle those by hand if needed.
`
}
