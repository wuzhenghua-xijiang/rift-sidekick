interface Area {
  x: number
  y: number
  width: number
  height: number
}

/** Login is a separate launcher surface; the connected assistant keeps its narrow dock. */
export function windowPresentation(connected: boolean, work: Area) {
  const width = Math.min(connected ? 430 : 1100, work.width)
  const height = Math.min(connected ? 900 : 740, work.height)
  return {
    bounds: {
      x: Math.round(
        connected
          ? work.x + work.width - width
          : work.x + (work.width - width) / 2,
      ),
      y: Math.round(connected ? work.y : work.y + (work.height - height) / 2),
      width,
      height,
    },
    minWidth: Math.min(connected ? 390 : 840, width),
    minHeight: Math.min(connected ? 520 : 640, height),
    maxWidth: connected ? 520 : Math.max(1100, work.width),
    // A dock may later follow a taller client on another display.
    maxHeight: 0,
  }
}
