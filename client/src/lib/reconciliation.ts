// Medication reconciliation across transitions of care:
// home → admission/current inpatient → discharge.
// Discrepancies are detected automatically but always classified by a
// pharmacist (intentional / potentially unintentional / uncertain).
import { classesOf, medKey, normalizeDose, normalizeFrequency, normalizeRoute, sameDrug, type DrugClass } from './meds';
import type { Medication, MedList } from './types';

export type DiscrepancyType = 'omission' | 'addition' | 'dose_change' | 'frequency_change' | 'route_change' | 'held' | 'stopped' | 'duplication';

export const DISCREPANCY_LABEL: Record<DiscrepancyType, string> = {
  omission: 'Omission',
  addition: 'Addition',
  dose_change: 'Dose change',
  frequency_change: 'Frequency change',
  route_change: 'Route change',
  held: 'Held',
  stopped: 'Stopped',
  duplication: 'Duplication',
};

export interface Discrepancy {
  key: string;
  type: DiscrepancyType;
  transition: 'admission' | 'discharge' | 'within_list';
  detail: string;
}

export interface ReconRow {
  key: string;
  name: string;
  home?: Medication;
  inpatient?: Medication;
  discharge?: Medication;
  discrepancies: Discrepancy[];
}

const show = (m?: Medication) => (m ? [m.dose && `${m.dose}${m.unit ? ` ${m.unit}` : ''}`, m.route, m.frequency].filter(Boolean).join(' ') || 'dose not documented' : '—');

function compare(from: Medication, to: Medication, transition: 'admission' | 'discharge', rowKey: string): Discrepancy[] {
  const out: Discrepancy[] = [];
  const add = (type: DiscrepancyType, detail: string) => out.push({ key: `${rowKey}|${type}|${transition}`, type, transition, detail });
  const d1 = normalizeDose(from.dose, from.unit);
  const d2 = normalizeDose(to.dose, to.unit);
  if (d1 && d2 && d1 !== d2) add('dose_change', `${show(from)} → ${show(to)}`);
  const f1 = normalizeFrequency(from.frequency);
  const f2 = normalizeFrequency(to.frequency);
  if (f1 && f2 && f1 !== f2) add('frequency_change', `${from.frequency} → ${to.frequency}`);
  const r1 = normalizeRoute(from.route);
  const r2 = normalizeRoute(to.route);
  if (r1 && r2 && r1 !== r2) add('route_change', `${from.route} → ${to.route}`);
  if (to.status === 'held') add('held', `${to.name} is held`);
  if (to.status === 'stopped') add('stopped', `${to.name} is stopped`);
  return out;
}

export function reconcile(meds: Medication[]): ReconRow[] {
  const live = meds.filter((m) => m.prov.verification !== 'rejected');
  const lists: Record<MedList, Medication[]> = { home: [], admission: [], current: [], discharge: [] };
  for (const m of live) lists[m.list].push(m);
  const inpatientList = lists.current.length ? lists.current : lists.admission;
  const hasInpatient = inpatientList.length > 0;
  const hasDischarge = lists.discharge.length > 0;

  const rows: ReconRow[] = [];
  const findRow = (m: Medication) => rows.find((r) => sameDrug(r.name, m.name));
  const place = (m: Medication, slot: 'home' | 'inpatient' | 'discharge') => {
    let row = findRow(m);
    if (!row) {
      row = { key: medKey(m.name), name: m.name, discrepancies: [] };
      rows.push(row);
    }
    if (!row[slot]) row[slot] = m;
  };
  lists.home.forEach((m) => place(m, 'home'));
  inpatientList.forEach((m) => place(m, 'inpatient'));
  lists.discharge.forEach((m) => place(m, 'discharge'));

  for (const row of rows) {
    const d = row.discrepancies;
    const add = (type: DiscrepancyType, transition: Discrepancy['transition'], detail: string) => d.push({ key: `${row.key}|${type}|${transition}`, type, transition, detail });
    if (hasInpatient) {
      if (row.home && !row.inpatient) add('omission', 'admission', `Home medication not on the inpatient list: ${row.home.name} ${show(row.home)}`);
      if (!row.home && row.inpatient && lists.home.length) add('addition', 'admission', `New in hospital: ${row.inpatient.name} ${show(row.inpatient)}`);
      if (row.home && row.inpatient) d.push(...compare(row.home, row.inpatient, 'admission', row.key));
    }
    if (hasDischarge) {
      if (row.home && !row.discharge) add('omission', 'discharge', `Home medication not on the discharge list: ${row.home.name}`);
      if (!row.home && row.discharge) add('addition', 'discharge', `New at discharge: ${row.discharge.name} ${show(row.discharge)}`);
      if (row.home && row.discharge) d.push(...compare(row.home, row.discharge, 'discharge', row.key));
    }
  }

  // Therapeutic duplication within the list the patient is currently on.
  const active = (hasDischarge ? lists.discharge : inpatientList).filter((m) => m.status !== 'stopped');
  const DUP: DrugClass[] = ['anticoagulant', 'ppi', 'nsaid', 'acei', 'arb', 'statin', 'beta_blocker', 'benzodiazepine'];
  for (const cls of DUP) {
    const inCls = active.filter((m) => classesOf(m.name).includes(cls));
    const distinct = [...new Map(inCls.map((m) => [medKey(m.name).split(' ')[0], m])).values()];
    if (distinct.length >= 2) {
      for (const m of distinct) {
        const row = findRow(m);
        if (row) row.discrepancies.push({ key: `${row.key}|duplication|within_list`, type: 'duplication', transition: 'within_list', detail: `Same class as ${distinct.filter((x) => x !== m).map((x) => x.name).join(', ')}` });
      }
    }
  }
  return rows.sort((a, b) => b.discrepancies.length - a.discrepancies.length || a.name.localeCompare(b.name));
}
