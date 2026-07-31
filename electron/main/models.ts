type ModelsPayload = {
  data?: Array<{ id?: unknown }>
}

export function modelsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/models`
}

export function parseModelIds(payload: unknown): string[] {
  const data = (payload as ModelsPayload | null)?.data
  if (!Array.isArray(data)) return []
  return Array.from(new Set(data
    .map((item) => typeof item?.id === 'string' ? item.id.trim() : '')
    .filter(Boolean)))
    .sort((left, right) => left.localeCompare(right))
}

export async function fetchModelIds(baseUrl: string, apiKey: string): Promise<string[]> {
  const response = await fetch(modelsEndpoint(baseUrl), {
    method: 'GET',
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`获取模型列表失败（HTTP ${response.status}）${body ? `：${body.slice(0, 240)}` : ''}`)
  }
  return parseModelIds(await response.json())
}
