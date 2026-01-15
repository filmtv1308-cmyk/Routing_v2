import { AppProvider, useAppContext } from '@/store/AppContext';
import { LoginScreen } from '@/components/LoginScreen';
import { Layout } from '@/components/Layout';
import { MapPage } from '@/pages/MapPage';
import { StatsPage } from '@/pages/StatsPage';
import { AdminPage } from '@/pages/AdminPage';
import { BackupPage } from '@/pages/BackupPage';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function AppContent() {
  const { session, page, isAdmin } = useAppContext();

  if (!session) {
    return <LoginScreen />;
  }

  return (
    <Layout>
      {page === 'map' && <MapPage />}
      {page === 'stats' && <StatsPage />}
      {page === 'admin' && isAdmin() && <AdminPage />}
      {page === 'backup' && isAdmin() && <BackupPage />}
    </Layout>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ErrorBoundary>
  );
}
