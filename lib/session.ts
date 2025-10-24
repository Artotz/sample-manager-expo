import * as SecureStore from "expo-secure-store"

let _token: string | null = null

const KEY_USERNAME = "s360_username"
const KEY_PASSWORD = "s360_password"

export function setSession(token: string) {
  _token = token
}

export function clearSession() {
  _token = null
}

export function getToken() {
  return _token
}

export async function saveCredentials(username: string, password: string) {
  await Promise.all([
    SecureStore.setItemAsync(KEY_USERNAME, username),
    SecureStore.setItemAsync(KEY_PASSWORD, password),
  ])
}

export async function loadCredentials(): Promise<{ username: string | null; password: string | null }> {
  const [u, p] = await Promise.all([
    SecureStore.getItemAsync(KEY_USERNAME),
    SecureStore.getItemAsync(KEY_PASSWORD),
  ])
  return { username: u, password: p }
}

export async function clearCredentials() {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_USERNAME),
    SecureStore.deleteItemAsync(KEY_PASSWORD),
  ])
}
