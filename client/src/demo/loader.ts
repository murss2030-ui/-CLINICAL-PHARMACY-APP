import { DEMO_CASES, type DemoCase } from '@shared/demo';
import { SOURCE_TYPE_LABEL } from '@shared/domain';
import { audit, db, nextCaseCode, nextSourceCode } from '@/lib/db';
import { prepareImage } from '@/lib/image';
import type { CaseRecord, CaseSource, SourceImage } from '@/lib/types';
import { nowIso, uid } from '@/lib/utils';
import { renderDemoPage } from './render';

export { DEMO_CASES };

/**
 * Create a synthetic demo case with its documents rendered as page images.
 * Analysis and verification are left to the trainee so the full workflow can
 * be practised; the scripted demo provider answers the AI steps.
 */
export async function loadDemoCase(demo: DemoCase): Promise<string> {
  const id = uid();
  const record: CaseRecord = {
    id,
    code: await nextCaseCode(),
    department: demo.department,
    ward: demo.ward,
    encounter: 'Synthetic demo admission',
    mainProblem: demo.mainProblem,
    priority: demo.priority,
    status: 'active',
    stage: 'collect',
    mode: 'teach',
    isDemo: true,
    demoKey: demo.key,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.cases.add(record);
  for (const doc of demo.docs) {
    const sourceId = uid();
    const source: CaseSource = {
      id: sourceId,
      caseId: id,
      code: await nextSourceCode(id),
      type: doc.sourceType,
      label: `${doc.title} (synthetic)`,
      date: doc.date,
      pageCount: doc.pages.length,
      processing: 'captured',
      demoDocKey: doc.key,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await db.sources.add(source);
    const images: SourceImage[] = [];
    for (let p = 0; p < doc.pages.length; p++) {
      const prepared = await prepareImage(await renderDemoPage(doc, p));
      images.push({ id: uid(), caseId: id, sourceId, order: p, createdAt: nowIso(), ...prepared });
    }
    await db.images.bulkAdd(images);
  }
  await audit('demo.load', { caseId: id, detail: `${demo.key}: ${demo.docs.map((d) => SOURCE_TYPE_LABEL[d.sourceType]).join(', ')}` });
  return id;
}
