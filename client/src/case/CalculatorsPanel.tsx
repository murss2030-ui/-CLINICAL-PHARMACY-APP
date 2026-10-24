import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/form';
import { Tabs } from '@/components/ui/misc';
import type { CaseBundle } from '@/lib/bundle';
import { CALCULATORS } from '@/lib/calculators';
import { latestLab, numericValue } from '@/lib/labs';

/** Pre-fills inputs from verified case data; the trainee can change any value. */
function prefill(bundle: CaseBundle): Record<string, string> {
  const labs = bundle.labs.filter((l) => l.prov.verification !== 'rejected');
  const v = (k: Parameters<typeof latestLab>[1]) => latestLab(labs, k)?.value;
  const hr = [...bundle.vitals].reverse().find((x) => /^hr|heart|pulse/i.test(x.type));
  const c = bundle.case;
  const out: Record<string, number | string | undefined> = {
    age: c.age,
    weightKg: c.weightKg,
    heightCm: c.heightCm,
    sex: c.sex === 'Female' || c.sex === 'Male' ? c.sex : '',
    scr: v('creatinine'),
    ca: v('calcium'),
    albumin: v('albumin'),
    na: v('sodium'),
    cl: v('chloride'),
    hco3: v('bicarbonate'),
    hr: numericValue(hr?.value),
  };
  return Object.fromEntries(Object.entries(out).map(([k, x]) => [k, x === undefined ? '' : String(x)]));
}

export function CalculatorsPanel({ bundle }: { bundle: CaseBundle }) {
  const [id, setId] = useState(CALCULATORS[2]!.id);
  const initial = useMemo(() => prefill(bundle), [bundle]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const calc = CALCULATORS.find((c) => c.id === id)!;
  const result = calc.compute(values);
  return (
    <div className="space-y-4">
      <Tabs value={id} onChange={setId} items={CALCULATORS.map((c) => ({ value: c.id, label: c.name.split(' (')[0]! }))} />
      <div>
        <h3 className="font-bold text-navy-900">{calc.name}</h3>
        <p className="text-xs text-slate-500">Inputs pre-filled from verified case data where available. Calculators do not create prescribing decisions.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {calc.inputs.map((inp) => (
          <label key={inp.key} className="text-sm font-semibold text-navy-900">
            {inp.label}
            {inp.unit && <span className="font-normal text-slate-500"> ({inp.unit})</span>}
            {inp.kind === 'sex' ? (
              <Select className="mt-1" value={values[inp.key] ?? ''} onChange={(e) => setValues((x) => ({ ...x, [inp.key]: e.target.value }))}>
                <option value="">Select…</option>
                <option>Female</option>
                <option>Male</option>
              </Select>
            ) : (
              <Input className="mt-1" inputMode="decimal" value={values[inp.key] ?? ''} onChange={(e) => setValues((x) => ({ ...x, [inp.key]: e.target.value }))} />
            )}
          </label>
        ))}
      </div>
      <div className="rounded-xl bg-slate-50 p-3 text-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Formula</p>
        <p className="mt-0.5 font-mono text-xs text-navy-900">{calc.formula}</p>
      </div>
      {'error' in result ? (
        <p className="text-sm text-amber-800">{result.error}</p>
      ) : (
        <div className="space-y-2 rounded-xl border border-navy-200 bg-navy-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-navy-700">Result</p>
          {result.lines.map((l) => (
            <p key={l.label} className="text-sm">
              {l.label}: <strong className="text-lg text-navy-900">{l.value}</strong>
            </p>
          ))}
          <p className="text-sm text-navy-900">
            <Badge tone="blue">Interpretation</Badge> {result.interpretation}
          </p>
        </div>
      )}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Limitations</p>
        <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
          {calc.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
