import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { ObservatoryPage } from './pages/ObservatoryPage';
import { ProjectWarRoomPage } from './pages/ProjectWarRoomPage';
import { ProjectSetupPage } from './pages/ProjectSetupPage';
import { ProjectRabDoorPage } from './pages/ProjectRabDoorPage';
import { RabWorkspacePage } from './pages/RabWorkspacePage';
import { ProjectAhspSnapshotPage } from './pages/ProjectAhspSnapshotPage';
import { ProjectDetailDoorPage } from './pages/ProjectDetailDoorPage';
import { ProjectNotesPage } from './pages/ProjectNotesPage';
import { ProjectListPage } from './pages/ProjectListPage';
import { ShowcasePage } from './pages/ShowcasePage';
import { FirstRealInputPreviewPage } from './pages/FirstRealInputPreviewPage';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute, RoleRoute, PermissionRoute } from './components/layout/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { WorkspaceSelectPage } from './pages/WorkspaceSelectPage';

import { FieldLayout } from './components/layout/FieldLayout';
import { FieldTerminalPage } from './pages/field/FieldTerminalPage';
import { ProjectWorkPage } from './pages/field/ProjectWorkPage';
import { SubmitProgressPage } from './pages/field/SubmitProgressPage';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/workspace-select" element={<WorkspaceSelectPage />} />
          
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<DashboardLayout />}>
              <Route index element={<RoleRoute allowedRoles={['DIRECTOR', 'FOREMAN', 'OWNER', 'MANDOR']}><ObservatoryPage /></RoleRoute>} />
              <Route path="proyek" element={<ProjectListPage />} />
              <Route path="project/new" element={<PermissionRoute permission="PROJECT_CREATE"><ProjectSetupPage /></PermissionRoute>} />
              <Route path="project/:projectId/rab" element={<PermissionRoute permission="RAB_VIEW"><ProjectRabDoorPage /></PermissionRoute>} />
              <Route path="project/:projectId/rab/workspace" element={<PermissionRoute permission="RAB_DRAFT_EDIT"><RabWorkspacePage /></PermissionRoute>} />
              <Route path="project/:projectId/rab/ahsp-snapshot" element={<ProjectAhspSnapshotPage />} />
              <Route path="project/:projectId/detail" element={<ProjectDetailDoorPage />} />
              <Route path="project/:projectId/catatan" element={<ProjectNotesPage />} />
              <Route path="project/:id" element={<ProjectWarRoomPage />} />
              <Route path="showcase" element={<RoleRoute allowedRoles={['OWNER']}><ShowcasePage /></RoleRoute>} />
              <Route path="first-real-input-preview" element={<FirstRealInputPreviewPage />} />
            </Route>
            
            <Route path="/field" element={<FieldLayout />}>
              <Route index element={<FieldTerminalPage />} />
              <Route path="project/:projectId" element={<ProjectWorkPage />} />
              <Route path="project/:projectId/progress/:boqItemId" element={<SubmitProgressPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
