import { IAQ_BANDS, iaqAssessment } from './iaq.presentation';
import { TagView } from './telemetry.models';

const NEUTRAL = { color: '#657067', background: '#f0f2ee' };
const GOOD = { color: '#237443', background: '#edf5ee' };
const CAUTION = { color: '#8a6b00', background: '#fff8df' };
const HIGH = { color: '#b45309', background: '#fff3e6' };
const COOL = { color: '#376c8a', background: '#edf3f7' };
const BOSCH = {
  label: 'Bosch BME680 datasheet',
  url: 'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme680-ds001.pdf',
};
const BSEC = {
  label: 'Bosch BSEC output definitions',
  url: 'https://github.com/boschsensortec/BSEC-Arduino-library/blob/master/src/inc/bsec_datatypes.h',
};
const EQUIVALENTS = {
  label: 'Bosch: IAQ and equivalent output ranges',
  url: 'https://community.bosch-sensortec.com/mems-sensors-forum-jrmujtaw/post/units-and-ranges-for-iaq-iaq-accuracy-static-iaq-co2-equivalent-DlJQ734tSGoHlMD',
};

interface Band {
  range: string;
  label: string;
  color: string;
  background: string;
  matches: (value: number) => boolean;
}

interface RangeDefinition {
  title: string;
  note: string;
  bands: readonly Band[];
  source?: { label: string; url: string };
}

const band = (range: string, label: string, matches: Band['matches'], style = NEUTRAL): Band => ({
  range,
  label,
  matches,
  ...style,
});

// Inclusive app comfort target, not a health/safety limit or a Bosch specification.
export const TEMPERATURE_TARGET = { min: 20, max: 26 } as const;
const completion: RangeDefinition = {
  title: 'Sensor readiness',
  note: 'Readiness is separate from telemetry quality and air quality. Only 0 and 1 are defined.',
  source: BSEC,
  bands: [
    band('0', 'In progress', (v) => v === 0, CAUTION),
    band('1', 'Complete', (v) => v === 1, GOOD),
  ],
};

