import archiver from 'archiver'
import { PassThrough } from 'stream'

type ZipEntry = {
  path: string
  content: string | Buffer
}

export async function assembleZip(entries: ZipEntry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } })
    const chunks: Buffer[] = []
    const passthrough = new PassThrough()

    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk))
    passthrough.on('end', () => resolve(Buffer.concat(chunks)))
    passthrough.on('error', reject)

    archive.pipe(passthrough)
    archive.on('error', reject)

    for (const entry of entries) {
      archive.append(
        typeof entry.content === 'string' ? Buffer.from(entry.content, 'utf-8') : entry.content,
        { name: entry.path }
      )
    }

    archive.finalize()
  })
}
