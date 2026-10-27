import React from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Cpu,
  Cloud,
  XCircle,
  HelpCircle,
} from 'lucide-react';

export type ProcessingStatusType =
  | 'processed_on_device'
  | 'local_unavailable'
  | 'ai_model_required'
  | 'external_service_used'
  | 'processing_failed'
  | 'location_not_verified';

export interface ProcessingStatusStep {
  stepName: string;
  location: 'local' | 'external' | 'unverified';
}

interface ProcessingStatusBadgeProps {
  status: ProcessingStatusType;
  detail?: string;
  steps?: ProcessingStatusStep[];
  compact?: boolean;
}

const STATUS_META: Record<
  ProcessingStatusType,
  {
    label: string;
    colorClass: string;
    icon: React.FC<{ className?: string }>;
    defaultDetail: string;
  }
> = {
  processed_on_device: {
    label: 'Processed on this device',
    colorClass: 'text-emerald-400 border-emerald-500/30 bg-emerald-950/20',
    icon: ShieldCheck,
    defaultDetail: 'Executed 100% in local browser memory with zero remote network calls.',
  },
  local_unavailable: {
    label: 'Local processing unavailable',
    colorClass: 'text-amber-300 border-amber-500/30 bg-amber-950/20',
    icon: AlertTriangle,
    defaultDetail: 'Required browser API or local capability is unavailable on this device.',
  },
  ai_model_required: {
    label: 'AI model required',
    colorClass: 'text-amber-300 border-amber-500/30 bg-amber-950/20',
    icon: Cpu,
    defaultDetail: 'Optional on-device model weights are not yet installed in Offline Center.',
  },
  external_service_used: {
    label: 'External service used',
    colorClass: 'text-violet-300 border-violet-500/30 bg-violet-950/20',
    icon: Cloud,
    defaultDetail: 'This optional step communicated with a remote API endpoint.',
  },
  processing_failed: {
    label: 'Processing failed',
    colorClass: 'text-red-300 border-red-500/30 bg-red-950/20',
    icon: XCircle,
    defaultDetail: 'The operation encountered an error and did not produce verified output.',
  },
  location_not_verified: {
    label: 'Processing location not verified',
    colorClass: 'text-slate-300 border-slate-700 bg-slate-900/60',
    icon: HelpCircle,
    defaultDetail: 'No operation has been executed or verified yet.',
  },
};

export const ProcessingStatusBadge: React.FC<ProcessingStatusBadgeProps> = ({
  status,
  detail,
  steps,
  compact = false,
}) => {
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border ${meta.colorClass}`}
        title={detail || meta.defaultDetail}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="whitespace-nowrap">{meta.label}</span>
      </span>
    );
  }

  return (
    <div className={`rounded-xl border px-3.5 py-2.5 text-xs ${meta.colorClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">
          <Icon className="w-4 h-4 shrink-0" />
          <span>{meta.label}</span>
        </div>
        <span className="text-[11px] opacity-85">{detail || meta.defaultDetail}</span>
      </div>

      {steps && steps.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-3 text-[11px]">
          {steps.map((st, idx) => (
            <span key={idx} className="inline-flex items-center gap-1 text-slate-300">
              <span className="font-medium">{st.stepName}:</span>
              <span
                className={
                  st.location === 'local'
                    ? 'text-emerald-400 font-mono'
                    : st.location === 'external'
                    ? 'text-violet-300 font-mono'
                    : 'text-slate-400 font-mono'
                }
              >
                {st.location === 'local'
                  ? 'Local Device'
                  : st.location === 'external'
                  ? 'External API'
                  : 'Unverified'}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
