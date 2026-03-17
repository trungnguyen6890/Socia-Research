interface Props {
  message: string;
  description?: string;
}

export default function EmptyState({ message, description }: Props) {
  return (
    <div className="py-16 text-center">
      <p className="text-sm text-neutral-400">{message}</p>
      {description && (
        <p className="text-xs text-neutral-300 mt-1">{description}</p>
      )}
    </div>
  );
}
