// Small inline trend charts for labs with at least two numeric results.
import type { CaseBundle } from '@/lib/bundle';
import { LAB_LABEL, labSeries, type LabKey } from '@/lib/labs';

const TRACKED: LabKey[] = ['creatinine', 'potassium', 'sodium', 'inr', 'glucose', 'wbc', 'anc', 'hemoglobin', 'platelets', 'uric_acid', 'phosphate', 'calcium', 'magnesium', 'digoxin', 'vancomycin', 'crp', 'bilirubin', 'alt'];

function Spark({ values }: { values: number[] }) {
  const w = 160;
  const h = 44;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [4 + (i * (w - 8)) / Math.max(1, values.length - 1), h - 6 - ((v - min) / span) * (h - 12)] as const);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Trend: ${values.join(', ')}`} className="shrink-0">
      <polyline fill="none" stroke="#1b3c66" strokeWidth="2" points={pts.map((p) => p.join(',')).join(' ')} />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill={i === pts.length - 1 ? '#24855f' : '#1b3c66'} />
      ))}
    </svg>
  );
}

export function LabTrends({ bundle }: { bundle: CaseBundle }) {
  const labs = bundle.labs.filter((l) => l.prov.verification !== 'rejected');
  const series = TRACKED.map((k) => ({ key: k, s: labSeries(labs, k) })).filter((x) => x.s.length >= 2);
  if (series.length === 0) return <p className="text-sm text-slate-600">Trends appear when a laboratory test has at least two verified results.</p>;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {series.map(({ key, s }) => {
        const first = s[0]!;
        const last = s[s.length - 1]!;
        const delta = last.value - first.value;
        return (
          <li key={key} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5">
            <Spark values={s.map((p) => p.value)} />
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-navy-900">{LAB_LABEL[key]}</p>
              <p className="text-slate-700">
                {first.value} → <strong>{last.value}</strong> {last.unit}
              </p>
              <p className="text-xs text-slate-500">
                {delta > 0 ? '▲' : delta < 0 ? '▼' : '='} {Math.abs(Math.round(delta * 100) / 100)} · {s.length} results
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
