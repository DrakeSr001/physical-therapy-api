import { createHash } from 'crypto';

export function hashDeviceIdentifier(rawId: string) {
  return createHash('sha256').update(rawId.trim().toLowerCase()).digest('hex');
}