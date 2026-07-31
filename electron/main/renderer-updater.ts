import { createHash, randomUUID, verify } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import extract from 'extract-zip'
import { z } from 'zod'
import type { UpdateDownloadProgress } from '../shared/types.js'
import { compareVersions } from './updater.js'

const RELEASES_API_URL = 'https://api.github.com/repos/guoyiheng/nova/releases?per_page=30'
const RELEASE_DOWNLOAD_PREFIX = '/guoyiheng/nova/releases/download/ui-v'
const MANIFEST_FILE_NAME = '.nova-renderer-update.json'
const MAX_ARCHIVE_SIZE = 50 * 1024 * 1024
const MAX_EXTRACTED_SIZE = 100 * 1024 * 1024

const versionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:\.\d+)?$/)
const rendererVersionSchema = z.string().regex(/^\d+\.\d+\.\d+\.\d+$/)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const relativeFileSchema = z.string().min(1).refine((value) => {
  if (value.includes('\\') || value.startsWith('/') || value.includes('\0')) return false
  const normalized = path.posix.normalize(value)
  return normalized === value && !normalized.startsWith('../') && normalized !== '..'
}, 'Invalid renderer file path')

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  version: rendererVersionSchema,
  shellApiVersion: z.number().int().positive(),
  minAppVersion: versionSchema,
  assetName: z.string().regex(/^Nova-renderer-[0-9.]+\.zip$/),
  assetUrl: z.string().url(),
  sha256: sha256Schema,
  files: z.record(relativeFileSchema, sha256Schema),
  signature: z.string().min(40),
}).strict()

const stateSchema = z.object({
  activeVersion: rendererVersionSchema.optional(),
  pendingVersion: rendererVersionSchema.optional(),
  previousVersion: rendererVersionSchema.optional(),
}).strict()

export type RendererUpdateManifest = z.infer<typeof manifestSchema>
type RendererUpdateState = z.infer<typeof stateSchema>

export type RendererUpdateInfo = {
  currentVersion: string
  latestVersion: string
  releaseName: string
  releaseNotes?: string
  publishedAt?: string
  downloadName: string
  downloadSize?: number
  htmlUrl: string
}

type ReleaseAsset = {
  name: string
  browser_download_url: string
  size?: number
}

type Release = {
  tag_name?: string
  name?: string
  body?: string
  published_at?: string
  html_url?: string
  draft?: boolean
  prerelease?: boolean
  assets?: ReleaseAsset[]
}

export function rendererManifestPayload(manifest: Omit<RendererUpdateManifest, 'signature'>): string {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    version: manifest.version,
    shellApiVersion: manifest.shellApiVersion,
    minAppVersion: manifest.minAppVersion,
    assetName: manifest.assetName,
    assetUrl: manifest.assetUrl,
    sha256: manifest.sha256,
    files: Object.fromEntries(Object.entries(manifest.files).sort(([left], [right]) => (
      left < right ? -1 : left > right ? 1 : 0
    ))),
  })
}

export function verifyRendererManifest(value: unknown, publicKey: string): RendererUpdateManifest {
  const manifest = manifestSchema.parse(value)
  const { signature, ...unsigned } = manifest
  const valid = verify(
    null,
    Buffer.from(rendererManifestPayload(unsigned)),
    publicKey,
    Buffer.from(signature, 'base64'),
  )
  if (!valid) throw new Error('界面更新签名验证失败。')
  if (!isRendererReleaseUrl(manifest.assetUrl)) throw new Error('界面更新下载地址无效。')
  return manifest
}

function isRendererReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith(RELEASE_DOWNLOAD_PREFIX)
  } catch {
    return false
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function collectFiles(directory: string, prefix = ''): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === MANIFEST_FILE_NAME && !prefix) continue
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolutePath = path.join(directory, entry.name)
    const stats = await lstat(absolutePath)
    if (stats.isSymbolicLink()) throw new Error('界面更新包含不受支持的符号链接。')
    if (stats.isDirectory()) Object.assign(files, await collectFiles(absolutePath, relativePath))
    else if (stats.isFile()) files[relativePath] = await hashFile(absolutePath)
    else throw new Error('界面更新包含不受支持的文件类型。')
  }
  return files
}

