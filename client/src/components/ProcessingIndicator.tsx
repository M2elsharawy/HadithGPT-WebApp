/**
 * ProcessingIndicator — stub component
 */
interface ProcessingIndicatorProps {
  isProcessing: boolean;
  currentEffect?: string;
  progress?: number;
}

export function ProcessingIndicator({ isProcessing, currentEffect, progress }: ProcessingIndicatorProps) {
  if (!isProcessing) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 py-1">
      <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0"/>
      <span>{currentEffect || "جاري المعالجة..."}</span>
      {progress !== undefined && <span className="font-mono">{Math.round(progress)}%</span>}
    </div>
  );
}
