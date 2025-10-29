import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { router, type Href } from 'expo-router';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import * as SecureStore from 'expo-secure-store';

import { Button } from '@/components/nativewindui/Button';
import { Text } from '@/components/nativewindui/Text';
import { getToken } from '@/lib/session';
import { s360GetAmostra } from '@/lib/s360/api';
import { useColorScheme } from '@/lib/useColorScheme';

type AmostraRow = {
  amostra: string;
  dataEntrega: string;
  compartimento: string;
  chassi: string;
  cliente: string;
  horasEquipamento: string;
  tipoOleo: string;
  status: string;
  dataColeta: string;
  tecnico: string;
};

type TableColumn = {
  key: keyof AmostraRow;
  label: string;
  minWidth: number;
};

const TABLE_COLUMNS: TableColumn[] = [
  { key: 'amostra', label: 'Amostra', minWidth: 160 },
  { key: 'dataEntrega', label: 'Data entrega', minWidth: 130 },
  { key: 'compartimento', label: 'Compartimento', minWidth: 200 },
  { key: 'chassi', label: 'Chassi', minWidth: 180 },
  { key: 'cliente', label: 'Cliente', minWidth: 200 },
  { key: 'horasEquipamento', label: 'Horas equip.', minWidth: 130 },
  { key: 'tipoOleo', label: 'Tipo oleo', minWidth: 160 },
  { key: 'status', label: 'Status', minWidth: 130 },
  { key: 'dataColeta', label: 'Data coleta', minWidth: 160 },
  { key: 'tecnico', label: 'Tecnico', minWidth: 140 },
];

const TABLE_KEYS = TABLE_COLUMNS.map((column) => column.key);
const LOGIN_ROUTE = '/login' as Href;
const HISTORY_STORAGE_KEY = 's360_planilha_history_v1';
const HISTORY_LIMIT = 100;
const COLUMN_DELIMITER = '\t';
const ROW_DELIMITER = '\r\n';
const EXPORT_HEADERS: Array<{ key: keyof AmostraRow; header: string }> = [
  { key: 'amostra', header: 'Amostra' },
  { key: 'dataEntrega', header: 'Data de entrega' },
  { key: 'compartimento', header: 'Compartimento' },
  { key: 'chassi', header: 'Chassi' },
  { key: 'cliente', header: 'Cliente' },
  { key: 'horasEquipamento', header: 'Horas do equipamento' },
  { key: 'tipoOleo', header: 'Tipo do oleo' },
  { key: 'status', header: 'Status' },
  { key: 'dataColeta', header: 'Data de coleta' },
  { key: 'tecnico', header: 'Tecnico' },
];

async function tryCopyToClipboard(text: string): Promise<boolean> {
  try {
    const navClipboard = (typeof navigator !== 'undefined' &&
      'clipboard' in navigator &&
      navigator.clipboard) as Clipboard | undefined;
    if (navClipboard && typeof navClipboard.writeText === 'function') {
      await navClipboard.writeText(text);
      return true;
    }
  } catch {
    // ignore and fallback
  }
  return false;
}

function sanitizeCellValue(raw: string): string {
  return raw.replace(/\r?\n/g, ' ').replace(/\t/g, ' ').trim();
}

function buildExportText(rows: AmostraRow[]): string {
  const headerLine = EXPORT_HEADERS.map(({ header }) => sanitizeCellValue(header)).join(
    COLUMN_DELIMITER
  );
  const content = rows.map((row) =>
    EXPORT_HEADERS.map(({ key }) => sanitizeCellValue(row[key])).join(COLUMN_DELIMITER)
  );
  return [headerLine, ...content].join(ROW_DELIMITER);
}

function valueOrDash(value: unknown): string {
  if (value == null) return '-';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : '-';
  }
  return String(value);
}

function pickFirst<T>(value: T): T {
  if (Array.isArray(value)) return (value[0] as T) ?? ({} as T);
  return value;
}

