import { describe, expect, it } from 'vitest'
import {
  DEPLOY_MANIFEST_PATH,
  gitBlobSha,
  isPackageOwnedPath,
  mergeRedirectsCsv,
  parseDeployManifest,
  planDeployPush,
  previewPreservedFiles,
  SITE_CONFIG_PATHS,
} from './deploy-plan'
import { FONTS_MODULE_PATH } from '@/lib/design/drift'

const sha = (s: string) => gitBlobSha(s)

describe('gitBlobSha', () => {
  it('matches git hash-object for a known blob', () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  })
})

describe('planDeployPush — first deploy', () => {
  it('overlays every entry unguarded and writes a manifest (behaves as before)', () => {
    const plan = planDeployPush({
      entries: [
        { path: 'content/pages/a.md', content: 'A' },
        { path: 'content/brand.json', content: '{}' },
      ],
      draftBlobs: new Map([['content/brand.json', 'template']]),
      baseline: null,
    })
    expect(plan.firstDeploy).toBe(true)
    expect(plan.skipped).toEqual([])
    expect(plan.push.slice(0, 2)).toEqual([
      { path: 'content/pages/a.md', content: 'A' },
      { path: 'content/brand.json', content: '{}' },
    ])
    const manifest = plan.push.find((p) => p.path === DEPLOY_MANIFEST_PATH)
    expect(manifest?.expectedBlobSha).toBeNull()
    expect(parseDeployManifest(String(manifest?.content))?.blobs).toEqual({
      'content/pages/a.md': sha('A'),
      'content/brand.json': sha('{}'),
    })
  })
})

describe('planDeployPush — re-deploy', () => {
  const baseline = {
    'content/pages/untouched.md': sha('old untouched'),
    'content/pages/edited.md': sha('old edited'),
    'content/pages/moved.md': sha('old moved'),
    'content/brand.json': sha('old brand'),
  }
  const draftBlobs = new Map([
    ['content/pages/untouched.md', sha('old untouched')],
    ['content/pages/edited.md', sha('operator edit')],
    ['content/pages/new-location.md', sha('old moved')],
    ['content/pages/foreign.md', sha('someone else')],
    ['content/brand.json', sha('studio palette')],
    ['content/design.json', sha('studio tokens')],
    [DEPLOY_MANIFEST_PATH, 'manifestsha'],
  ])

  const plan = planDeployPush({
    entries: [
      { path: 'content/pages/untouched.md', content: 'new untouched' },
      { path: 'content/pages/edited.md', content: 'new edited' },
      { path: 'content/pages/moved.md', content: 'new moved' },
      { path: 'content/pages/foreign.md', content: 'generated foreign' },
      { path: 'content/pages/brand-new.md', content: 'fresh page' },
      { path: 'content/brand.json', content: 'pipeline brand' },
      { path: 'content/design.json', content: 'pipeline tokens' },
      { path: 'content/nav.json', content: 'nav' },
    ],
    draftBlobs,
    baseline,
  })
  const pushed = (p: string) => plan.push.find((e) => e.path === p)

  it('pushes an untouched generated page guarded by its draft blob', () => {
    expect(plan.firstDeploy).toBe(false)
    expect(pushed('content/pages/untouched.md')).toEqual({
      path: 'content/pages/untouched.md',
      content: 'new untouched',
      expectedBlobSha: sha('old untouched'),
    })
  })

  it('creates a never-seen path guarded as must-not-exist', () => {
    expect(pushed('content/pages/brand-new.md')?.expectedBlobSha).toBeNull()
  })

  it('skips pages edited, moved, or created on draft and reports them', () => {
    expect(pushed('content/pages/edited.md')).toBeUndefined()
    expect(pushed('content/pages/moved.md')).toBeUndefined()
    expect(pushed('content/pages/foreign.md')).toBeUndefined()
    expect(plan.skipped).toEqual(
      expect.arrayContaining([
        { path: 'content/pages/edited.md', reason: 'edited' },
        { path: 'content/pages/moved.md', reason: 'removed' },
        { path: 'content/pages/foreign.md', reason: 'created' },
      ])
    )
  })

  it('never overwrites existing site config (Design Studio brand/design survive)', () => {
    expect(pushed('content/brand.json')).toBeUndefined()
    expect(pushed('content/design.json')).toBeUndefined()
    expect(plan.skipped).toEqual(
      expect.arrayContaining([
        { path: 'content/brand.json', reason: 'site-config' },
        { path: 'content/design.json', reason: 'site-config' },
      ])
    )
    // Absent config is still created.
    expect(pushed('content/nav.json')?.expectedBlobSha).toBeNull()
  })

  it('keeps the last-written blob for skipped paths so a later deploy still skips them', () => {
    const manifest = pushed(DEPLOY_MANIFEST_PATH)
    expect(manifest?.expectedBlobSha).toBe('manifestsha')
    const blobs = parseDeployManifest(String(manifest?.content))?.blobs ?? {}
    expect(blobs['content/pages/edited.md']).toBe(sha('old edited'))
    expect(blobs['content/pages/untouched.md']).toBe(sha('new untouched'))
    expect(blobs['content/pages/foreign.md']).toBeUndefined()

    // Next deploy: the operator's edit is still on draft → still skipped.
    const again = planDeployPush({
      entries: [{ path: 'content/pages/edited.md', content: 'newer edited' }],
      draftBlobs: new Map([['content/pages/edited.md', sha('operator edit')]]),
      baseline: blobs,
    })
    expect(again.push.map((p) => p.path)).toEqual([DEPLOY_MANIFEST_PATH])
    expect(again.skipped).toEqual([{ path: 'content/pages/edited.md', reason: 'edited' }])
  })

  it('drops no-op writes whose content already matches draft', () => {
    const p = planDeployPush({
      entries: [{ path: 'content/pages/same.md', content: 'same' }],
      draftBlobs: new Map([['content/pages/same.md', sha('same')]]),
      baseline: {},
    })
    expect(p.push.map((e) => e.path)).toEqual([DEPLOY_MANIFEST_PATH])
    expect(p.skipped).toEqual([])
  })
})

