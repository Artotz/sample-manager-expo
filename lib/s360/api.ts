export type LoginBody = {
  username: string
  password: string
}

export type LoginResponse = {
  token?: string
  access_token?: string
  [key: string]: any
}

const BASE_URL = "https://api.s360web.com"

export async function s360Login(body: LoginBody): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as LoginResponse
  if (!res.ok) throw new Error(`Falha ao autenticar (${res.status})`)
  const token = data.token || data.access_token
  if (!token) throw new Error("Resposta sem token")
  return token
}

export async function s360GetAmostra(numeroAmostra: string, token: string) {
  const url = `${BASE_URL}/api/v1/amostra/view?numeroAmostra=${encodeURIComponent(numeroAmostra)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Erro ao consultar (${res.status})`)
  return data
}