function normalizeRow(data: any, codigo: string): AmostraRow {
  const payload = pickFirst(data?.data ?? data);
  return {
    amostra:
      valueOrDash(
        payload?.numeroAmostra ?? payload?.amostra ?? codigo ?? payload?.codigo ?? payload?.id
      ) ?? '-',
    dataEntrega: valueOrDash(
      payload?.dataEntrega ?? payload?.dataEntregaPrevista ?? payload?.entrega ?? '-'
    ),
    compartimento: valueOrDash(
      payload?.compartimento ?? payload?.componente ?? payload?.local ?? '-'
    ),
    chassi: valueOrDash(
      payload?.chassi ??
        payload?.equipamento?.chassi ??
        payload?.equipamentoChassi ??
        payload?.maquina ??
        '-'
    ),
    cliente: valueOrDash(
      payload?.cliente?.nome ?? payload?.equipamento?.cliente ?? payload?.clienteNome ?? '-'
    ),
    horasEquipamento: valueOrDash(
      payload?.horasEquipamento ??
        payload?.equipamento?.horimetro ??
        payload?.horasMaquina ??
        payload?.horimetro ??
        '-'
    ),
    tipoOleo: valueOrDash(payload?.tipoOleo ?? payload?.oleo ?? payload?.tipoLubrificante ?? '-'),
    status: valueOrDash(payload?.status ?? payload?.statusDescricao ?? payload?.situacao ?? '-'),
    dataColeta: valueOrDash(
      payload?.dataColeta ?? payload?.coletaEm ?? payload?.dataColetaIso ?? '-'
    ),
    tecnico: valueOrDash(
      payload?.tecnico ?? payload?.tecnicoResponsavel ?? payload?.responsavel ?? '-'
    ),
  };
}

function sanitizeStoredRow(value: unknown): AmostraRow | null {
  if (!value || typeof value !== 'object') return null;
  const bucket: Partial<Record<keyof AmostraRow, string>> = {};
  for (const key of TABLE_KEYS) {
    const raw = (value as Record<string, unknown>)[key];
    bucket[key] = valueOrDash(raw);
  }
  const amostra = bucket.amostra;
  if (!amostra || amostra === '-') return null;
  return bucket as AmostraRow;
}