describe('redirects.csv on re-deploy', () => {
  const header = '# comment\nold_url,new_url,status_code,reason\n'
  const generated = header + '/old-a,/a,301,moved\n/old-b,/b,301,moved\n/old-c,/c,301,moved\n'
  const lastDeployed = header + '/old-a,/a,301,moved\n/old-b,/b,301,moved\n'
  // The editor added a move 301 and the operator deleted /old-b.
  const draft = header + '/old-a,/a,301,moved\n/services/x,/x,301,page moved\n'

  it('merges instead of replacing: keeps editor rows, adds new rows, respects deletions', () => {
    const merged = mergeRedirectsCsv(draft, generated, lastDeployed)
    expect(merged).toBe(draft + '/old-c,/c,301,moved\n')
  })

  it('plans the merged file guarded by the draft blob', () => {
    const plan = planDeployPush({
      entries: [{ path: 'content/redirects.csv', content: generated }],
      draftBlobs: new Map([['content/redirects.csv', sha(draft)]]),
      baseline: { 'content/redirects.csv': sha(lastDeployed) },
      redirects: { draft, lastDeployed },
    })
    expect(plan.push[0]).toEqual({
      path: 'content/redirects.csv',
      content: draft + '/old-c,/c,301,moved\n',
      expectedBlobSha: sha(draft),
    })
  })

  it('treats quoted old_url fields as the same key', () => {
    const merged = mergeRedirectsCsv(header + '"/a,b",/x,301,r\n', header + '"/a,b",/y,301,r\n', null)
    expect(merged).toBe(header + '"/a,b",/x,301,r\n')
  })
})

describe('previewPreservedFiles', () => {
  it('is empty before the first deploy', () => {
    expect(previewPreservedFiles(new Map([['content/brand.json', 'x']]), null)).toEqual([])
  })

  it('lists existing site config and generated files changed since the last package', () => {
    const out = previewPreservedFiles(
      new Map([
        ['content/brand.json', 'b'],
        ['content/pages/a.md', 'edited'],
        ['content/pages/b.md', 'same'],
      ]),
      { 'content/pages/a.md': 'orig', 'content/pages/b.md': 'same', 'content/pages/c.md': 'gone' }
    )
    expect(out).toEqual([
      { path: 'content/brand.json', reason: 'site-config' },
      { path: 'content/pages/a.md', reason: 'edited' },
      { path: 'content/pages/c.md', reason: 'removed' },
    ])
  })
})