export async function verifyRendererDirectory(
  directory: string,
  manifest: RendererUpdateManifest,
): Promise<void> {
  const actualFiles = await collectFiles(directory)
  const sortEntries = ([left]: [string, string], [right]: [string, string]) => (
    left < right ? -1 : left > right ? 1 : 0
  )
  const expectedEntries = Object.entries(manifest.files).sort(sortEntries)
  const actualEntries = Object.entries(actualFiles).sort(sortEntries)
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error('界面更新文件校验失败。')
  }
  if (!actualFiles['index.html']) throw new Error('界面更新缺少入口文件。')
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporaryPath, filePath)
}

export class RendererUpdater {
  private readonly updatesDirectory: string
  private readonly statePath: string
  private state: RendererUpdateState = {}
  private availableManifest: RendererUpdateManifest | null = null

  constructor(private readonly options: {
    appVersion: string
    shellApiVersion: number
    publicKey: string
    builtInDirectory: string
    userDataDirectory: string
    fetch?: typeof fetch
  }) {
    this.updatesDirectory = path.join(options.userDataDirectory, 'renderer-updates')
    this.statePath = path.join(this.updatesDirectory, 'state.json')
  }

  private get fetchImpl() {
    return this.options.fetch ?? fetch
  }

  private get builtInVersion() {
    return `${this.options.appVersion}.0`
  }

  private versionDirectory(version: string) {
    return path.join(this.updatesDirectory, version)
  }

  private async saveState() {
    await writeJsonAtomic(this.statePath, this.state)
  }

  private async loadInstalledManifest(version: string) {
    const directory = this.versionDirectory(version)
    const manifest = verifyRendererManifest(await readJson(path.join(directory, MANIFEST_FILE_NAME)), this.options.publicKey)
    if (manifest.version !== version) throw new Error('界面更新版本信息不一致。')
    if (!this.isCompatible(manifest)) throw new Error('界面更新与当前应用不兼容。')
    await verifyRendererDirectory(directory, manifest)
    return manifest
  }

  private isCompatible(manifest: RendererUpdateManifest) {
    return manifest.shellApiVersion === this.options.shellApiVersion
      && compareVersions(this.options.appVersion, manifest.minAppVersion) >= 0
  }

  async initialize(): Promise<void> {
    await mkdir(this.updatesDirectory, { recursive: true })
    try {
      this.state = stateSchema.parse(await readJson(this.statePath))
    } catch {
      this.state = {}
    }

    if (this.state.pendingVersion) {
      await rm(this.versionDirectory(this.state.pendingVersion), { recursive: true, force: true })
      this.state.pendingVersion = undefined
      this.state.previousVersion = undefined
      await this.saveState()
    }

    if (!this.state.activeVersion) return
    try {
      if (compareVersions(this.state.activeVersion, this.builtInVersion) <= 0) throw new Error('Built-in renderer is newer')
      await this.loadInstalledManifest(this.state.activeVersion)
    } catch {
      this.state = {}
      await this.saveState()
    }
  }

  getCurrentVersion() {
    return this.state.pendingVersion ?? this.state.activeVersion ?? this.builtInVersion
  }

  getRendererDirectory() {
    const version = this.state.pendingVersion ?? this.state.activeVersion
    return version ? this.versionDirectory(version) : this.options.builtInDirectory
  }

  hasPendingUpdate() {
    return Boolean(this.state.pendingVersion)
  }

