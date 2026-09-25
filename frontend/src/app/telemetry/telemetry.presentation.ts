import { TagView, localTimestamp } from './telemetry.models';

export const CONDITIONS = ['temperature_c', 'humidity_percent', 'pressure_hpa'];
export const AIR_QUALITY = ['iaq', 'co2_equivalent_ppm', 'breath_voc_equivalent_ppm'];
export const DIAGNOSTICS = [
  'iaq_accuracy',
  'stabilization_complete',
  'run_in_complete',
  'sensor_status',
  'heartbeat',
];

export type Tone = 'good' | 'uncertain' | 'bad' | 'neutral';

export function qualityLabel(quality: number | undefined): string {
  return quality === 0
    ? 'Good'
    : quality === 1
      ? 'Uncertain'
      : quality === 2
        ? 'Bad'
        : quality === undefined
          ? 'No reading'
          : `Unknown (${quality})`;
}

export function qualityTone(quality: number | undefined): Tone {
  return quality === 0 ? 'good' : quality === 1 ? 'uncertain' : quality === 2 ? 'bad' : 'neutral';
}

export function accuracyLabel(value: number | undefined): string {
  return value === 0
    ? 'Unreliable'
    : value === 1
      ? 'Low'
      : value === 2
        ? 'Medium'
        : value === 3
          ? 'High'
          : value === undefined
            ? 'No reading'
            : `Unknown (${value})`;
}

export function displayValue(tag: TagView): string {
  const value = tag.reading?.value;
  if (value === undefined) return '—';
  if (tag.tag_key === 'iaq_accuracy') return accuracyLabel(value);
  if (['stabilization_complete', 'run_in_complete'].includes(tag.tag_key)) {
    return value === 1 ? 'Complete' : value === 0 ? 'In progress' : `Unknown (${value})`;
  }
  if (tag.tag_key === 'sensor_status') return value === 0 ? 'Healthy' : `Status code: ${value}`;
  const decimals =
    tag.tag_key === 'breath_voc_equivalent_ppm'
      ? 2
      : ['co2_equivalent_ppm', 'heartbeat'].includes(tag.tag_key)
        ? 0
        : 1;
  const displayed = tag.tag_key === 'gas_resistance_ohm' && tag.unit === 'Ω' ? value / 1000 : value;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(displayed);
}

export function displayUnit(tag: TagView): string {
  return tag.tag_key === 'gas_resistance_ohm' && tag.unit === 'Ω' ? 'kΩ' : (tag.unit ?? '');
}

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Taipei',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const calendar = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: 'short',
  day: '2-digit',
});

export function observedTime(timestamp: string | undefined): string {
  if (!timestamp) return 'Not observed yet';
  const date = new Date(localTimestamp(timestamp));
  return `${calendar.format(date)} · ${clock.format(date)}`;
}

export function readingAge(timestamp: string | undefined, now: number): string {
  if (!timestamp) return 'Waiting for data';
  const seconds = Math.floor((now - Date.parse(localTimestamp(timestamp))) / 1000);
  if (seconds < -5) return 'Timestamp ahead of clock';
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
