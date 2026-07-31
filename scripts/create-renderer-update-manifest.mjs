import { createHash, createPrivateKey, sign } from 'node:crypto'
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const version = process.env.RENDERER_VERSION || ''
const tag = process.env.RENDERER_TAG || ''
const privateKeyPem = process.env.NOVA_RENDERER_UPDATE_PRIVATE_KEY || ''
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const config = JSON.parse(await readFile(path.join(root, 'renderer-update.json'), 'utf8'))
const distDirectory = path.resolve(process.env.RENDERER_DIST_DIR || path.join(root, 'dist'))
const outputDirectory = path.resolve(process.env.RENDERER_OUTPUT_DIR || path.join(root, 'release'))

if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid renderer version')
if (tag !== `ui-v${version}`) throw new Error('Renderer tag and version do not match')
if (!version.startsWith(`${packageJson.version}.`)) {
  throw new Error(`Renderer version must target Nova ${packageJson.version}`)
}
if (!privateKeyPem) throw new Error('NOVA_RENDERER_UPDATE_PRIVATE_KEY is not configured')

const assetName = `Nova-renderer-${version}.zip`
const assetPath = path.join(outputDirectory, assetName)
const manifestPath = path.join(outputDirectory, `Nova-renderer-${version}.json`)
const assetUrl = `https://github.com/guoyiheng/nova/releases/download/${tag}/${assetName}`

function digest(content) {
  return createHash('sha256').update(content).digest('hex')
}

async function collectFiles(directory, prefix = '') {
  const files = {}
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolutePath = path.join(directory, entry.name)
    const stats = await lstat(absolutePath)
    if (stats.isSymbolicLink()) throw new Error(`Renderer output contains a symlink: ${relativePath}`)
    if (stats.isDirectory()) Object.assign(files, await collectFiles(absolutePath, relativePath))
    else if (stats.isFile()) files[relativePath] = digest(await readFile(absolutePath))
    else throw new Error(`Unsupported renderer output: ${relativePath}`)
  }
  return files
}

const unsigned = {
  schemaVersion: 1,
  version,
  shellApiVersion: config.shellApiVersion,
  minAppVersion: packageJson.version,
  assetName,
  assetUrl,
  sha256: digest(await readFile(assetPath)),
  files: Object.fromEntries(Object.entries(await collectFiles(distDirectory)).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ))),
}
const payload = JSON.stringify(unsigned)
const signature = sign(null, Buffer.from(payload), createPrivateKey(privateKeyPem)).toString('base64')
await writeFile(manifestPath, `${JSON.stringify({ ...unsigned, signature }, null, 2)}\n`)
console.log(`Created signed renderer update ${version}`)
