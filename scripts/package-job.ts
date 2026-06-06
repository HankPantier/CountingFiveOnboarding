// Operator tool: assemble the deliverable package for a content job from the
// CLI — same code path as the admin UI's "Assemble Package" button. Run with:
//   npx tsx scripts/package-job.ts <contentJobId>
import { assembleContentPackage } from '../lib/content/package-assembler'

const jobId = process.argv[2]
if (!jobId) throw new Error('usage: package-job.ts <contentJobId>')

async function main() {
  const result = await assembleContentPackage(jobId, {
    name: 'CountingFive Admin (CLI)',
    email: process.env.ADMIN_EMAIL ?? null,
  })

  if (!result.ok) {
    console.error(`FAILED (${result.status}): ${result.error}`)
    if ('unapproved' in result && result.unapproved) {
      console.error('Unapproved pages:', result.unapproved.map((p) => p.page_url).join(', '))
    }
    if ('awaitingClient' in result && result.awaitingClient) {
      console.error('Awaiting client:', result.awaitingClient.map((p) => p.page_url).join(', '))
    }
    process.exit(1)
  }

  console.log('==== PACKAGE ASSEMBLED ====')
  console.log(`zip:     ${result.storagePath} (${result.sizeKB} KB)`)
  console.log(`pages:   ${result.pageCount}`)
  console.log(`assets:  ${result.assetCount}`)
  console.log(`push:    ${result.pushedToRepo ? `${result.pushedToRepo.fileCount} files @ ${result.pushedToRepo.commitSha.slice(0, 7)}` : result.pushError ?? 'no repo linked'}`)
  if (result.redirectIssues.length) {
    console.log(`redirect issues: ${result.redirectIssues.length}`)
    for (const i of result.redirectIssues) console.log(`  [${i.severity}] ${i.oldUrl}: ${i.reason}`)
  }
  if (result.linkWarnings.length) {
    console.log(`link warnings: ${result.linkWarnings.length}`)
    for (const w of result.linkWarnings) console.log(`  ${w}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
