// Deterministic presentation builder used offline and by the demo provider.
// It only restates case data; missing sections are marked DATA NOT AVAILABLE.
import type { CaseContext, Presentation } from './ai';
import { departmentLabel } from './departments';

export const DATA_NOT_AVAILABLE = 'DATA NOT AVAILABLE';

export interface PresentationExtras {
  goals?: string[];
  monitoring?: string[];
  followUps?: string[];
  outcomes?: string[];
  evidence?: string[];
  learningPoints?: string[];
}

type Slide = Presentation['slides'][number];

const MAX_BULLETS = 10;

function slide(heading: string, bullets: Array<string | undefined | false>, notes = ''): Slide {
  let clean = bullets.filter((b): b is string => typeof b === 'string' && b.trim().length > 0).map((b) => b.slice(0, 400));
  if (clean.length > MAX_BULLETS) clean = [...clean.slice(0, MAX_BULLETS - 1), `+ ${clean.length - (MAX_BULLETS - 1)} more — see the case record`];
  return clean.length
    ? { heading, bullets: clean, speakerNotes: notes, dataAvailable: true }
    : { heading, bullets: [DATA_NOT_AVAILABLE], speakerNotes: notes, dataAvailable: false };
}

export function buildTemplatePresentation(ctx: CaseContext, minutes: 5 | 10 | 15, extras: PresentationExtras = {}): Presentation {
  const d = ctx.demographics;
  const h = ctx.history;
  const meds = ctx.medications.filter((m) => m.status !== 'stopped' && (m.list === 'current' || m.list === 'admission'));
  const home = ctx.medications.filter((m) => m.list === 'home');
  const medText = (m: CaseContext['medications'][number]) =>
    [m.name, m.dose, m.route, m.frequency].filter(Boolean).join(' ') + (m.status === 'held' ? ' (held)' : '') + (m.verified ? '' : ' [unverified]');
  const abnormalLabs = ctx.labs.filter((l) => l.flag && !/normal|unknown/i.test(l.flag));
  const labs = (abnormalLabs.length ? abnormalLabs : ctx.labs).slice(0, minutes === 5 ? 6 : 14);
  const calc = ctx.calculated;

  const profile = slide('Patient profile', [
    [d.age !== undefined && `${d.age}-year-old`, d.sex, `(${departmentLabel(ctx.department)})`].filter(Boolean).join(' '),
    d.weightKg !== undefined && `Weight ${d.weightKg} kg`,
    d.heightCm !== undefined && `Height ${d.heightCm} cm`,
    calc.crclMlMin !== undefined && `Estimated CrCl ${Math.round(calc.crclMlMin)} mL/min (Cockcroft-Gault)`,
    calc.bsa !== undefined && `BSA ${calc.bsa.toFixed(2)} m²`,
  ]);
  const cc = slide('Chief complaint', [h.chiefComplaint]);
  const hpi = slide('History of present illness', [h.hpi]);
  const pmh = slide('Past medical history', h.pmh ? h.pmh.split(/;|\n/).map((s) => s.trim()) : []);
  const social = slide('Social history', [h.socialHistory]);
  const allergies = slide(
    'Allergies',
    ctx.allergies.length
      ? ctx.allergies.map((a) => `${a.substance}${a.reaction ? ` (${a.reaction})` : ''}${a.verified ? '' : ' [unverified]'}`)
      : [ctx.nkda ? 'No known drug allergies' : undefined],
  );
  const medsSlide = slide('Medications', [
    ...meds.map((m) => `Current: ${medText(m)}`),
    ...(minutes === 5 ? [] : home.map((m) => `Home: ${medText(m)}`)),
  ]);
  const vitals = slide('Vital signs', ctx.vitals.map((v) => `${v.type} ${v.value}${v.takenAt ? ` (${v.takenAt})` : ''}`));
  const exam = slide('Physical examination', [h.physicalExam]);
  const labsSlide = slide('Laboratory data', labs.map((l) => `${l.name} ${l.value}${l.unit ? ` ${l.unit}` : ''}${l.flag && l.flag !== 'unknown' ? ` (${l.flag})` : ''}${l.takenAt ? ` · ${l.takenAt}` : ''}`));
  const dx = slide('Diagnostics', ctx.diagnostics.map((x) => `${x.type}: ${x.result}`));
  const problems = slide('Problem list', ctx.problems.map((p) => `${p.name}${p.priority ? ` — ${p.priority} priority` : ''}`));
  const drps = slide('Drug-related problems', ctx.drps.map((x) => `${x.description}${x.medication ? ` (${x.medication})` : ''} — ${x.status}`));
  const assessment = slide('Medication assessment', ctx.drps.length ? [`${ctx.drps.length} potential DRP(s) assessed; see next slide.`] : []);
  const goals = slide('Therapeutic goals', extras.goals ?? []);
  const recs = slide('Recommendations', ctx.interventions.map((i) => `${i.recommendation}${i.status ? ` — ${i.status}` : ''}`));
  const monitoring = slide('Monitoring', extras.monitoring ?? []);
  const followUp = slide('Follow-up', extras.followUps ?? []);
  const outcomes = slide('Outcomes', extras.outcomes ?? []);
  const evidence = slide('Evidence', extras.evidence?.length ? extras.evidence : [], 'Only list sources you actually checked. Unchecked statements must be marked SOURCE NOT VERIFIED.');
  const learning = slide('Learning points', extras.learningPoints ?? []);

  let slides: Slide[];
  if (minutes === 5) {
    const merged = (heading: string, parts: Slide[]) =>
      slide(heading, parts.flatMap((p) => (p.dataAvailable ? p.bullets.map((b) => `${p.heading}: ${b}`) : [])));
    slides = [
      merged('Patient & presentation', [profile, cc, hpi, pmh, allergies]),
      medsSlide,
      merged('Key findings', [vitals, labsSlide, dx]),
      merged('Problems & DRPs', [problems, drps]),
      merged('Plan', [recs, monitoring, followUp]),
      learning,
    ];
  } else if (minutes === 10) {
    slides = [profile, slide('Presentation', [...cc.bullets.filter((b) => b !== DATA_NOT_AVAILABLE), ...hpi.bullets.filter((b) => b !== DATA_NOT_AVAILABLE)]), pmh, allergies, medsSlide, vitals, labsSlide, dx, problems, drps, recs, monitoring, followUp, learning];
  } else {
    slides = [profile, cc, hpi, pmh, social, allergies, medsSlide, vitals, exam, labsSlide, dx, problems, assessment, drps, goals, recs, monitoring, followUp, outcomes, evidence, learning];
  }
  return {
    title: `${ctx.caseCode} · ${minutes}-minute case presentation`,
    slides,
    learningPoints: extras.learningPoints ?? [],
  };
}
