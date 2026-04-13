import type { WsData } from '@fairfox/shared/subapp';

export function parseWsRole(url: URL): WsData['role'] {
  const raw = url.searchParams.get('role');
  if (raw === 'relay') {
    return 'relay';
  }
  if (raw === 'client') {
    return 'client';
  }
  return 'phone';
}
