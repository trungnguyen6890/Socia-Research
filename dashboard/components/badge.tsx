import { cn } from '@/lib/utils';

interface Props {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'error' | 'warning' | 'muted';
  className?: string;
}

const variants = {
  default: 'bg-neutral-100 text-neutral-600',
  success: 'bg-emerald-50 text-emerald-700',
  error: 'bg-red-50 text-red-700',
  warning: 'bg-amber-50 text-amber-700',
  muted: 'bg-neutral-50 text-neutral-400',
};

export default function Badge({ children, variant = 'default', className }: Props) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium',
      variants[variant],
      className,
    )}>
      {children}
    </span>
  );
}
