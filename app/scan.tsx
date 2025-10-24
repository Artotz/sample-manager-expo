import React, { useEffect, useState, useCallback } from "react"
import { View, ActivityIndicator, TouchableOpacity } from "react-native"
import { router } from "expo-router"
import { BarCodeScanner } from "expo-barcode-scanner"

import { Text } from "@/components/nativewindui/Text"

export default function ScanScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [scanned, setScanned] = useState(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync()
      if (!mounted) return
      setHasPermission(status === "granted")
    })()
    return () => {
      mounted = false
    }
  }, [])

  const handleBarCodeScanned = useCallback(
    ({ data }: { type: string; data: string }) => {
      if (scanned) return
      setScanned(true)
      router.replace({ pathname: "/amostra", params: { codigo: String(data) } })
    },
    [scanned],
  )

  if (hasPermission === null) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text className="mt-2">Solicitando permissão da câmera...</Text>
      </View>
    )
  }

  if (hasPermission === false) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}>
        <Text variant="title3" className="mb-2 font-semibold">
          Permissão negada
        </Text>
        <Text>Habilite a câmera nas configurações para ler códigos.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text className="text-primary">Voltar</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <BarCodeScanner
        style={{ flex: 1 }}
        onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
      />
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", left: 0, right: 0, top: 0, padding: 12 }}
      >
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-white">Cancelar</Text>
        </TouchableOpacity>
      </View>
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 16 }}
      >
        <Text className="text-white">Aponte a câmera para o código de barras.</Text>
      </View>
    </View>
  )
}

