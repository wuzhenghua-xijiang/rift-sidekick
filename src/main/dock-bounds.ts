export interface Rect { x: number; y: number; width: number; height: number }

/** All arguments are Electron DIP rectangles; physical pixels must be converted first. */
export function dockBounds(client: Rect, work: Rect, preferredWidth = 430): Rect {
  const width = Math.min(preferredWidth, work.width)
  const height = Math.min(Math.max(560, client.height), work.height)
  const right = client.x + client.width
  const left = client.x - width
  const x = right + width <= work.x + work.width ? right : left >= work.x ? left : work.x + work.width - width
  const y = Math.max(work.y, Math.min(client.y, work.y + work.height - height))
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}
