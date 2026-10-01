import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { ErrorState, Loading } from './components/ui';
import { AddMemberProvider } from './features/AddMember';
import { useAuth } from './hooks/useAuth';
import { MonthProvider } from './hooks/useMonth';
import { AppLayout } from './layouts/AppLayout';
import { LoginPage, SetupPage } from './pages/AuthPages';
import { DashboardPage } from './pages/DashboardPage';
import { ImportPage } from './pages/ImportPage';
import { JoiningPage } from './pages/JoiningPage';
import { MembersPage } from './pages/MembersPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { TreePage } from './pages/TreePage';
import { UnmappedPage } from './pages/UnmappedPage';
import { UpdatePvPage } from './pages/UpdatePvPage';

function RequireAuth() {
  const { token, loading } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  if (loading) return <Loading />;
  return (
    <MonthProvider>
      <AddMemberProvider>
        <Outlet />
      </AddMemberProvider>
    </MonthProvider>
  );
}

function RouteError() {
  return (
    <div className="p-6">
      <ErrorState error={new Error('This page failed to load. Reload the page and try again.')} onRetry={() => window.location.reload()} />
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/setup', element: <SetupPage /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'tree', element: <TreePage /> },
          { path: 'members', element: <MembersPage /> },
          { path: 'members/:ab', element: <ProfilePage /> },
          { path: 'joining', element: <JoiningPage /> },
          { path: 'pv', element: <UpdatePvPage /> },
          { path: 'import', element: <ImportPage /> },
          { path: 'unmapped', element: <UnmappedPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
