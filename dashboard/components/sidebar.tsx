'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';

const NAV = [
  { href: '/', label: 'Dashboard', icon: '◻' },
  { href: '/sources', label: 'Sources', icon: '⊞' },
  { href: '/content', label: 'Content', icon: '☰' },
  { href: '/keywords', label: 'Keywords', icon: '#' },
  { href: '/goals', label: 'Goals', icon: '◎' },
  { href: '/schedules', label: 'Schedules', icon: '⏱' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { logout } = useAuth();

  return (
    <aside className="w-56 shrink-0 border-r border-neutral-200 bg-neutral-50/50 h-screen sticky top-0 flex flex-col">
      <div className="px-5 py-5 border-b border-neutral-200">
        <h1 className="text-sm font-semibold text-neutral-900 tracking-tight">
          Socia Research
        </h1>
        <p className="text-[11px] text-neutral-400 mt-0.5">Research Bot Dashboard</p>
      </div>

      <nav className="flex-1 py-2 px-2">
        {NAV.map(({ href, label, icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-colors',
                active
                  ? 'bg-neutral-200/70 text-neutral-900 font-medium'
                  : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
              )}
            >
              <span className="text-[12px] w-4 text-center opacity-60">{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-neutral-200 flex items-center justify-between">
        <span className="text-[11px] text-neutral-400">v1.0</span>
        <button
          onClick={logout}
          className="text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
