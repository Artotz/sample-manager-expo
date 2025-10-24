import { useEffect, useState } from "react"
import { View, TextInput } from "react-native"
import { Link, router } from "expo-router"

import { Button } from "@/components/nativewindui/Button"
import { Text } from "@/components/nativewindui/Text"
import { s360Login } from "@/lib/s360/api"
import { setSession, saveCredentials, loadCredentials } from "@/lib/session"

export default function LoginScreen() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const saved = await loadCredentials()
      if (saved.username) setUsername(saved.username)
      if (saved.password) setPassword(saved.password)
      if (saved.username && saved.password) {
        onLogin(saved.username, saved.password, true)
      }
    })()
  }, [])

  async function onLogin(u?: string, p?: string, silent?: boolean) {
    setError(null)
    const usr = u ?? username
    const pwd = p ?? password
    if (!usr || !pwd) {
      setError("Informe usuário e senha.")
      return
    }
    setLoading(true)
    try {
      const token = await s360Login({ username: usr, password: pwd })
      setSession(token)
      await saveCredentials(usr, pwd)
      router.replace("/amostra")
    } catch (e: any) {
      if (!silent) setError(e?.message ?? "Erro inesperado")
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={{ flex: 1, padding: 16, gap: 12, justifyContent: "center" }}>
      <Text variant="title2" className="font-semibold">
        Login S360
      </Text>
      <TextInput
        placeholder="username"
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={setUsername}
        style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10 }}
      />
      <TextInput
        placeholder="senha"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10 }}
      />
      {error ? (
        <Text className="text-red-500">{error}</Text>
      ) : (
        <Text color="tertiary">As credenciais serão mantidas somente em memória.</Text>
      )}
      <Button disabled={loading} onPress={() => onLogin()}>
        <Text>{loading ? "Autenticando..." : "Entrar"}</Text>
      </Button>
      <Link href="/amostra" asChild>
        <Button variant="plain">
          <Text>Ir para consulta</Text>
        </Button>
      </Link>
    </View>
  )
}
