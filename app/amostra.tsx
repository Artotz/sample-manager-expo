import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { router, type Href } from 'expo-router';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import * as SecureStore from 'expo-secure-store';
import {
  cacheDirectory,
  documentDirectory,
  writeAsStringAsync,
  EncodingType,
} from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';

import { Button } from '@/components/nativewindui/Button';
import { Text } from '@/components/nativewindui/Text';
import { getToken } from '@/lib/session';
import { s360GetAmostra } from '@/lib/s360/api';

import type { CameraRuntimeError } from 'react-native-vision-camera';

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
const EXPORT_HEADERS: { key: keyof AmostraRow; header: string }[] = [
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

const LATEST_SAMPLE_FIELDS: { key: keyof AmostraRow; label: string }[] = [
  { key: 'cliente', label: 'Cliente' },
  { key: 'compartimento', label: 'Compartimento' },
  { key: 'chassi', label: 'Chassi' },
  { key: 'tipoOleo', label: 'Tipo do oleo' },
  { key: 'horasEquipamento', label: 'Horas do equipamento' },
  { key: 'dataColeta', label: 'Data de coleta' },
  { key: 'dataEntrega', label: 'Data de entrega' },
  { key: 'tecnico', label: 'Tecnico responsavel' },
];

const SURFACE_COLOR = '#f8fafc';
const SURFACE_BORDER_COLOR = '#e2e8f0';
const TEXT_PRIMARY = '#0f172a';
const TEXT_MUTED = '#64748b';

function getStatusColors(status: string | null | undefined): {
  backgroundColor: string;
  foregroundColor?: string;
} {
  const normalized = status?.toString().trim().toLowerCase();
  if (!normalized) {
    return { backgroundColor: 'transparent' };
  }
  if (normalized === 'aguardando') {
    return { backgroundColor: '#fee2e2', foregroundColor: '#991b1b' };
  }
  if (normalized === 'coletada') {
    return { backgroundColor: '#dcfce7', foregroundColor: '#166534' };
  }
  return { backgroundColor: 'transparent' };
}

function sanitizeCellValue(raw: string): string {
  return raw.replace(/\r?\n/g, ' ').replace(/\t/g, ' ').trim();
}

function formatStatusLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '-';
  const lower = trimmed.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  try {
    const date =
      typeof value === 'string'
        ? new Date(value)
        : value instanceof Date
          ? value
          : new Date(String(value));
    if (Number.isNaN(date.getTime())) return '-';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return '-';
  }
}

