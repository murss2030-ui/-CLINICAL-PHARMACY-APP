import { BookOpenCheck, BriefcaseMedical, ClipboardList, FolderKanban, Home, Settings, WifiOff } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';
import { useOnline, useSettings } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { isNativeApp } from '@/lib/platform';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/cases', label: 'Cases', icon: BriefcaseMedical },
  { to: '/training', label: 'Training', icon: BookOpenCheck },
  { to: '/tasks', label: 'Tasks', icon: ClipboardList },
  { to: '/portfolio', label: 'Portfolio', icon: FolderKanban },
];

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-navy-900 px-4 py-3 text-sm text-white shadow-xl lg:bottom-6">
      <span className="flex-1">A new version of PRECEPTOR is available.</span>
      <Button size="sm" variant="secondary" onClick={() => updateServiceWorker(true)}>
        Reload
      </Button>
      <Button size="sm" variant="ghost" className="text-white hover:bg-navy-800" onClick={() => setNeedRefresh(false)}>
        Later
      </Button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const online = useOnline();
  const settings = useSettings();
  const t = useT();
  const location = useLocation();
  const [, setTick] = useState(0);

  useEffect(() => {
    document.documentElement.lang = settings.language;
    document.documentElement.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.dataset.text = settings.largeText ? 'large' : 'normal';
    setTick((n) => n + 1);
  }, [settings.language, settings.largeText]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-navy-900 text-white lg:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <img src="/favicon.svg" alt="" className="size-10" />
          <div>
            <p className="text-lg font-bold tracking-wide">PRECEPTOR</p>
            <p className="text-xs text-navy-200">Clinical pharmacy preceptor</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3" aria-label="Main">
          {[...NAV, { to: '/settings', label: 'Settings', icon: Settings }].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : undefined}
              className={({ isActive }) => cn('flex min-h-12 items-center gap-3 rounded-xl px-3 font-semibold', isActive ? 'bg-white text-navy-900' : 'text-navy-100 hover:bg-navy-800')}
            >
              <item.icon className="size-5" aria-hidden />
              {t(item.label)}
            </NavLink>
          ))}
        </nav>
        <p className="px-5 py-4 text-xs text-navy-200">Education & decision support. Not an autonomous prescribing system.</p>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <img src="/favicon.svg" alt="" className="size-8" />
        <p className="flex-1 text-base font-bold tracking-wide text-navy-900">PRECEPTOR</p>
        {!online && (
          <span className="flex items-center gap-1 rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">
            <WifiOff className="size-3.5" aria-hidden /> {t('Offline')}
          </span>
        )}
        <NavLink to="/settings" className="grid size-11 place-items-center rounded-xl text-navy-900 hover:bg-slate-100" aria-label={t('Settings')}>
          <Settings className="size-5" />
        </NavLink>
      </header>
      {!online && (
        <div className="hidden bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-900 lg:block">
          Offline — cases, manual entry and saved content keep working. AI features return when you are back online.
        </div>
      )}

      <main id="main" className="mx-auto max-w-5xl px-4 pb-28 pt-4 lg:px-8 lg:pb-12 lg:pt-8">
        {children}
      </main>

      {/* Mobile bottom navigation */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white lg:hidden" aria-label="Main">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => cn('flex min-h-16 flex-col items-center justify-center gap-0.5 text-[0.72rem] font-semibold', isActive ? 'text-navy-900' : 'text-slate-500')}
          >
            {({ isActive }) => (
              <>
                <span className={cn('grid h-8 w-12 place-items-center rounded-full', isActive && 'bg-navy-100')}>
                  <item.icon className="size-5" aria-hidden />
                </span>
                {t(item.label)}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      {/* The Android app ships its assets in the APK, so it does not use the service worker. */}
      {!isNativeApp() && <UpdatePrompt />}
    </div>
  );
}