  async checkForUpdate(): Promise<RendererUpdateInfo | null> {
    const response = await this.fetchImpl(RELEASES_API_URL, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        'User-Agent': `Nova/${this.options.appVersion}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!response.ok) throw new Error(`检查界面更新失败 (HTTP ${response.status})`)

    const releases = await response.json() as Release[]
    const candidates = releases
      .filter((release) => !release.draft && release.prerelease && /^ui-v\d+\.\d+\.\d+\.\d+$/.test(release.tag_name ?? ''))
      .sort((left, right) => compareVersions(
        (right.tag_name ?? '').replace(/^ui-v/, ''),
        (left.tag_name ?? '').replace(/^ui-v/, ''),
      ))

    for (const release of candidates) {
      const version = release.tag_name!.replace(/^ui-v/, '')
      if (compareVersions(version, this.getCurrentVersion()) <= 0) continue
      const manifestAsset = release.assets?.find((asset) => asset.name === `Nova-renderer-${version}.json`)
      if (!manifestAsset || !isRendererReleaseUrl(manifestAsset.browser_download_url)) continue

      const manifestResponse = await this.fetchImpl(manifestAsset.browser_download_url, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': `Nova/${this.options.appVersion}` },
      })
      if (!manifestResponse.ok) throw new Error(`读取界面更新失败 (HTTP ${manifestResponse.status})`)
      const manifest = verifyRendererManifest(await manifestResponse.json(), this.options.publicKey)
      if (manifest.version !== version) throw new Error('界面更新版本信息不一致。')
      if (!this.isCompatible(manifest)) continue

      const archiveAsset = release.assets?.find((asset) => (
        asset.name === manifest.assetName && asset.browser_download_url === manifest.assetUrl
      ))
      if (!archiveAsset) throw new Error('界面更新资源不完整。')

      this.availableManifest = manifest
      return {
        currentVersion: this.getCurrentVersion(),
        latestVersion: manifest.version,
        releaseName: release.name || `Nova UI ${manifest.version}`,
        releaseNotes: release.body?.trim() || undefined,
        publishedAt: release.published_at,
        downloadName: archiveAsset.name,
        downloadSize: archiveAsset.size,
        htmlUrl: release.html_url || 'https://github.com/guoyiheng/nova/releases',
      }
    }

    this.availableManifest = null
    return null
  }

  async downloadAndStage(
    onProgress?: (progress: UpdateDownloadProgress) => void,
  ): Promise<{ version: string }> {
    const manifest = this.availableManifest
    if (!manifest) throw new Error('请先检查界面更新。')
    if (compareVersions(manifest.version, this.getCurrentVersion()) <= 0) throw new Error('界面已是最新版本。')

    const response = await this.fetchImpl(manifest.assetUrl, {
      signal: AbortSignal.timeout(120_000),
      headers: { 'User-Agent': `Nova/${this.options.appVersion}` },
    })
    if (!response.ok || !response.body) throw new Error(`下载界面更新失败 (HTTP ${response.status})`)
    const declaredSize = Number(response.headers.get('content-length')) || null
    if (declaredSize && declaredSize > MAX_ARCHIVE_SIZE) throw new Error('界面更新文件过大。')

    const archivePath = path.join(this.updatesDirectory, `${manifest.version}.${randomUUID()}.download`)
    const temporaryDirectory = path.join(this.updatesDirectory, `${manifest.version}.${randomUUID()}.tmp`)
    let transferred = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        transferred += chunk.length
        if (transferred > MAX_ARCHIVE_SIZE) {
          callback(new Error('界面更新文件过大。'))
          return
        }
        onProgress?.({
          transferred,
          total: declaredSize,
          percent: declaredSize ? Math.min(100, Math.round((transferred / declaredSize) * 100)) : null,
        })
        callback(null, chunk)
      },
    })

    try {
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
        meter,
        createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }),
      )
      if (await hashFile(archivePath) !== manifest.sha256) throw new Error('界面更新文件校验失败。')

      await mkdir(temporaryDirectory, { recursive: true })
      let extractedSize = 0
      await extract(archivePath, {
        dir: temporaryDirectory,
        onEntry(entry) {
          const name = entry.fileName
          const normalized = path.posix.normalize(name)
          if (name.includes('\\') || name.startsWith('/') || normalized.startsWith('../') || normalized === '..') {
            throw new Error('界面更新包含非法路径。')
          }
          const mode = (entry.externalFileAttributes >> 16) & 0xffff
          if ((mode & 0xf000) === 0xa000) throw new Error('界面更新包含不受支持的符号链接。')
          extractedSize += entry.uncompressedSize
          if (extractedSize > MAX_EXTRACTED_SIZE) throw new Error('界面更新解压后文件过大。')
        },
      })
      await verifyRendererDirectory(temporaryDirectory, manifest)
      await writeJsonAtomic(path.join(temporaryDirectory, MANIFEST_FILE_NAME), manifest)

      const finalDirectory = this.versionDirectory(manifest.version)
      await rm(finalDirectory, { recursive: true, force: true })
      await rename(temporaryDirectory, finalDirectory)
      this.state = {
        activeVersion: this.state.activeVersion,
        pendingVersion: manifest.version,
        previousVersion: this.state.activeVersion,
      }
      await this.saveState()
      this.availableManifest = null
      return { version: manifest.version }
    } finally {
      await rm(archivePath, { force: true })
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  }

  async confirmPendingUpdate(): Promise<void> {
    if (!this.state.pendingVersion) return
    this.state = {
      activeVersion: this.state.pendingVersion,
      previousVersion: this.state.activeVersion,
    }
    await this.saveState()
  }

  async rollbackPendingUpdate(): Promise<void> {
    const pendingVersion = this.state.pendingVersion
    if (!pendingVersion) return
    this.state = { activeVersion: this.state.activeVersion }
    await this.saveState()
    await rm(this.versionDirectory(pendingVersion), { recursive: true, force: true })
  }
}
