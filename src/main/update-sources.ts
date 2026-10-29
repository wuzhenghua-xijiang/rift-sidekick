import type { LatestRelease } from '@shared/update-policy'

const REPOSITORY = 'wuzhenghua-xijiang/rift-sidekick'
const MIRRORS = [
  { url: 'https://gh-proxy.com/', releaseApi: true },
  { url: 'https://gh-proxy.org/', releaseApi: true },
  { url: 'https://ghfast.top/', releaseApi: false },
  { url: 'https://ghproxy.net/', releaseApi: false },
]

export const UPDATE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'

export function updateSources(url: string): string[] {
  return MIRRORS.map((mirror) => mirror.url + url)
}

export const RELEASE_SOURCES = MIRRORS.filter((mirror) => mirror.releaseApi)
  .map((mirror) => `${mirror.url}https://api.github.com/repos/${REPOSITORY}/releases/latest`)

export function releaseAssetSources(release: LatestRelease, name: string): string[] {
  return updateSources(`https://github.com/${REPOSITORY}/releases/download/${release.tag}/${name}`)
}

export async function firstUpdateSource<T>(urls: string[], read: (url: string) => Promise<T>): Promise<T> {
  // A slow mirror must not hold up another reachable mirror.
  try {
    return await Promise.any(urls.map(read))
  } catch (error) {
    throw error instanceof AggregateError ? error.errors[0] : error
  }
}
