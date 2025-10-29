import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { Text } from '@/components/nativewindui/Text';
import { getToken } from '@/lib/session';

export default function AmostraScreen() {
  useEffect(() => {
    const token = getToken();
    if (!token) router.replace('/');
    else router.replace('/scan');
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Text>Redirecionando para leitura...</Text>
    </View>
  );
}