export default function AmostraScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scannerReady, setScannerReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AmostraRow[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [columnWidths, setColumnWidths] = useState<
    Partial<Record<keyof AmostraRow, number>>
  >({});
  const [exportContent, setExportContent] = useState<string | null>(null);
  const [exportModalVisible, setExportModalVisible] = useState(false);

  const { isDarkColorScheme } = useColorScheme();

  const isFocused = useIsFocused();
  const device = useCameraDevice('back');

  const tableColumns = useMemo(() => TABLE_COLUMNS, []);

  const updateColumnWidth = useCallback((key: keyof AmostraRow, width: number) => {
    setColumnWidths((prev) => {
      const current = prev[key] ?? 0;
      const nextWidth = Math.max(width, current);
      if (nextWidth === current) return prev;
      return { ...prev, [key]: nextWidth };
    });
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) router.replace(LOGIN_ROUTE);
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

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(HISTORY_STORAGE_KEY);
        if (!mounted) return;
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            const sanitized = parsed
              .map(sanitizeStoredRow)
              .filter((row): row is AmostraRow => !!row);
            setHistory(sanitized);
          }
        }
      } catch {
        // noop - keep empty history if parsing falha
      } finally {
        if (mounted) setHistoryLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!historyLoaded) return;
    void SecureStore.setItemAsync(HISTORY_STORAGE_KEY, JSON.stringify(history));
  }, [history, historyLoaded]);

  const consult = useCallback(async (codigo: string) => {
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      if (!token) {
        router.replace(LOGIN_ROUTE);
        return;
      }
      const data = await s360GetAmostra(codigo, token);
      const row = normalizeRow(data, codigo);
      setHistory((prev) => {
        const filtered = prev.filter((item) => item.amostra !== row.amostra);
        const next = [row, ...filtered];
        return next.slice(0, HISTORY_LIMIT);
      });
    } catch (e: any) {
      setError(e?.message ?? 'Erro inesperado');
    } finally {
      setLoading(false);
    }
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
      if (!scannerReady || loading) return;
      const value = codes?.[0]?.value;
      if (!value) return;
      setScannerReady(false);
      consult(String(value));
    },
  });

  const handleRescan = useCallback(() => {
    setError(null);
    setScannerReady(true);
  }, []);

  const handleExport = useCallback(async () => {
    if (!history.length) {
      Alert.alert('Planilha vazia', 'Nenhuma leitura para exportar.');
      return;
    }
    const exportText = buildExportText(history);
    const copied = await tryCopyToClipboard(exportText);
    if (copied) {
      Alert.alert('Copiado', 'Planilha copiada para a area de transferencia.');
      return;
    }
    setExportContent(exportText);
    setExportModalVisible(true);
  }, [history]);

  const handleClearHistory = useCallback(() => {
    Alert.alert('Limpar planilha', 'Deseja remover todos os registros?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => {
          setHistory([]);
          setColumnWidths({});
          setError(null);
          setScannerReady(true);
          void SecureStore.deleteItemAsync(HISTORY_STORAGE_KEY);
        },
      },
    ]);
  }, []);

  const closeExportModal = useCallback(() => {
    setExportModalVisible(false);
    setExportContent(null);
  }, []);

  const handleCopyFromModal = useCallback(async () => {
    if (!exportContent) return;
    const copied = await tryCopyToClipboard(exportContent);
    if (copied) {
      Alert.alert('Copiado', 'Planilha copiada para a area de transferencia.');
      closeExportModal();
    }
  }, [closeExportModal, exportContent]);

  if (hasPermission === null || device == null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text className="mt-2">Carregando camera...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <Text variant="title3" className="mb-2 font-semibold">
          Permissao negada
        </Text>
        <Text>Habilite a camera nas configuracoes do dispositivo para continuar.</Text>
        <Button className="mt-4" onPress={() => router.back()}>
          <Text>Voltar</Text>
        </Button>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <Camera
          style={{ flex: 1 }}
          device={device}
          isActive={!!isFocused && !!hasPermission}
          codeScanner={codeScanner}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: 16,
            backgroundColor: 'rgba(0,0,0,0.35)',
          }}>
          <Text className="text-white">
            {scannerReady
              ? 'Aponte a camera ao codigo de barras.'
              : 'Pressione escanear novamente para nova leitura.'}
          </Text>
        </View>
      </View>
      <View style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          <Button variant="tonal" onPress={handleRescan} disabled={loading}>
            <Text>Escanear novamente</Text>
          </Button>
          <Button variant="secondary" onPress={handleExport}>
            <Text>Exportar .xlsx</Text>
          </Button>
          <Button
            variant="secondary"
            onPress={handleClearHistory}
            disabled={!history.length}
            className="border-red-500">
            <Text className="text-red-600">Limpar planilha</Text>
          </Button>
        </View>
        {loading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator size="small" />
            <Text>Consultando amostra...</Text>
          </View>
        ) : null}
        {error ? <Text className="text-red-500">{error}</Text> : null}
        <Text variant="title3" className="font-semibold">
          Planilha
        </Text>
        {history.length === 0 ? <Text>Nenhuma amostra verificada ainda.</Text> : null}
      </View>
      {history.length ? (
        <ScrollView horizontal contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
          <View style={{ paddingBottom: 12 }}>
            <View
              style={{
                flexDirection: 'row',
                borderBottomWidth: 1,
                borderColor: '#e5e7eb',
              }}>
              {tableColumns.map((column) => {
                const resolvedWidth = Math.max(columnWidths[column.key] ?? 0, column.minWidth);
                return (
                  <View
                    key={`header-${column.key}`}
                    style={{
                      width: resolvedWidth,
                      minWidth: column.minWidth,
                      paddingHorizontal: 4,
                      paddingVertical: 6,
                    }}>
                    <Text style={{ fontWeight: '600', fontSize: 12 }}>{column.label}</Text>
                  </View>
                );
              })}
            </View>
            {history.map((row) => (
              <View
                key={`row-${row.amostra}-${row.dataColeta}`}
                style={{
                  flexDirection: 'row',
                  borderBottomWidth: 1,
                  borderColor: '#f3f4f6',
                }}>
                {tableColumns.map((column) => {
                  const resolvedWidth = Math.max(columnWidths[column.key] ?? 0, column.minWidth);
                  return (
                    <View
                      key={`cell-${row.amostra}-${column.key}`}
                      style={{
                        minWidth: resolvedWidth,
                        paddingHorizontal: 4,
                        paddingVertical: 8,
                      }}
                      onLayout={({ nativeEvent }) => {
                        const measuredWidth = Math.max(nativeEvent.layout.width, column.minWidth);
                        updateColumnWidth(column.key, measuredWidth);
                      }}>
                      <Text style={{ fontSize: 12 }} selectable>
                        {row[column.key]}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}
      <Modal
        visible={exportModalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeExportModal}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.45)',
            justifyContent: 'center',
            padding: 16,
          }}>
          <View
            style={{
              backgroundColor: isDarkColorScheme ? '#111827' : '#ffffff',
              borderRadius: 12,
              padding: 16,
              maxHeight: '80%',
            }}>
            <Text variant="title3" className="font-semibold text-foreground">
              Copie a planilha
            </Text>
            <Text className="mt-1 text-foreground">
              Selecione e copie o texto abaixo e cole no Excel. As colunas estao separadas por tab.
            </Text>
            <View style={{ marginTop: 12, maxHeight: '70%' }}>
              <ScrollView>
                <Text selectable className="font-mono text-xs text-foreground">
                  {exportContent ?? ''}
                </Text>
              </ScrollView>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
              <Button variant="secondary" onPress={handleCopyFromModal}>
                <Text>Tentar copiar</Text>
              </Button>
              <Button variant="tonal" onPress={closeExportModal}>
                <Text>Fechar</Text>
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
