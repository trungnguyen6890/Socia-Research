'use client';

import Sidebar from '@/components/sidebar';
import { ToastProvider } from '@/components/toast';
import { AuthProvider } from '@/lib/auth';
import LoginGate from '@/components/login-gate';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <LoginGate>
        <ToastProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 min-w-0">
              <div className="max-w-5xl mx-auto px-8 py-8">
                {children}
              </div>
            </main>
          </div>
        </ToastProvider>
      </LoginGate>
    </AuthProvider>
  );
}
