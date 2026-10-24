import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Spinner } from '@/components/ui/misc';
import HomePage from '@/pages/HomePage';
import CasesPage from '@/pages/CasesPage';
import NewCasePage from '@/pages/NewCasePage';

const CaseWorkspace = lazy(() => import('@/pages/CaseWorkspace'));
const TrainingPage = lazy(() => import('@/pages/TrainingPage'));
const TasksPage = lazy(() => import('@/pages/TasksPage'));
const PortfolioPage = lazy(() => import('@/pages/PortfolioPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

export default function App() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="grid place-items-center py-20 text-navy-900">
            <Spinner />
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/cases/new" element={<NewCasePage />} />
          <Route path="/cases/:caseId" element={<CaseWorkspace />} />
          <Route path="/training" element={<TrainingPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
