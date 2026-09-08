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
import { AhspRoomPage } from './pages/AhspRoomPage';
import { AhspDetailPage } from './pages/AhspDetailPage';
import { BasicPriceExplorerPage } from './pages/BasicPriceExplorerPage';
import { BasicPriceImportPage } from './pages/BasicPriceImportPage';
import { BasicPriceReviewPage } from './pages/BasicPriceReviewPage';
import { BasicPriceReviewQueuePage } from './pages/BasicPriceReviewQueuePage';
import { BasicPriceReviewDetailPage } from './pages/BasicPriceReviewDetailPage';
import { BasicPricePublicationQueuePage } from './pages/BasicPricePublicationQueuePage';
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
              <Route path="ahsp" element={<PermissionRoute permission="AHSP_VIEW"><AhspRoomPage /></PermissionRoute>} />
              <Route path="ahsp/:ahspId" element={<PermissionRoute permission="AHSP_VIEW"><AhspDetailPage /></PermissionRoute>} />
              <Route path="basic-price" element={<BasicPriceExplorerPage />} />
              <Route path="basic-price/import" element={<PermissionRoute permission="BASIC_PRICE_IMPORT"><BasicPriceImportPage /></PermissionRoute>} />
              {/* Reopen an existing batch to read or repair its metadata. Same
                  page, same permission as creating one — it edits exactly the
                  fields the upload form does, on a batch the caller owns. */}
              <Route path="basic-price/import/:batchId" element={<PermissionRoute permission="BASIC_PRICE_IMPORT"><BasicPriceImportPage /></PermissionRoute>} />
              <Route path="basic-price/import/:batchId/review" element={<PermissionRoute permission="BASIC_PRICE_RESOLVE"><BasicPriceReviewPage /></PermissionRoute>} />
              <Route path="basic-price/reviews" element={<PermissionRoute permission="BASIC_PRICE_REVIEW_VIEW"><BasicPriceReviewQueuePage /></PermissionRoute>} />
              <Route path="basic-price/reviews/:reviewId" element={<PermissionRoute permission="BASIC_PRICE_REVIEW_VIEW"><BasicPriceReviewDetailPage /></PermissionRoute>} />
              <Route path="basic-price/publications" element={<PermissionRoute permission="BASIC_PRICE_PUBLISH"><BasicPricePublicationQueuePage /></PermissionRoute>} />
              <Route path="project/:projectId/detail" element={<ProjectDetailDoorPage />} />
              <Route path="project/:projectId/catatan" element={<ProjectNotesPage />} />
              <Route path="project/:id" element={<ProjectWarRoomPage />} />
              <Route path="showcase" element={<RoleRoute allowedRoles={['OWNER']}><ShowcasePage /></RoleRoute>} />
              <Route path="first-real-input-preview" element={<FirstRealInputPreviewPage />} />
              <Route path="field" element={<FieldTerminalPage />} />
            </Route>
            <Route path="/field/project/:projectId" element={<FieldLayout />}>
              <Route index element={<ProjectWorkPage />} />
              <Route path="progress/:boqItemId" element={<SubmitProgressPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
