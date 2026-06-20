import type { AddressRef, RiskLevel } from './types';

/** Truncate a long hex string (tx hash, address) for display. */
export function truncate(value: string, head = 6, tail = 4): string {
  if (!value) return '';
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Pull the chain prefix off an AddressRef (`eth:0x...` -> `eth`). */
export function chainOf(addr: AddressRef): string {
  const idx = addr.indexOf(':');
  return idx === -1 ? '' : addr.slice(0, idx);
}

/** Strip the chain prefix and return just the address. */
export function bareAddress(addr: AddressRef): string {
  const idx = addr.indexOf(':');
  return idx === -1 ? addr : addr.slice(idx + 1);
}

export function riskClasses(risk: RiskLevel): { dot: string; text: string; bg: string } {
  switch (risk) {
    case 'critical':
      return { dot: 'bg-taint-700', text: 'text-taint-700', bg: 'bg-taint-100' };
    case 'high':
      return { dot: 'bg-taint-500', text: 'text-taint-700', bg: 'bg-taint-100' };
    case 'medium':
      return { dot: 'bg-elevated-500', text: 'text-elevated-700', bg: 'bg-elevated-100' };
    case 'low':
      return { dot: 'bg-clean-500', text: 'text-clean-700', bg: 'bg-clean-100' };
    default:
      return { dot: 'bg-context-500', text: 'text-context-700', bg: 'bg-context-100' };
  }
}

export function riskLabel(risk: RiskLevel): string {
  switch (risk) {
    case 'critical':
      return 'Critical';
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
    default:
      return 'Unknown';
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

/** Format an ISO timestamp as "Aug 12, 2024 14:33 UTC". */
export function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    const time = d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
    return `${date} ${time} UTC`;
  } catch {
    return iso;
  }
}
