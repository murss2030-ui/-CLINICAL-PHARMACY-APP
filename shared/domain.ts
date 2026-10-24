// Shared clinical domain vocabulary used by the client, the server and the AI schemas.

export const STAGES = ['collect', 'understand', 'assess', 'act', 'monitor', 'followup', 'reflect'] as const;
export type StageId = (typeof STAGES)[number];

export const STAGE_INFO: Record<StageId, { label: string; question: string }> = {
  collect: { label: 'Collect', question: 'What do I know?' },
  understand: { label: 'Understand', question: 'What is happening with this patient?' },
  assess: { label: 'Assess', question: 'What is the clinical problem? Is there a medication-related problem?' },
  act: { label: 'Act', question: 'What should I do?' },
  monitor: { label: 'Monitor', question: 'What should I watch?' },
  followup: { label: 'Follow up', question: 'When should I reassess?' },
  reflect: { label: 'Reflect', question: 'What did I learn?' },
};

export const CASE_MODES = ['teach', 'assist', 'autodraft'] as const;
export type CaseMode = (typeof CASE_MODES)[number];

export const SOURCE_TYPES = [
  'patient_chart',
  'admission_note',
  'lab_report',
  'medication_order',
  'mar',
  'progress_note',
  'nursing_note',
  'diagnostic_report',
  'ecg',
  'radiology',
  'oncology_sheet',
  'antibiotic_chart',
  'discharge_list',
  'round_note',
  'free_text',
  'voice_note',
  'other',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  patient_chart: 'Patient chart',
  admission_note: 'Admission note',
  lab_report: 'Laboratory report',
  medication_order: 'Medication order',
  mar: 'MAR',
  progress_note: 'Progress note',
  nursing_note: 'Nursing note',
  diagnostic_report: 'Diagnostic report',
  ecg: 'ECG',
  radiology: 'Radiology',
  oncology_sheet: 'Oncology sheet',
  antibiotic_chart: 'Antibiotic chart',
  discharge_list: 'Discharge list',
  round_note: 'Round note',
  free_text: 'Free text',
  voice_note: 'Voice note',
  other: 'Other document',
};

export const DRP_CATEGORIES = [
  'unnecessary_therapy',
  'needs_additional_therapy',
  'ineffective_therapy',
  'dose_too_low',
  'dose_too_high',
  'adverse_drug_reaction',
  'drug_interaction',
  'contraindication',
  'duplicate_therapy',
  'non_adherence',
  'medication_error',
  'monitoring_problem',
  'other',
] as const;
export type DrpCategory = (typeof DRP_CATEGORIES)[number];

export const DRP_CATEGORY_LABEL: Record<DrpCategory, string> = {
  unnecessary_therapy: 'Unnecessary drug therapy',
  needs_additional_therapy: 'Needs additional drug therapy',
  ineffective_therapy: 'Ineffective therapy',
  dose_too_low: 'Dose too low',
  dose_too_high: 'Dose too high',
  adverse_drug_reaction: 'Adverse drug reaction',
  drug_interaction: 'Drug interaction',
  contraindication: 'Contraindication',
  duplicate_therapy: 'Duplicate therapy',
  non_adherence: 'Non-adherence',
  medication_error: 'Medication error',
  monitoring_problem: 'Monitoring problem',
  other: 'Other medication-related problem',
};

/** Confirmed is a human decision. The AI may only return the other three. */
export const DRP_STATUSES = ['confirmed', 'possible', 'not_supported', 'needs_data'] as const;
export type DrpStatus = (typeof DRP_STATUSES)[number];
export const AI_DRP_STATUSES = ['possible', 'not_supported', 'needs_data'] as const;

export const DRP_STATUS_LABEL: Record<DrpStatus, string> = {
  confirmed: 'Confirmed',
  possible: 'Possible',
  not_supported: 'Not supported',
  needs_data: 'Needs additional data',
};

export const PRIORITIES = ['high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const INTERVENTION_TYPES = [
  'start_therapy',
  'stop_therapy',
  'dose_change',
  'frequency_change',
  'route_change',
  'substitution',
  'monitoring_recommendation',
  'lab_recommendation',
  'safety_intervention',
  'adr_management',
  'adherence_intervention',
  'patient_counseling',
  'prescriber_communication',
  'discharge_intervention',
  'follow_up_recommendation',
] as const;
export type InterventionType = (typeof INTERVENTION_TYPES)[number];

export const INTERVENTION_TYPE_LABEL: Record<InterventionType, string> = {
  start_therapy: 'Start therapy',
  stop_therapy: 'Stop therapy',
  dose_change: 'Dose change',
  frequency_change: 'Frequency change',
  route_change: 'Route change',
  substitution: 'Therapeutic substitution',
  monitoring_recommendation: 'Monitoring recommendation',
  lab_recommendation: 'Laboratory recommendation',
  safety_intervention: 'Safety intervention',
  adr_management: 'ADR management',
  adherence_intervention: 'Adherence intervention',
  patient_counseling: 'Patient counseling',
  prescriber_communication: 'Prescriber communication',
  discharge_intervention: 'Discharge intervention',
  follow_up_recommendation: 'Follow-up recommendation',
};

