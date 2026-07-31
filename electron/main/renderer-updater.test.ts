import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getVersion: () => process.env.npm_package_version || '0.0.0',
  },
  shell: {
    openPath: async () => '',
  },
}))

import {
  RendererUpdater,
  rendererManifestPayload,
  verifyRendererDirectory,
  verifyRendererManifest,
  type RendererUpdateManifest,
} from './renderer-updater.js'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const execFileAsync = promisify(execFile)
const appVersion = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')).version as string
const rendererVersion = `${appVersion}.1`
const assetUrl = `https://github.com/guoyiheng/nova/releases/download/ui-v${rendererVersion}/Nova-renderer-${rendererVersion}.zip`

function sha256(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

function zipSingleFile(name: string, content: string) {
  const fileName = Buffer.from(name)
  const data = Buffer.from(content)
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  crc = (crc ^ 0xffffffff) >>> 0

  const localHeader = Buffer.alloc(30)
  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt16LE(20, 4)
  localHeader.writeUInt32LE(crc, 14)
  localHeader.writeUInt32LE(data.length, 18)
  localHeader.writeUInt32LE(data.length, 22)
  localHeader.writeUInt16LE(fileName.length, 26)

  const centralHeader = Buffer.alloc(46)
  centralHeader.writeUInt32LE(0x02014b50, 0)
  centralHeader.writeUInt16LE(20, 4)
  centralHeader.writeUInt16LE(20, 6)
  centralHeader.writeUInt32LE(crc, 16)
  centralHeader.writeUInt32LE(data.length, 20)
  centralHeader.writeUInt32LE(data.length, 24)
  centralHeader.writeUInt16LE(fileName.length, 28)

  const localRecord = Buffer.concat([localHeader, fileName, data])
  const centralRecord = Buffer.concat([centralHeader, fileName])
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(centralRecord.length, 12)
  end.writeUInt32LE(localRecord.length, 16)
  return Buffer.concat([localRecord, centralRecord, end])
}

function signedManifest(overrides: Partial<Omit<RendererUpdateManifest, 'signature'>> = {}): RendererUpdateManifest {
  const unsigned = {
    schemaVersion: 1 as const,
    version: rendererVersion,
    shellApiVersion: 1,
    minAppVersion: appVersion,
    assetName: `Nova-renderer-${rendererVersion}.zip`,
    assetUrl,
    sha256: sha256('archive'),
    files: { 'assets/index.js': sha256('script'), 'index.html': sha256('html') },
    ...overrides,
  }
  return {
    ...unsigned,
    signature: sign(null, Buffer.from(rendererManifestPayload(unsigned)), privateKey).toString('base64'),
  }
}

describe('renderer update manifest', () => {
  it('verifies an authentic signed manifest', () => {
    expect(verifyRendererManifest(signedManifest(), publicKeyPem).version).toBe(rendererVersion)
  })

  it('rejects manifest fields changed after signing', () => {
    const manifest = signedManifest()
    expect(() => verifyRendererManifest({ ...manifest, shellApiVersion: 2 }, publicKeyPem))
      .toThrow('界面更新签名验证失败')
  })

  it('rejects download URLs outside the renderer release channel', () => {
    const manifest = signedManifest({ assetUrl: 'https://example.com/update.zip' })
    expect(() => verifyRendererManifest(manifest, publicKeyPem)).toThrow('界面更新下载地址无效')
  })

  it('verifies a manifest produced by the release script', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nova-renderer-script-'))
    const distDirectory = path.join(directory, 'dist')
    const outputDirectory = path.join(directory, 'release')
    await mkdir(distDirectory)
    await mkdir(outputDirectory)
    await writeFile(path.join(distDirectory, 'index.html'), 'html')
    await writeFile(path.join(outputDirectory, `Nova-renderer-${rendererVersion}.zip`), 'archive')

    try {
      await execFileAsync(process.execPath, ['scripts/create-renderer-update-manifest.mjs'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NOVA_RENDERER_UPDATE_PRIVATE_KEY: privateKeyPem,
          RENDERER_VERSION: rendererVersion,
          RENDERER_TAG: `ui-v${rendererVersion}`,
          RENDERER_DIST_DIR: distDirectory,
          RENDERER_OUTPUT_DIR: outputDirectory,
        },
      })
      const manifest = JSON.parse(await readFile(
        path.join(outputDirectory, `Nova-renderer-${rendererVersion}.json`),
        'utf8',
      ))
      expect(verifyRendererManifest(manifest, publicKeyPem)).toMatchObject({
        version: rendererVersion,
        files: { 'index.html': sha256('html') },
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('renderer directory verification', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'nova-renderer-test-'))
    await mkdir(path.join(directory, 'assets'))
    await writeFile(path.join(directory, 'index.html'), 'html')
    await writeFile(path.join(directory, 'assets', 'index.js'), 'script')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('accepts the exact signed file set', async () => {
    await expect(verifyRendererDirectory(directory, signedManifest())).resolves.toBeUndefined()
  })

  it('rejects a modified renderer file', async () => {
    await writeFile(path.join(directory, 'index.html'), 'tampered')
    await expect(verifyRendererDirectory(directory, signedManifest())).rejects.toThrow('界面更新文件校验失败')
  })

  it('rejects additional unsigned files', async () => {
    await writeFile(path.join(directory, 'injected.js'), 'injected')
    await expect(verifyRendererDirectory(directory, signedManifest())).rejects.toThrow('界面更新文件校验失败')
  })
})

describe('RendererUpdater.checkForUpdate', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'nova-renderer-manager-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  function updaterFor(manifest: RendererUpdateManifest) {
    const releases = [{
      tag_name: `ui-v${rendererVersion}`,
      name: `Nova UI ${rendererVersion}`,
      body: '界面更新',
      prerelease: true,
      draft: false,
      html_url: `https://github.com/guoyiheng/nova/releases/tag/ui-v${rendererVersion}`,
      assets: [
        { name: `Nova-renderer-${rendererVersion}.json`, browser_download_url: `https://github.com/guoyiheng/nova/releases/download/ui-v${rendererVersion}/Nova-renderer-${rendererVersion}.json` },
        { name: manifest.assetName, browser_download_url: manifest.assetUrl, size: 2048 },
      ],
    }]
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(releases), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }))

    return new RendererUpdater({
      appVersion,
      shellApiVersion: 1,
      publicKey: publicKeyPem,
      builtInDirectory: path.join(directory, 'dist'),
      userDataDirectory: directory,
      fetch: fetchMock,
    })
  }

  it('returns the newest compatible renderer release', async () => {
    const result = await updaterFor(signedManifest()).checkForUpdate()
    expect(result).toMatchObject({
      currentVersion: `${appVersion}.0`,
      latestVersion: rendererVersion,
      downloadName: `Nova-renderer-${rendererVersion}.zip`,
    })
  })

  it('ignores a release for a different shell API', async () => {
    await expect(updaterFor(signedManifest({ shellApiVersion: 2 })).checkForUpdate()).resolves.toBeNull()
  })
})