// Classification uses raw values, before display rounding or ohm-to-kilohm conversion.
// A neutral valid range means interpretable data, not a healthy room or a calibrated sensor.
export const READING_RANGES: Readonly<Partial<Record<string, RangeDefinition>>> = {
  iaq: {
    title: 'Air quality',
    note: 'Bosch IAQ bands. IAQ accuracy is reported separately in diagnostics; data quality does not describe how clean the air is.',
    source: BOSCH,
    bands: IAQ_BANDS.map((item, index) => ({
      ...item,
      matches: (v) => v >= 0 && v <= item.max && (index === 0 || v > IAQ_BANDS[index - 1].max),
    })),
  },
  temperature_c: {
    title: 'Room comfort target',
    note: `${TEMPERATURE_TARGET.min}–${TEMPERATURE_TARGET.max}°C is this app’s adjustable comfort default, not a health limit. Comfort also depends on clothing, activity and airflow. Sensor operating range: −40–85°C.`,
    source: BOSCH,
    bands: [
      band(
        `−40 to <${TEMPERATURE_TARGET.min}°C`,
        'Cool',
        (v) => v >= -40 && v < TEMPERATURE_TARGET.min,
        COOL,
      ),
      band(
        `${TEMPERATURE_TARGET.min}–${TEMPERATURE_TARGET.max}°C`,
        'In target',
        (v) => v >= TEMPERATURE_TARGET.min && v <= TEMPERATURE_TARGET.max,
        GOOD,
      ),
      band(
        `>${TEMPERATURE_TARGET.max}–85°C`,
        'Warm',
        (v) => v > TEMPERATURE_TARGET.max && v <= 85,
        HIGH,
      ),
    ],
  },
  humidity_percent: {
    title: 'Relative humidity',
    note: 'EPA recommends keeping indoor humidity below 60%, ideally 30–50%. These app bands describe room moisture, not telemetry quality.',
    source: {
      label: 'EPA: moisture control',
      url: 'https://www.epa.gov/mold/brief-guide-mold-moisture-and-your-home',
    },
    bands: [
      band('0 to <30%', 'Dry', (v) => v >= 0 && v < 30, CAUTION),
      band('30–50%', 'In target', (v) => v >= 30 && v <= 50, GOOD),
      band('>50 to <60%', 'Elevated', (v) => v > 50 && v < 60, CAUTION),
      band('60–100%', 'High humidity', (v) => v >= 60 && v <= 100, HIGH),
    ],
  },
  pressure_hpa: {
    title: 'Sensor operating range',
    note: 'Pressure depends on altitude and weather. Being inside the sensor range is not a room-comfort or health rating.',
    source: BOSCH,
    bands: [band('300–1100 hPa', 'In sensor range', (v) => v >= 300 && v <= 1100)],
  },
  gas_resistance_ohm: {
    title: 'Relative gas response',
    note: 'Positive resistance is expected. Interpret changes against this sensor’s baseline; there is no universal clean-air resistance threshold. Displayed in kΩ when the source unit is Ω.',
    source: BSEC,
    bands: [band('>0 Ω', 'Relative signal', (v) => v > 0)],
  },
  static_iaq: {
    title: 'Unscaled air-quality index',
    note: 'Static IAQ is nonnegative and is not capped at 500. The scaled IAQ bands are not applied here.',
    source: EQUIVALENTS,
    bands: [band('≥0 · no fixed upper limit', 'Unscaled index', (v) => v >= 0)],
  },
  co2_equivalent_ppm: {
    title: 'CO₂ equivalent estimate',
    note: 'Derived from the gas signal, not a direct CO₂ measurement. BSEC typically starts around 400 ppm. The app only checks nonnegative values; no health or ventilation limits are inferred.',
    source: EQUIVALENTS,
    bands: [band('≥0 ppm · plausibility check only', 'Estimate', (v) => v >= 0)],
  },
  breath_voc_equivalent_ppm: {
    title: 'Breath VOC equivalent estimate',
    note: 'A calculated equivalent, not a measurement of a specific VOC. BSEC typically starts around 0.3 ppm. The app only checks nonnegative values; no universal health bands are applied.',
    source: EQUIVALENTS,
    bands: [band('≥0 ppm · plausibility check only', 'Estimate', (v) => v >= 0)],
  },
  gas_percentage: {
    title: 'Relative gas percentage',
    note: 'A relative sensor indicator on a 0–100% scale, not a gas concentration or percentage of safe air. No universal health bands are applied.',
    bands: [band('0–100%', 'Relative level', (v) => v >= 0 && v <= 100)],
  },
  iaq_accuracy: {
    title: 'IAQ calibration accuracy',
    note: 'Calibration confidence is separate from both the IAQ value and telemetry quality. Only integer codes 0–3 are defined.',
    source: BOSCH,
    bands: [
      band('0', 'Unreliable', (v) => v === 0, HIGH),
      band('1', 'Low', (v) => v === 1, CAUTION),
      band('2', 'Medium', (v) => v === 2, CAUTION),
      band('3', 'High', (v) => v === 3, GOOD),
    ],
  },
  stabilization_complete: completion,
  run_in_complete: completion,
  sensor_status: {
    title: 'Device status',
    note: 'This project defines 0 as healthy. Other integer codes need device-specific interpretation; the reported code is preserved.',
    bands: [
      band('0', 'Healthy', (v) => v === 0, GOOD),
      band('Other integer codes', 'Check status', (v) => Number.isInteger(v) && v !== 0, CAUTION),
    ],
  },
  heartbeat: {
    title: 'Device heartbeat',
    note: 'No value range or reporting interval has been specified by the device protocol. Use its observation time to inspect freshness; the value alone cannot establish whether the device is online.',
    bands: [band('Any finite value · protocol-defined', 'Device reported', () => true)],
  },
};

export function readingAssessment(tag: TagView | undefined) {
  const definition = tag ? READING_RANGES[tag.tag_key] : undefined;
  if (!definition || !tag) return null;
  if (tag.tag_key === 'iaq') return iaqAssessment(tag);
  const unavailable = (label: string, reason: string) => ({
    ...NEUTRAL,
    label,
    reason,
    range: null,
  });
  if (!tag.reading) return unavailable('No reading', 'Waiting for an observation.');
  if (tag.reading.quality !== 0)
    return unavailable('Unavailable', 'Value interpretation requires good telemetry quality.');
  const value = tag.reading.value;
  const match = Number.isFinite(value)
    ? definition.bands.find((item) => item.matches(value))
    : undefined;
  if (!match)
    return unavailable('Out of range', 'The value is outside the defined ranges or state codes.');
  return { ...match, reason: definition.note };
}