export const FOLLOWUP_STATUSES = [
  'pending',
  'completed',
  'resolved',
  'stable',
  'improved',
  'partially_improved',
  'unimproved',
  'worsened',
  'new_drp',
] as const;
export type FollowUpStatus = (typeof FOLLOWUP_STATUSES)[number];

export const FOLLOWUP_STATUS_LABEL: Record<FollowUpStatus, string> = {
  pending: 'Pending',
  completed: 'Completed',
  resolved: 'Resolved',
  stable: 'Stable',
  improved: 'Improved',
  partially_improved: 'Partially improved',
  unimproved: 'Unimproved',
  worsened: 'Worsened',
  new_drp: 'New DRP',
};

export const FOLLOWUP_WINDOWS = ['today', 'next_review', 'reassessment', 'discharge', 'outpatient'] as const;
export type FollowUpWindow = (typeof FOLLOWUP_WINDOWS)[number];

export const MONITORING_CATEGORIES = [
  'clinical_response',
  'safety',
  'laboratory',
  'drug_specific',
  'disease_specific',
  'patient_reported',
] as const;
export type MonitoringCategory = (typeof MONITORING_CATEGORIES)[number];

export const COMPETENCY_DOMAINS = [
  'patient_assessment',
  'medication_history',
  'medication_reconciliation',
  'problem_identification',
  'drp_identification',
  'medication_review',
  'dose_optimization',
  'renal_dosing',
  'hepatic_dosing',
  'interaction_assessment',
  'adr_assessment',
  'medication_safety',
  'monitoring',
  'evidence_based_practice',
  'intervention',
  'communication',
  'patient_counseling',
  'documentation',
  'follow_up',
  'clinical_reasoning',
  'professionalism',
] as const;
export type CompetencyDomain = (typeof COMPETENCY_DOMAINS)[number];

export const COMPETENCY_LABEL: Record<CompetencyDomain, string> = {
  patient_assessment: 'Patient assessment',
  medication_history: 'Medication history',
  medication_reconciliation: 'Medication reconciliation',
  problem_identification: 'Clinical problem identification',
  drp_identification: 'DRP identification',
  medication_review: 'Medication review',
  dose_optimization: 'Dose optimization',
  renal_dosing: 'Renal dosing',
  hepatic_dosing: 'Hepatic dosing',
  interaction_assessment: 'Interaction assessment',
  adr_assessment: 'ADR assessment',
  medication_safety: 'Medication safety',
  monitoring: 'Monitoring',
  evidence_based_practice: 'Evidence-based practice',
  intervention: 'Intervention',
  communication: 'Communication',
  patient_counseling: 'Patient counseling',
  documentation: 'Documentation',
  follow_up: 'Follow-up',
  clinical_reasoning: 'Clinical reasoning',
  professionalism: 'Professionalism',
};

/** Entrustment scale. Levels are only ever changed by the trainee or supervisor. */
export const COMPETENCY_LEVELS = [
  'not_exposed',
  'observed',
  'guided',
  'limited_supervision',
  'minimal_supervision',
  'independent',
] as const;
export type CompetencyLevel = (typeof COMPETENCY_LEVELS)[number];

export const COMPETENCY_LEVEL_LABEL: Record<CompetencyLevel, string> = {
  not_exposed: 'Not exposed',
  observed: 'Observed',
  guided: 'Guided',
  limited_supervision: 'Limited supervision',
  minimal_supervision: 'Minimal supervision',
  independent: 'Independent',
};

export const TRAINING_LEVELS = ['foundations', 'developing', 'intermediate', 'advanced', 'complex'] as const;
export type TrainingLevel = (typeof TRAINING_LEVELS)[number];

export const TRAINING_LEVEL_LABEL: Record<TrainingLevel, string> = {
  foundations: 'Level 1 · Foundations',
  developing: 'Level 2 · Developing',
  intermediate: 'Level 3 · Intermediate',
  advanced: 'Level 4 · Advanced',
  complex: 'Level 5 · Complex clinical reasoning',
};

/** Confidence bands from the extraction specification. */
export const CONFIDENCE = { high: 0.85, review: 0.6 } as const;
export type ConfidenceBand = 'high' | 'review' | 'low';

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE.high) return 'high';
  if (confidence >= CONFIDENCE.review) return 'review';
  return 'low';
}

/** Display state for unverified extracted data (spec: VERIFIED / LIKELY / POSSIBLE / UNCERTAIN / MISSING). */
export function uncertaintyLabel(confidence: number): 'LIKELY' | 'POSSIBLE' | 'UNCERTAIN' {
  const band = confidenceBand(confidence);
  return band === 'high' ? 'LIKELY' : band === 'review' ? 'POSSIBLE' : 'UNCERTAIN';
}

export type Language = 'en' | 'ar';
