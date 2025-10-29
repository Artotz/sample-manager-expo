import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import * as Haptics from 'expo-haptics';

import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import XLSX from 'xlsx';

import { Text } from '@/components/nativewindui/Text';
import { getToken } from '@/lib/session';
import { s360GetAmostra } from '@/lib/s360/api';
import { Button } from '@/components/nativewindui/Button';

type Row = {
  Amostra: string;
  'Data de entrega': string;
  Compartimento: string;
  Chassi: string;
  Cliente: string;
  'Horas do equipamento': string | number;
  'Tipo do óleo': string;
  Status: string;
  'Data de coleta': string;
  Técnico: string;
};

export default function ScanScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanningLocked, setScanningLocked] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const isFocused = useIsFocused();
  const device = useCameraDevice('back');

  useEffect(() => {
    const token = getToken();
    if (!token) router.replace('/');
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const status = await Camera.requestCameraPermission();
      if (!mounted) return;
      setHasPermission(status === 'granted');
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const codeScanner = useCodeScanner({
    codeTypes: ['code-128', 'ean-13', 'ean-8', 'code-39'],
    onCodeScanned: async (codes) => {
      if (scanningLocked) return;
      const value = codes?.[0]?.value;
      if (!value) return;
      setScanningLocked(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      handleScanned(String(value));
    },
  });

  async function handleScanned(numero: string) {
    try {
      setBusy(true);
      setLastMessage(`Consultando amostra ${numero}...`);
      const token = getToken();
      if (!token) {
        router.replace('/');
        return;
      }
      const data: any = await s360GetAmostra(numero, token);
      const row = buildRow(numero, data);
      setRows((prev) => [row, ...prev]);
      setLastMessage(`Amostra ${numero} adicionada à planilha`);
    } catch (e: any) {
      setLastMessage(e?.message ?? 'Erro ao consultar');
    } finally {
      setBusy(false);
      setTimeout(() => setScanningLocked(false), 1200);
    }
  }

  function buildRow(numero: string, data: any): Row {
    const safe = (v: any) => (v === undefined || v === null || v === '' ? '-' : String(v));
    const getFirst = (...ks: string[]) => {
      for (const k of ks) {
        const parts = k.split('.');
        let cur: any = data;
        for (const p of parts) cur = cur?.[p];
        if (cur !== undefined && cur !== null && cur !== '') return cur;
      }
      return undefined;
    };
    return {
      Amostra: numero,
      'Data de entrega': safe(
        getFirst('dataEntrega', 'dataPrevistaEntrega', 'entrega', 'entregaPrevista')
      ),
      Compartimento: safe(getFirst('compartimento', 'equipamento.compartimento', 'sistema')),
      Chassi: safe(getFirst('chassi', 'numChassi', 'equipamento.chassi')),
      Cliente: safe(getFirst('cliente.nome', 'cliente', 'empresa.nome')),
      'Horas do equipamento': safe(getFirst('horasEquipamento', 'horimetro', 'horas')),
      'Tipo do óleo': safe(getFirst('tipoOleo', 'oleo', 'fluido', 'produto')),
      Status: safe(getFirst('status', 'situacao')),
      'Data de coleta': safe(getFirst('dataColeta', 'coletaData', 'coletadaEm')),
      Técnico: safe(getFirst('tecnico', 'coletor', 'usuario.nome')),
    };
  }

  // Implementação original de exportação:
  async function exportarXLSX() {
    if (!rows.length) {
      Alert.alert('Sem dados', 'Nenhuma amostra na planilha.');
      return;
    }
    try {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Amostras');
      const base64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
      const dir = ((FileSystem as any).documentDirectory ||
        (FileSystem as any).cacheDirectory) as string;
      const fileUri = `${dir}amostras-${ts}.xlsx`;
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: 'base64' as any });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
      } else {
        Alert.alert('Exportado', `Arquivo salvo em: ${fileUri}`);
      }
    } catch (e: any) {
      Alert.alert('Erro ao exportar', e?.message ?? 'Falha inesperada');
    }
  }

  function removerLinha(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function limparPlanilha() {
    Alert.alert('Limpar planilha', 'Deseja remover todas as amostras?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Limpar', style: 'destructive', onPress: () => setRows([]) },
    ]);
  }

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

  const isActive = !!isFocused && !!hasPermission && !scanningLocked && !busy;

  return (
    <View style={{ flex: 1 }}>
      <Camera style={{ flex: 1 }} device={device} isActive={isActive} codeScanner={codeScanner} />

      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 0, right: 0, top: 0, padding: 12 }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-white">Cancelar</Text>
        </TouchableOpacity>
      </View>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12 }}>
        <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, padding: 12 }}>
          <Text className="mb-2 text-white">Aponte a câmera para o código de barras.</Text>
          {lastMessage ? <Text className="mb-2 text-white/80">{lastMessage}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button size="sm" variant="tonal" onPress={exportarXLSX}>
              <Text className="text-white">Exportar XLSX</Text>
            </Button>
            <Button size="sm" variant="plain" onPress={limparPlanilha}>
              <Text className="text-white">Limpar planilha</Text>
            </Button>
          </View>
        </View>

        <View
          style={{
            maxHeight: 220,
            marginTop: 8,
            backgroundColor: 'rgba(255,255,255,0.95)',
            borderRadius: 12,
          }}>
          <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
            <Text className="font-semibold">Últimas amostras ({rows.length})</Text>
          </View>
          <ScrollView style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
            {rows.map((r, i) => (
              <View
                key={`${r.Amostra}-${i}`}
                style={{
                  paddingVertical: 8,
                  borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                  borderBottomColor: '#eee',
                }}>
                <Text className="font-medium">Amostra {r.Amostra}</Text>
                <Text className="text-foreground/60">
                  {r.Compartimento} • {r.Status}
                </Text>
                <TouchableOpacity onPress={() => removerLinha(i)} style={{ marginTop: 4 }}>
                  <Text className="text-red-500">Remover</Text>
                </TouchableOpacity>
              </View>
            ))}
            {!rows.length ? (
              <Text className="text-foreground/60">Nenhuma amostra adicionada ainda.</Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}
