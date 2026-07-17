export function jsonRequest(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(new URL(path, "http://chainmove.test"), {
    method: init.method || "GET",
    headers: { "content-type": "application/json", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

export async function responseJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  const body = await response.json()
  if (!response.ok) throw new Error("HTTP " + response.status + ": " + JSON.stringify(body))
  return body as T
}
