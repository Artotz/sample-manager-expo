import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';

import { Text } from '@/components/nativewindui/Text';

export default function ScanScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const isFocused = useIsFocused();
  const device = useCameraDevice('back');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const status = await Camera.requestCameraPermission();
      if (!mounted) return;
      setHasPermission(status === 'authorized' || status === 'granted');
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const codeScanner = useCodeScanner({
    codeTypes: [
      'qr',
      'ean-13',
      'ean-8',
      'code-128',
      'code-39',
      'upc-a',
      'upc-e',
      'pdf-417',
      'aztec',
      'codabar',
      'data-matrix',
      'itf',
    ],
    onCodeScanned: (codes) => {
      if (scanned) return;
      const value = codes?.[0]?.value;
      if (!value) return;
      setScanned(true);
      router.replace({ pathname: '/amostra', params: { codigo: String(value) } });
    },
  });

  if (hasPermission === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text className="mt-2">Solicitando permissão da câmera...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <Text variant="title3" className="mb-2 font-semibold">
          Permissão negada
        </Text>
        <Text>Habilite a câmera nas configurações para ler códigos.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text className="text-primary">Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (device == null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text className="mt-2">Carregando câmera...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Camera
        style={{ flex: 1 }}
        device={device}
        isActive={!!isFocused && !!hasPermission && !scanned}
        codeScanner={codeScanner}
      />
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 0, right: 0, top: 0, padding: 12 }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-white">Cancelar</Text>
        </TouchableOpacity>
      </View>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16 }}>
        <Text className="text-white">Aponte a câmera para o código de barras.</Text>
      </View>
    </View>
  );
}

