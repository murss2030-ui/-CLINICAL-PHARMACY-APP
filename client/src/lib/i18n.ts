// Interface strings in English with optional Arabic. Clinical content (drug
// names, lab names, units) intentionally stays in English in both languages.
import { useSettings } from './hooks';

const AR: Record<string, string> = {
  Home: 'الرئيسية',
  Cases: 'الحالات',
  Training: 'التدريب',
  Tasks: 'المهام',
  Portfolio: 'الملف',
  Settings: 'الإعدادات',
  'Scan patient file': 'مسح ملف المريض',
  'Scan laboratory': 'مسح التحاليل',
  'Scan medication list': 'مسح قائمة الأدوية',
  'Scan progress note': 'مسح ملاحظة المتابعة',
  'Scan diagnostic report': 'مسح تقرير التشخيص',
  'Add manually': 'إضافة يدوية',
  'Open case': 'فتح حالة',
  'New case': 'حالة جديدة',
  Collect: 'جمع',
  Understand: 'فهم',
  Assess: 'تقييم',
  Act: 'تصرّف',
  Monitor: 'مراقبة',
  'Follow up': 'متابعة',
  Reflect: 'تأمّل',
  'What do I know?': 'ماذا أعرف؟',
  'What is happening with this patient?': 'ماذا يحدث لهذا المريض؟',
  'What is the clinical problem? Is there a medication-related problem?': 'ما المشكلة السريرية؟ هل توجد مشكلة دوائية؟',
  'What should I do?': 'ماذا يجب أن أفعل؟',
  'What should I watch?': 'ماذا يجب أن أراقب؟',
  'When should I reassess?': 'متى أعيد التقييم؟',
  'What did I learn?': 'ماذا تعلمت؟',
  'Do not enter unnecessary personally identifiable patient information.': 'لا تُدخل معلومات تعريفية غير ضرورية عن المريض.',
  "Today's missions": 'مهام اليوم',
  'Continue last case': 'متابعة آخر حالة',
  'Pending follow-ups': 'متابعات معلّقة',
  'Potential DRPs': 'مشكلات دوائية محتملة',
  'Knowledge gaps': 'فجوات معرفية',
  'Current rotation': 'الدورة الحالية',
  'Load demo case': 'تحميل حالة تجريبية',
  Offline: 'غير متصل',
};

export function translate(text: string, lang: 'en' | 'ar'): string {
  return lang === 'ar' ? (AR[text] ?? text) : text;
}

export function useT() {
  const { language } = useSettings();
  return (text: string) => translate(text, language);
}