describe('isPackageOwnedPath', () => {
  it('limits a legacy baseline to paths a package ships', () => {
    expect(isPackageOwnedPath('content/pages/services/tax.md')).toBe(true)
    expect(isPackageOwnedPath('content/nav.json')).toBe(true)
    expect(isPackageOwnedPath('public/content-assets/logo.png')).toBe(true)
    expect(isPackageOwnedPath('content/posts/hello.md')).toBe(false)
    expect(isPackageOwnedPath('content/drafts/pages/x.md')).toBe(false)
    expect(isPackageOwnedPath('src/styles/theme.css')).toBe(false)
  })
})

describe('theme files as site config (Task 18b)', () => {
  const THEME = 'src/styles/theme.css'
  const FONTS = 'src/app/fonts.generated.ts'

  it('the fonts-module literal equals FONTS_MODULE_PATH', () => {
    expect(FONTS).toBe(FONTS_MODULE_PATH)
    expect(SITE_CONFIG_PATHS.has(FONTS_MODULE_PATH)).toBe(true)
    expect(SITE_CONFIG_PATHS.has(THEME)).toBe(true)
  })

  it('a first deploy overlays theme.css + the fonts module over the template defaults and records their shas', () => {
    const plan = planDeployPush({
      entries: [
        { path: 'content/pages/a.md', content: 'A' },
        { path: THEME, content: 'generated css' },
        { path: FONTS, content: 'synced fonts' },
      ],
      draftBlobs: new Map([
        [THEME, sha('template css')],
        [FONTS, sha('default fonts')],
      ]),
      baseline: null,
    })
    expect(plan.firstDeploy).toBe(true)
    expect(plan.push).toEqual(
      expect.arrayContaining([
        { path: THEME, content: 'generated css' },
        { path: FONTS, content: 'synced fonts' },
      ])
    )
    // Unguarded overlay: no expectedBlobSha on either.
    for (const p of [THEME, FONTS]) expect(plan.push.find((e) => e.path === p)).not.toHaveProperty('expectedBlobSha')
    const manifest = plan.push.find((e) => e.path === DEPLOY_MANIFEST_PATH)
    expect(parseDeployManifest(String(manifest?.content))?.blobs).toMatchObject({
      [THEME]: sha('generated css'),
      [FONTS]: sha('synced fonts'),
    })
  })

  it('a later deploy never overwrites a fonts module present on draft', () => {
    const plan = planDeployPush({
      entries: [{ path: FONTS, content: 'pipeline fonts' }],
      draftBlobs: new Map([[FONTS, sha('studio fonts')]]),
      baseline: { [FONTS]: sha('first deploy fonts') },
    })
    expect(plan.push.find((e) => e.path === FONTS)).toBeUndefined()
    expect(plan.skipped).toEqual([{ path: FONTS, reason: 'site-config' }])
  })

  it('a later deploy with identical module content neither writes nor reports it', () => {
    const plan = planDeployPush({
      entries: [{ path: FONTS, content: 'same fonts' }],
      draftBlobs: new Map([[FONTS, sha('same fonts')]]),
      baseline: {},
    })
    expect(plan.push.find((e) => e.path === FONTS)).toBeUndefined()
    expect(plan.skipped).toEqual([])
  })

  it('a later deploy creates the module when it is absent on draft (must-not-exist guard)', () => {
    const plan = planDeployPush({
      entries: [{ path: FONTS, content: 'pipeline fonts' }],
      draftBlobs: new Map(),
      baseline: {},
    })
    expect(plan.push.find((e) => e.path === FONTS)).toEqual({ path: FONTS, content: 'pipeline fonts', expectedBlobSha: null })
  })

  it('previewPreservedFiles lists the module as site-config on a previously deployed draft', () => {
    const out = previewPreservedFiles(new Map([[FONTS, 'f'], [THEME, 't']]), {})
    expect(out).toEqual([
      { path: FONTS, reason: 'site-config' },
      { path: THEME, reason: 'site-config' },
    ])
  })
})
