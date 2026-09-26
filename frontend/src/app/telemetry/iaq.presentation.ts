import { TagView } from './telemetry.models';

// Bosch BME680 datasheet, Table 4:
// https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme680-ds001.pdf
// Use consecutive upper bounds for fractional readings; never round before classifying.
// Hues follow the Bosch bands, darkened for readable text on the light dashboard.
export const IAQ_BANDS = [
  { max: 50, range: '0–50', label: 'Excellent', color: '#237443', background: '#edf5ee' },
  { max: 100, range: '>50–100', label: 'Good', color: '#557c20', background: '#f1f5e8' },
  {
    max: 150,
    range: '>100–150',
    label: 'Lightly polluted',
    color: '#8a6b00',
    background: '#fff8df',
  },
  {
    max: 200,
    range: '>150–200',
    label: 'Moderately polluted',
    color: '#b45309',
    background: '#fff3e6',
  },
  {
    max: 250,
    range: '>200–250',
    label: 'Heavily polluted',
    color: '#a93226',
    background: '#fceeea',
  },
  {
    max: 350,
    range: '>250–350',
    label: 'Severely polluted',
    color: '#8e285e',
    background: '#f8eaf1',
  },
  {
    max: 500,
    range: '>350–500',
    label: 'Extremely polluted',
    color: '#713e23',
    background: '#f4ebe5',
  },
] as const;

export function classifyIaq(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 500) return undefined;
  return IAQ_BANDS.find((band) => value <= band.max);
}

export function iaqAssessment(tag: TagView | undefined) {
  if (tag?.tag_key !== 'iaq') return null;
  const unavailable = (label: string, reason: string) => ({
    label,
    reason,
    color: '#657067',
    background: '#f0f2ee',
    range: null,
  });
  if (!tag.reading) return unavailable('No IAQ reading', 'Waiting for an IAQ observation.');
  if (tag.reading.quality !== 0) {
    return unavailable(
      'IAQ unavailable',
      'Air-quality classification requires good telemetry quality.',
    );
  }
  const band = classifyIaq(tag.reading.value);
  if (!band)
    return unavailable('IAQ out of range', 'Expected a Bosch IAQ value between 0 and 500.');
  return { ...band, reason: `Bosch IAQ band: ${band.range}. IAQ accuracy is reported separately.` };
}
