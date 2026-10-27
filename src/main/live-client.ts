import https from 'node:https'

/** TLS relaxation is limited to the game's fixed local Live Client Data endpoint. */
export function readLiveGame(signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = https.get({ hostname: '127.0.0.1', port: 2999, path: '/liveclientdata/allgamedata',
      rejectUnauthorized: false, agent: false, signal, timeout: 1_500, headers: { Accept: 'application/json' } }, (response) => {
      const chunks: Buffer[] = []
      let length = 0
      response.on('data', (chunk: Buffer) => {
        length += chunk.length
        if (length > 2 * 1024 * 1024) request.destroy(new Error('局内实时数据超过大小限制。'))
        else chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => {
        if (response.statusCode !== 200) { reject(new Error('局内实时接口暂不可用。')); return }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch { reject(new Error('局内实时数据格式不兼容。')) }
      })
    })
    request.on('timeout', () => request.destroy(new Error('局内实时接口响应超时。')))
    request.on('error', reject)
  })
}
