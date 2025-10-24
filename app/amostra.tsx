import { useEffect, useState } from "react"
import { View, TextInput, ScrollView } from "react-native"
import { router, useLocalSearchParams } from "expo-router"

import { Button } from "@/components/nativewindui/Button"
import { Text } from "@/components/nativewindui/Text"
import { getToken } from "@/lib/session"
import { s360GetAmostra } from "@/lib/s360/api"

export default function AmostraScreen() {
  const [numero, setNumero] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)
  const { codigo } = useLocalSearchParams<{ codigo?: string }>()

  useEffect(() => {
    const token = getToken()
    if (!token) router.replace("/login")
  }, [])

  useEffect(() => {
    if (codigo) {
      const s = String(codigo)
      setNumero(s)
      consultarWith(s)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo])

  async function consultar() {
    setError(null)
    setResult(null)
    if (!numero) {
      setError("Informe o número da amostra.")
      return
    }
    const token = getToken()
    if (!token) {
      router.replace("/login")
      return
    }
    setLoading(true)
    try {
      const data = await s360GetAmostra(numero, token)
      setResult(data)
    } catch (e: any) {
      setError(e?.message ?? "Erro inesperado")
    } finally {
      setLoading(false)
    }
  }

  async function consultarWith(n: string) {
    setError(null)
    setResult(null)
    if (!n) return
    const token = getToken()
    if (!token) {
      router.replace("/login")
      return
    }
    setLoading(true)
    try {
      const data = await s360GetAmostra(n, token)
      setResult(data)
    } catch (e: any) {
      setError(e?.message ?? "Erro inesperado")
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text variant="title2" className="font-semibold mb-3">
        Consulta de Amostra
      </Text>
      <View style={{ gap: 12 }}>
        <TextInput
          placeholder="Número da amostra"
          keyboardType="number-pad"
          value={numero}
          onChangeText={setNumero}
          style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10 }}
        />
        <Button disabled={loading} onPress={consultar}>
          <Text>{loading ? "Consultando..." : "Consultar"}</Text>
        </Button>
        <Button variant="tonal" onPress={() => router.push("/scan")}>
          <Text>Ler código</Text>
        </Button>
        {error ? <Text className="text-red-500">{error}</Text> : null}
      </View>
      <ScrollView style={{ marginTop: 16 }}>
        {result ? (
          <Text selectable className="font-mono text-xs">
            {JSON.stringify(result, null, 2)}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  )
}
