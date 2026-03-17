import { cn } from '@/lib/utils';

interface Props {
  score: number;
  label?: string;
}

export default function ScoreBar({ score, label }: Props) {
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-400' : 'bg-neutral-300';

  return (
    <div className="flex items-center gap-2">
      <div className="w-14 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] text-neutral-500 tabular-nums">
        {score.toFixed(2)}{label ? ` ${label}` : ''}
      </span>
    </div>
  );
}
