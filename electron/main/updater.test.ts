import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getVersion: () => '0.1.0',
  },
  shell: {
    openPath: async () => '',
  },
}))

import { compareVersions, selectReleaseAsset, type ReleaseAsset } from './updater.js'

describe('compareVersions', () => {
  it('compares stable semantic versions', () => {
    expect(compareVersions('v0.2.0', '0.1.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0')).toBe(0)
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
  })

  it('orders prereleases before their stable version', () => {
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.1')).toBe(1)
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBe(-1)
  })
})

describe('selectReleaseAsset', () => {
  const assets: ReleaseAsset[] = [
    { name: 'Nova-0.2.0-mac-x64.dmg', browser_download_url: 'mac-x64' },
    { name: 'Nova-0.2.0-mac-arm64.dmg', browser_download_url: 'mac-arm64' },
    { name: 'Nova-0.2.0-win-x64.exe', browser_download_url: 'win-x64' },
    { name: 'Nova-0.2.0-linux-x64.AppImage', browser_download_url: 'linux-x64' },
  ]

  it('selects the package matching platform and architecture', () => {
    expect(selectReleaseAsset(assets, 'darwin', 'arm64')?.browser_download_url).toBe('mac-arm64')
    expect(selectReleaseAsset(assets, 'darwin', 'x64')?.browser_download_url).toBe('mac-x64')
    expect(selectReleaseAsset(assets, 'win32', 'x64')?.browser_download_url).toBe('win-x64')
    expect(selectReleaseAsset(assets, 'linux', 'x64')?.browser_download_url).toBe('linux-x64')
  })

  it('returns no asset when the release has no compatible package', () => {
    expect(selectReleaseAsset(assets, 'win32', 'arm64')).toBeUndefined()
  })
})