function buildWorkbookBase64(rows: AmostraRow[]): string {
  const worksheetData = [
    EXPORT_HEADERS.map(({ header }) => sanitizeCellValue(header)),
    ...rows.map((row) => EXPORT_HEADERS.map(({ key }) => sanitizeCellValue(row[key]))),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Amostras');
  return XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
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
  const coletaEquip = payload?.coleta?.dadosColetaEquipamento ?? {};
  const coletaCompartimento = coletaEquip?.compartimento ?? payload?.compartimento ?? {};
  const coletaEquipamento = coletaEquip?.equipamento ?? payload?.equipamento ?? {};
  const coletaGeral = payload?.coleta?.dadosColetaGeral ?? {};
  const oleoInfo = coletaGeral?.oleo ?? payload?.oleo ?? {};
  const statusSource =
    (typeof payload?.situacao === 'string' && payload.situacao) ||
    (typeof payload?.status === 'string' && payload.status) ||
    (typeof payload?.statusDescricao === 'string' && payload.statusDescricao) ||
    '';

  const status = statusSource ? formatStatusLabel(statusSource) : valueOrDash(statusSource);
  const dataColetaValue =
    coletaGeral?.dataColeta ??
    payload?.dataColeta ??
    payload?.coletaEm ??
    payload?.dataColetaIso ??
    null;

  return {
    amostra:
      valueOrDash(
        payload?.numeroAmostra ?? payload?.amostra ?? codigo ?? payload?.codigo ?? payload?.id
      ) ?? '-',
    dataEntrega: formatDate(new Date()),
    compartimento: valueOrDash(
      coletaCompartimento?.nome ??
        payload?.compartimento ??
        payload?.componente ??
        payload?.local ??
        '-'
    ),
    chassi: valueOrDash(
      coletaEquipamento?.chassiSerie ??
        coletaEquipamento?.chassi ??
        payload?.chassi ??
        payload?.equipamento?.chassi ??
        payload?.equipamentoChassi ??
        payload?.maquina ??
        '-'
    ),
    cliente: valueOrDash(
      payload?.obra ??
        payload?.cliente?.nome ??
        coletaEquipamento?.cliente ??
        payload?.equipamento?.cliente ??
        payload?.clienteNome ??
        '-'
    ),
    horasEquipamento: valueOrDash(
      coletaEquip?.horasEquipamentoColeta ??
        payload?.horasEquipamento ??
        payload?.equipamento?.horimetro ??
        payload?.horasMaquina ??
        payload?.horimetro ??
        '-'
    ),
    tipoOleo: valueOrDash(
      oleoInfo?.viscosidade?.nome ??
        oleoInfo?.fabricanteOleo?.nome ??
        payload?.tipoOleo ??
        payload?.oleo ??
        payload?.tipoLubrificante ??
        '-'
    ),
    status,
    dataColeta: formatDate(dataColetaValue),
    tecnico: valueOrDash(
      payload?.responsavelRegistro ??
        payload?.tecnico ??
        payload?.tecnicoResponsavel ??
        payload?.responsavel ??
        '-'
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
  const [highlightedSample, setHighlightedSample] = useState<AmostraRow | null>(null);
  const [awaitingNextScan, setAwaitingNextScan] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  const [columnWidths, setColumnWidths] = useState<Partial<Record<keyof AmostraRow, number>>>({});
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const isFocused = useIsFocused();
  const device = useCameraDevice('back');

  const tableColumns = useMemo(() => TABLE_COLUMNS, []);
  const highlightedStatusColors = useMemo(
    () => getStatusColors(highlightedSample?.status),
    [highlightedSample?.status]
  );

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
            setHighlightedSample((prev) => prev ?? sanitized[0] ?? null);
            setAwaitingNextScan(false);
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
    const subscription = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        setCameraError(null);
        setCameraUnavailable(false);
        setScannerReady(true);
        const status = Camera.getCameraPermissionStatus();
        if (status !== 'granted') {
          const updated = await Camera.requestCameraPermission();
          setHasPermission(updated === 'granted');
        }
      }
    });
    return () => {
      subscription.remove();
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

      console.log(JSON.stringify(data, null, 2));

      const row = normalizeRow(data, codigo);
      setHighlightedSample(row);
      setAwaitingNextScan(false);
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
      // 'qr',
      // 'ean-13',
      // 'ean-8',
      'code-128',
      // 'code-39',
      // 'upc-a',
      // 'upc-e',
      // 'pdf-417',
      // 'aztec',
      // 'codabar',
      // 'data-matrix',
      // 'itf',
    ],
    onCodeScanned: (codes) => {
      if (!scannerReady || loading) return;
      const value = codes?.[0]?.value;
      if (!value) return;
      setScannerReady(false);
      consult(String(value));
    },
  });

  const handleRescan = useCallback(async () => {
    setError(null);
    setHighlightedSample(null);
    setAwaitingNextScan(true);
    setScannerReady(true);
    setCameraError(null);
    setCameraUnavailable(false);
    const status = Camera.getCameraPermissionStatus();
    if (status !== 'granted') {
      const updated = await Camera.requestCameraPermission();
      setHasPermission(updated === 'granted');
    }
  }, []);

  const handleExport = useCallback(async () => {
    if (!history.length) {
      Alert.alert('Planilha vazia', 'Nenhuma leitura para exportar.');
      return;
    }
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert(
          'Compartilhamento indisponivel',
          'Compartilhar arquivos nao e suportado neste dispositivo.'
        );
        return;
      }
      const workbookBase64 = buildWorkbookBase64(history);
      const timestamp = Date.now();
      const fileName = `Relatorio_Amostras_${timestamp}.xlsx`;
      const directory = cacheDirectory ?? documentDirectory ?? '';
      if (!directory) {
        Alert.alert('Erro', 'Nao foi possivel acessar o armazenamento temporario.');
        return;
      }
      const fileUri = `${directory}${fileName}`;
      await writeAsStringAsync(fileUri, workbookBase64, {
        encoding: EncodingType.Base64,
      });
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: 'Compartilhar planilha',
        UTI: 'com.microsoft.excel.xlsx',
      });
    } catch (err) {
      console.error('Erro ao compartilhar planilha', err);
      Alert.alert('Erro', 'Nao foi possivel compartilhar a planilha.');
    }
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
          setHighlightedSample(null);
          setAwaitingNextScan(false);
          setHistoryCollapsed(true);
          setError(null);
          setScannerReady(true);
          void SecureStore.deleteItemAsync(HISTORY_STORAGE_KEY);
        },
      },
    ]);
  }, []);

  const handleCameraError = useCallback((err: CameraRuntimeError) => {
    const code = err?.code ?? '';
    if (code === 'system/camera-is-restricted') {
      setCameraError(
        'Uso da camera restrito pelo sistema. Verifique permissoes ou politicas do dispositivo.'
      );
    } else {
      setCameraError(err?.message ?? 'Falha ao iniciar camera.');
    }
    setCameraUnavailable(true);
    setScannerReady(false);
  }, []);

  const toggleHistoryCollapsed = useCallback(() => {
    if (!history.length) return;
    setHistoryCollapsed((prev) => !prev);
  }, [history.length]);

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
    <SafeAreaView
      style={{ flex: 1, marginTop: -32, backgroundColor: SURFACE_COLOR }}
      edges={['top', 'bottom']}>
      <View style={{ flex: 1, marginTop: 0 }}>
        <View style={{ flex: 1, marginTop: 0, backgroundColor: '#000000' }}>
          {!cameraUnavailable ? (
            <>
              <Camera
                style={{ flex: 1 }}
                device={device}
                isActive={!!isFocused && !!hasPermission}
                codeScanner={codeScanner}
                onError={handleCameraError}
              />
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  padding: 8,
                }}>
                <Text className="text-white">
                  {scannerReady
                    ? 'Aponte a camera ao codigo de barras.'
                    : 'Pressione escanear novamente para nova leitura.'}
                </Text>
              </View>
            </>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <Text variant="title3" className="mb-2 font-semibold text-foreground">
                Camera indisponivel
              </Text>
              <Text className="text-center text-foreground">
                {cameraError ??
                  'Nao foi possivel acessar a camera. Verifique as permissões e tente novamente.'}
              </Text>
              <Button className="mt-4" variant="secondary" onPress={handleRescan}>
                <Text>Tentar novamente</Text>
              </Button>
            </View>
          )}
        </View>
        <View style={{ flex: 3 }}>
          <ScrollView
            contentContainerStyle={{ paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}>
            <View style={{ padding: 16, gap: 16 }}>
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  marginHorizontal: '-20%',
                  justifyContent: 'center',
                }}>
                <Button
                  variant="primary"
                  onPress={handleRescan}
                  disabled={loading || awaitingNextScan || highlightedSample == null}
                  style={{ width: '100%' }}>
                  <Text>Escanear novamente</Text>
                </Button>
              </View>
              {loading ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                  <ActivityIndicator size="small" />
                  <Text style={{ color: TEXT_PRIMARY }}>Consultando amostra...</Text>
                </View>
              ) : null}
              {error ? <Text className="text-red-500">{error}</Text> : null}
              {cameraError && !cameraUnavailable ? (
                <Text className="text-red-500">{cameraError}</Text>
              ) : null}
              <View style={{ gap: 8 }}>
                <Text variant="title3" className="font-semibold" style={{ color: TEXT_PRIMARY }}>
                  Ultima amostra
                </Text>
                {awaitingNextScan ? (
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: SURFACE_BORDER_COLOR,
                      borderRadius: 12,
                      padding: 12,
                      backgroundColor: SURFACE_COLOR,
                      gap: 4,
                    }}>
                    <Text style={{ fontWeight: '600', color: TEXT_PRIMARY }}>
                      Aguardando nova leitura
                    </Text>
                    <Text style={{ color: TEXT_MUTED }}>
                      Pressione o botao escanear e mire a camera para preencher esta area.
                    </Text>
                  </View>
                ) : highlightedSample ? (
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: SURFACE_BORDER_COLOR,
                      borderRadius: 12,
                      padding: 12,
                      backgroundColor: '#ffffff',
                      gap: 12,
                    }}>
                    <View
                      style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, color: TEXT_MUTED }}>Codigo</Text>
                        <Text style={{ fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY }}>
                          {highlightedSample.amostra}
                        </Text>
                      </View>
                      <View
                        style={{
                          alignSelf: 'flex-start',
                          borderRadius: 9999,
                          paddingHorizontal: 12,
                          paddingVertical: 4,
                          backgroundColor: highlightedStatusColors.backgroundColor,
                        }}>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: '600',
                            color: highlightedStatusColors.foregroundColor ?? '#111827',
                          }}>
                          {formatStatusLabel(highlightedSample.status)}
                        </Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                      {LATEST_SAMPLE_FIELDS.map((field) => (
                        <View key={field.key} style={{ width: '48%' }}>
                          <Text style={{ fontSize: 12, color: TEXT_MUTED }}>{field.label}</Text>
                          <Text style={{ fontWeight: '600', color: TEXT_PRIMARY }}>
                            {highlightedSample[field.key]}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : (
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: SURFACE_BORDER_COLOR,
                      borderRadius: 12,
                      padding: 12,
                      backgroundColor: SURFACE_COLOR,
                      gap: 4,
                    }}>
                    <Text style={{ fontWeight: '600', color: TEXT_PRIMARY }}>
                      Nenhuma amostra verificada ainda
                    </Text>
                    <Text style={{ color: TEXT_MUTED }}>
                      A ultima amostra consultada aparecera aqui para acesso rapido.
                    </Text>
                  </View>
                )}
              </View>
              <View style={{ gap: 8 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    gap: 12,
                    flexWrap: 'wrap',
                    flex: 1,
                  }}>
                  <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', flex: 1 }}>
                    <Button
                      variant="secondary"
                      onPress={handleClearHistory}
                      disabled={!history.length}
                      className="border-red-500">
                      <Text className="text-red-600">Limpar planilha</Text>
                    </Button>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', flex: 1 }}>
                    <Button
                      variant="primary"
                      onPress={handleExport}
                      disabled={history.length === 0}>
                      <Text>Exportar</Text>
                    </Button>
                  </View>
                </View>

                <Pressable
                  disabled={!history.length}
                  onPress={toggleHistoryCollapsed}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: SURFACE_BORDER_COLOR,
                    backgroundColor: SURFACE_COLOR,
                    opacity: history.length ? 1 : 0.6,
                  }}>
                  <View>
                    <Text
                      variant="title3"
                      className="font-semibold"
                      style={{ color: TEXT_PRIMARY }}>
                      Planilha
                    </Text>
                    <Text style={{ fontSize: 12, color: TEXT_MUTED }}>
                      {history.length ? `${history.length} registros` : 'Sem registros salvos'}
                    </Text>
                  </View>
                  <Text style={{ fontWeight: '600', color: TEXT_PRIMARY }}>
                    {historyCollapsed ? 'Mostrar' : 'Ocultar'}
                  </Text>
                </Pressable>
                {history.length === 0 ? (
                  <Text style={{ color: TEXT_MUTED }}>Nenhuma amostra verificada ainda.</Text>
                ) : null}
              </View>
            </View>
            {/* Mantem a tabela montada e limita a altura ao colapsar */}
            {history.length ? (
              <View
                style={{
                  maxHeight: historyCollapsed ? 0 : 1000 /* ajuste como preferir */,
                  overflow: 'hidden',
                  opacity: historyCollapsed ? 0 : 1,
                }}
                pointerEvents={historyCollapsed ? 'none' : 'auto'}>
                <ScrollView
                  horizontal
                  style={{ flexGrow: 1 }} // não “estica” para ocupar espaço extra
                  contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
                  bounces={false}
                  showsHorizontalScrollIndicator>
                  <View style={{ paddingBottom: 12 }}>
                    {/* header */}
                    <View
                      style={{
                        flexDirection: 'row',
                        borderBottomWidth: 1,
                        borderColor: '#e5e7eb',
                      }}>
                      {tableColumns.map((column) => {
                        const resolvedWidth = Math.max(
                          columnWidths[column.key] ?? 0,
                          column.minWidth
                        );
                        return (
                          <View
                            key={`header-${column.key}`}
                            style={{
                              width: resolvedWidth,
                              minWidth: column.minWidth,
                              paddingHorizontal: 4,
                              paddingVertical: 6,
                            }}>
                            <Text style={{ fontWeight: '600', fontSize: 12, color: TEXT_PRIMARY }}>
                              {column.label}
                            </Text>
                          </View>
                        );
                      })}
                    </View>

                    {/* corpo: se o número de linhas for grande, use um ScrollView vertical com altura controlada */}
                    <ScrollView
                      style={{ maxHeight: 220 }} // mantém a lista vertical contida
                      nestedScrollEnabled // permite scroll dentro do scroll horizontal
                      showsVerticalScrollIndicator>
                      {history.map((row) => {
                        const { backgroundColor, foregroundColor } = getStatusColors(row.status);

                        return (
                          <View
                            key={`row-${row.amostra}-${row.dataColeta}`}
                            style={{
                              flexDirection: 'row',
                              borderBottomWidth: 1,
                              borderColor: '#f3f4f6',
                              backgroundColor,
                            }}>
                            {tableColumns.map((column) => {
                              const resolvedWidth = Math.max(
                                columnWidths[column.key] ?? 0,
                                column.minWidth
                              );
                              return (
                                <View
                                  key={`cell-${row.amostra}-${column.key}`}
                                  style={{
                                    minWidth: resolvedWidth,
                                    paddingHorizontal: 4,
                                    paddingVertical: 8,
                                  }}
                                  onLayout={({ nativeEvent }) => {
                                    const measuredWidth = Math.max(
                                      nativeEvent.layout.width,
                                      column.minWidth
                                    );
                                    updateColumnWidth(column.key, measuredWidth);
                                  }}>
                                  <Text
                                    style={{ fontSize: 12, color: foregroundColor ?? TEXT_PRIMARY }}
                                    selectable>
                                    {row[column.key]}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        );
                      })}
                    </ScrollView>
                  </View>
                </ScrollView>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}
