import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function DashboardLayout() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--simprok-white)' }}>
      {/* Fixed Sidebar */}
      <Sidebar />
      
      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Topbar />
        
        {/* Scrollable Page Content */}
        <main style={{ flex: 1, padding: 'var(--space-8)', overflowY: 'auto', backgroundColor: '#F8FAFC' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
