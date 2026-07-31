import { app, shell } from 'electron'
import { createWriteStream } from 'node:fs'
import { access, chmod, mkdir, rename, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import type { UpdateCheckResult, UpdateDownloadProgress, UpdateDownloadResult } from '../shared/types.js'

const RELEASES_API_URL = 'https://api.github.com/repos/guoyiheng/nova/releases/latest'
const RELEASES_URL = 'https://github.com/guoyiheng/nova/releases'
const RELEASE_DOWNLOAD_PREFIX = '/guoyiheng/nova/releases/download/'

export type ReleaseAsset = {
  name: string
  browser_download_url: string
  size?: number
}

type ParsedVersion = {
  numbers: number[]
  prerelease: string[]
}

function parseVersion(value: string): ParsedVersion {
  const normalized = value.trim().replace(/^v/i, '')
  const [core = '', prerelease = ''] = normalized.split('+')[0]!.split('-', 2)
  const numbers = core.split('.').map((part) => Number.parseInt(part, 10) || 0)
  return { numbers, prerelease: prerelease ? prerelease.split('.') : [] }
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  const length = Math.max(a.numbers.length, b.numbers.length)

  for (let index = 0; index < length; index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0)
    if (difference !== 0) return difference > 0 ? 1 : -1
  }

  if (!a.prerelease.length && !b.prerelease.length) return 0
  if (!a.prerelease.length) return 1
  if (!b.prerelease.length) return -1

  const prereleaseLength = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1
    if (leftNumber !== null) return -1
    if (rightNumber !== null) return 1
    return leftPart.localeCompare(rightPart) > 0 ? 1 : -1
  }

  return 0
}

function assetArchitecture(name: string): NodeJS.Architecture | null {
  if (/(?:^|[-_.])(arm64|aarch64)(?:[-_.]|$)/i.test(name)) return 'arm64'
  if (/(?:^|[-_.])(x64|x86_64|amd64)(?:[-_.]|$)/i.test(name)) return 'x64'
  return null
}

export function selectReleaseAsset(
  assets: ReleaseAsset[],
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): ReleaseAsset | undefined {
  const extensionScores: Partial<Record<NodeJS.Platform, Array<[RegExp, number]>>> = {
    darwin: [[/\.dmg$/i, 30], [/\.zip$/i, 20], [/\.pkg$/i, 10]],
    win32: [[/\.exe$/i, 30], [/\.msi$/i, 20]],
    linux: [[/\.AppImage$/i, 30], [/\.deb$/i, 20], [/\.rpm$/i, 10]],
  }
  const candidates = extensionScores[platform] ?? []

  return assets
    .map((asset) => {
      const extension = candidates.find(([pattern]) => pattern.test(asset.name))
      if (!extension) return null

      const assetArch = assetArchitecture(asset.name)
      if (assetArch && assetArch !== architecture) return null

      const lowerName = asset.name.toLocaleLowerCase()
      if (platform === 'darwin' && /\.(zip)$/i.test(asset.name) && /(win|linux)/.test(lowerName)) return null
      const archScore = assetArch === architecture ? 100 : 0
      return { asset, score: archScore + extension[1] }
    })
    .filter((item): item is { asset: ReleaseAsset; score: number } => item !== null)
    .sort((a, b) => b.score - a.score)[0]?.asset
}

export async function checkAppUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  let response: Response
  try {
    response = await fetch(RELEASES_API_URL, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        'User-Agent': `Nova/${currentVersion}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  } catch {
    throw new Error('无法连接更新服务，请检查网络后重试。')
  }

  if (response.status === 404) {
    return { hasUpdate: false, currentVersion, latestVersion: currentVersion, htmlUrl: RELEASES_URL }
  }
  if (!response.ok) throw new Error(`检查更新失败 (HTTP ${response.status})`)

  const data = (await response.json()) as {
    tag_name?: string
    name?: string
    body?: string
    published_at?: string
    html_url?: string
    assets?: ReleaseAsset[]
  }
  const latestVersion = (data.tag_name || '').replace(/^v/i, '')
  if (!latestVersion) throw new Error('最新版本信息不完整，请稍后重试。')

  const asset = selectReleaseAsset(data.assets ?? [], process.platform, process.arch)
  return {
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    currentVersion,
    latestVersion,
    releaseName: data.name || `Nova ${latestVersion}`,
    releaseNotes: data.body?.trim() || undefined,
    publishedAt: data.published_at,
    downloadUrl: asset?.browser_download_url,
    downloadName: asset?.name,
    downloadSize: asset?.size,
    htmlUrl: data.html_url || RELEASES_URL,
  }
}

function isReleaseDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith(RELEASE_DOWNLOAD_PREFIX)
  } catch {
    return false
  }
}

async function availableDownloadPath(directory: string, fileName: string): Promise<string> {
  const parsed = path.parse(fileName)
  for (let copy = 0; ; copy += 1) {
    const suffix = copy === 0 ? '' : `-${copy}`
    const candidate = path.join(directory, `${parsed.name}${suffix}${parsed.ext}`)
    try {
      await access(candidate)
    } catch {
      return candidate
    }
  }
}

let downloadedUpdatePath: string | null = null

export async function downloadAppUpdate(
  downloadUrl: string,
  onProgress?: (progress: UpdateDownloadProgress) => void,
): Promise<UpdateDownloadResult> {
  if (!isReleaseDownloadUrl(downloadUrl)) throw new Error('未找到适用于当前设备的安装包。')

  const response = await fetch(downloadUrl, { headers: { 'User-Agent': `Nova/${app.getVersion()}` } })
  if (!response.ok || !response.body) throw new Error(`下载更新失败 (HTTP ${response.status})`)

  const directory = path.join(app.getPath('downloads'), 'Nova')
  await mkdir(directory, { recursive: true })
  const url = new URL(downloadUrl)
  const sourceName = decodeURIComponent(path.basename(url.pathname))
  const fileName = sourceName.replace(/[^a-zA-Z0-9._-]/g, '-') || `Nova-${Date.now()}`
  const destination = await availableDownloadPath(directory, fileName)
  const temporary = `${destination}.download`
  const total = Number(response.headers.get('content-length')) || null
  let transferred = 0

  const readable = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
  readable.on('data', (chunk: Buffer) => {
    transferred += chunk.length
    onProgress?.({
      transferred,
      total,
      percent: total ? Math.min(100, Math.round((transferred / total) * 100)) : null,
    })
  })

  try {
    await pipeline(readable, createWriteStream(temporary, { flags: 'wx' }))
    await rename(temporary, destination)
    if (process.platform === 'linux' && destination.endsWith('.AppImage')) await chmod(destination, 0o755)
    downloadedUpdatePath = destination
    return { status: 'downloaded', filePath: destination }
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export async function openDownloadedUpdate(): Promise<void> {
  if (!downloadedUpdatePath) throw new Error('请先下载更新安装包。')
  const error = await shell.openPath(downloadedUpdatePath)
  if (error) throw new Error(`无法打开安装包：${error}`)
}