describe('RendererUpdater installation lifecycle', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'nova-renderer-install-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  async function createUpdate(version: string, html: string) {
    const archive = zipSingleFile('index.html', html)
    return {
      archive,
      manifest: signedManifest({
        version,
        assetName: `Nova-renderer-${version}.zip`,
        assetUrl: `https://github.com/guoyiheng/nova/releases/download/ui-v${version}/Nova-renderer-${version}.zip`,
        sha256: createHash('sha256').update(archive).digest('hex'),
        files: { 'index.html': sha256(html) },
      }),
    }
  }

  function releaseFor(manifest: RendererUpdateManifest) {
    return [{
      tag_name: `ui-v${manifest.version}`,
      name: `Nova UI ${manifest.version}`,
      prerelease: true,
      draft: false,
      html_url: `https://github.com/guoyiheng/nova/releases/tag/ui-v${manifest.version}`,
      assets: [
        {
          name: `Nova-renderer-${manifest.version}.json`,
          browser_download_url: `https://github.com/guoyiheng/nova/releases/download/ui-v${manifest.version}/Nova-renderer-${manifest.version}.json`,
        },
        { name: manifest.assetName, browser_download_url: manifest.assetUrl },
      ],
    }]
  }

  async function stageUpdate(updater: RendererUpdater, manifest: RendererUpdateManifest, archive: Buffer) {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(releaseFor(manifest)), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }))
      .mockResolvedValueOnce(new Response(archive, {
        status: 200,
        headers: { 'content-length': String(archive.length) },
      }))
    Object.defineProperty(updater, 'fetchImpl', { get: () => fetchMock, configurable: true })
    await updater.checkForUpdate()
    await updater.downloadAndStage()
  }

  it('installs, confirms, and rolls back real renderer archives', async () => {
    const updater = new RendererUpdater({
      appVersion,
      shellApiVersion: 1,
      publicKey: publicKeyPem,
      builtInDirectory: path.join(directory, 'dist'),
      userDataDirectory: directory,
    })
    await updater.initialize()

    const first = await createUpdate(`${appVersion}.1`, 'first')
    await stageUpdate(updater, first.manifest, first.archive)
    expect(updater.hasPendingUpdate()).toBe(true)
    expect(await readFile(path.join(updater.getRendererDirectory(), 'index.html'), 'utf8')).toBe('first')
    await updater.confirmPendingUpdate()
    expect(updater.hasPendingUpdate()).toBe(false)

    const second = await createUpdate(`${appVersion}.2`, 'second')
    await stageUpdate(updater, second.manifest, second.archive)
    expect(await readFile(path.join(updater.getRendererDirectory(), 'index.html'), 'utf8')).toBe('second')
    await updater.rollbackPendingUpdate()
    expect(await readFile(path.join(updater.getRendererDirectory(), 'index.html'), 'utf8')).toBe('first')
  })
})
