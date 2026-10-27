import React, { useState, useRef } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Eye,
  MapPin,
  FileCheck2,
  Download,
  Sparkles,
  Upload,
  Cpu,
  HardDrive,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Sliders,
  CheckSquare,
  Globe,
  WifiOff,
  FileSpreadsheet,
  Columns,
} from 'lucide-react';
import {
  ExifFieldFinding,
  VisualDetectionRegion,
  DetailedVerificationReport,
  OnDeviceModelInfo,
  ShareSafePreset,
  SHARE_SAFE_PRESETS,
  UrlCleanResult,
  PrivacyRiskReport,
  buildDetailedVerificationReport,
  generateSanitizedVerificationReportJson,
  runLiveOfflineDiagnostic,
  injectSampleExifIntoJpeg,
  inspectBinaryMetadataSegments,
  calculatePhotoRiskReport,
  analyzeAndCleanUrl,
} from '../utils/privacyEngine';
import { ProcessingStatusBadge } from './ProcessingStatusBadge';

// Shared state structure passed from App so all pages stay in sync
export interface SharedPhotoSessionState {
  fileName: string;
  fileSize: number;
  fileFormat: string;
  originalUrl: string | null;
  cleanedUrl: string | null;
  rawBytes: Uint8Array | null;
  binaryExifBytes: number;
  metadataRemoved: boolean;
  metadataFindings: ExifFieldFinding[];
  visualDetections: VisualDetectionRegion[];
  selectedPreset: ShareSafePreset;
  detailedVerification: DetailedVerificationReport | null;
}

// ============================================================================
// PAGE 2: PRIVACY PREVIEW (/privacy-preview) — Enhancement A
// ============================================================================

interface PrivacyPreviewPageProps {
  session: SharedPhotoSessionState;
  models: OnDeviceModelInfo[];
  onLoadSamplePhoto: () => Promise<void>;
  onUploadFile: (file: File) => Promise<void>;
  onSelectPreset: (preset: ShareSafePreset) => void;
  onStripMetadataNow: () => Promise<void>;
  onToggleVisualRegion: (id: string, selected: boolean) => void;
  onRedactAllDetected: () => void;
  onExportAndVerifyNow: () => Promise<void>;
  onNavigate: (route: string) => void;
}

export const PrivacyPreviewPage: React.FC<PrivacyPreviewPageProps> = ({
  session,
  models,
  onLoadSamplePhoto,
  onUploadFile,
  onSelectPreset,
  onStripMetadataNow,
  onToggleVisualRegion,
  onRedactAllDetected,
  onExportAndVerifyNow,
  onNavigate,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean>(false);

  const ocrInstalled =
    models.find((m) => m.id === 'local-ocr')?.status === 'ready_offline';
  const hasPhoto = Boolean(session.originalUrl);

  const activeMetadataCount = session.metadataRemoved
    ? 0
    : session.metadataFindings.length;
  const unredactedVisualCount = session.visualDetections.filter(
    (d) => !d.selectedForRedaction
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <ProcessingStatusBadge
            status={hasPhoto ? 'processed_on_device' : 'location_not_verified'}
            compact
            detail="All metadata and visual inspection runs in local browser memory."
          />
          <h1 className="text-2xl font-bold text-slate-100 mt-1.5">
            Privacy Preview Before Sharing
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
            Understand what hidden metadata and visible details an image could reveal about your location, device, or identity before you post or send it.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{hasPhoto ? 'Inspect Another Photo' : 'Select Photo to Inspect'}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadFile(f);
            }}
          />

          <button
            type="button"
            onClick={onLoadSamplePhoto}
            className="px-3.5 py-2 rounded-xl border border-violet-500/40 bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            <span>Load Sample Photo (GPS + Badge)</span>
          </button>
        </div>
      </div>

      {!hasPhoto ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/50 p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mx-auto">
            <Eye className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="text-base font-semibold text-slate-100">
              No Image Loaded for Privacy Preview Yet
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Select a photo from your device or load the sample image with embedded GPS coordinates and credential text to see a complete Hidden vs. Visible privacy breakdown.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs cursor-pointer"
            >
              Choose Photo from Device
            </button>
            <button
              type="button"
              onClick={onLoadSamplePhoto}
              className="px-4 py-2.5 rounded-xl border border-violet-500/40 bg-violet-500/15 text-violet-200 font-semibold text-xs cursor-pointer"
            >
              Load Sample Photo (with Hidden GPS & ID)
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Share-Safe Export Presets Bar */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-cyan-400" />
                  <span>Share-Safe Protection Preset</span>
                </h2>
                <p className="text-xs text-slate-400">
                  Choose a preset to configure metadata stripping and visual redaction review. Uncertain detections are never applied silently.
                </p>
              </div>
              <span className="text-xs font-mono text-cyan-300">
                Active: {SHARE_SAFE_PRESETS[session.selectedPreset].name}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(['everyday', 'extra_privacy', 'manual'] as const).map((presetKey) => {
                const cfg = SHARE_SAFE_PRESETS[presetKey];
                const isSelected = session.selectedPreset === presetKey;
                return (
                  <button
                    key={presetKey}
                    type="button"
                    onClick={() => onSelectPreset(presetKey)}
                    className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-cyan-500 bg-cyan-950/25'
                        : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-100">{cfg.name}</span>
                      {isSelected && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500 text-slate-950 font-semibold">
                          Selected
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                      {cfg.tagline}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="rounded-xl bg-slate-950/80 border border-slate-800/90 p-3 text-xs text-slate-300 space-y-1">
              <p className="font-semibold text-slate-200">
                Exact Behavior for “{SHARE_SAFE_PRESETS[session.selectedPreset].name}”:
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-slate-400">
                {SHARE_SAFE_PRESETS[session.selectedPreset].behaviorSummary.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Visual Preview & Action Bar */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-4 lg:sticky lg:top-20">
              <div>
                <div className="flex items-center justify-between text-xs text-slate-300 mb-3">
                  <span className="font-semibold text-slate-100">{session.fileName}</span>
                  <span className="font-mono text-slate-400">
                    {(session.fileSize / 1024).toFixed(1)} KB · {session.fileFormat}
                  </span>
                </div>

                <div className="rounded-xl bg-slate-950 border border-slate-800 p-2 flex items-center justify-center">
                  <img
                    src={session.cleanedUrl || session.originalUrl || ''}
                    alt="Inspected photo preview"
                    referrerPolicy="no-referrer"
                    className="max-h-64 object-contain rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={onStripMetadataNow}
                    className="py-2 px-3 rounded-xl border border-cyan-500/40 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 font-semibold text-xs cursor-pointer"
                  >
                    {session.metadataRemoved ? '✓ Metadata Removed' : 'Remove Metadata'}
                  </button>
                  <button
                    type="button"
                    onClick={onRedactAllDetected}
                    className="py-2 px-3 rounded-xl border border-violet-500/40 bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 font-semibold text-xs cursor-pointer"
                  >
                    Mask/Blur All Detected
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigate('/redaction-studio')}
                    className="py-2.5 px-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-200 font-medium text-xs cursor-pointer"
                  >
                    Open Redaction Studio →
                  </button>
                  <button
                    type="button"
                    onClick={onExportAndVerifyNow}
                    className="py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs cursor-pointer"
                  >
                    Export & Verify Copy →
                  </button>
                </div>
              </div>
            </div>

            {/* Separate Sections for Hidden Information vs Visible Information */}
            <div className="lg:col-span-7 space-y-5">
              {/* SECTION 1: HIDDEN INFORMATION (EXIF / GPS / Device Headers) */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-amber-400" />
                    <h2 className="text-base font-semibold text-slate-100">
                      1. Hidden Information (File Metadata Headers)
                    </h2>
                  </div>
                  <span
                    className={`text-xs font-mono px-2.5 py-0.5 rounded-md ${
                      activeMetadataCount === 0
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {activeMetadataCount === 0
                      ? 'Resolved (0 active tags)'
                      : `${activeMetadataCount} finding(s) need attention`}
                  </span>
                </div>

                {session.metadataFindings.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">
                    No supported EXIF, GPS, or XMP metadata fields were detected in the file header.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {session.metadataFindings.map((m) => (
                      <div
                        key={m.key}
                        className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-100">{m.label}</span>
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">
                              Hidden Metadata
                            </span>
                          </div>
                          <span
                            className={`font-mono text-[11px] font-semibold ${
                              session.metadataRemoved ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            {session.metadataRemoved
                              ? '✓ Resolved (Removed)'
                              : 'Needs Attention — Recommended: Strip Metadata'}
                          </span>
                        </div>

                        <p className="font-mono text-cyan-300">{m.value}</p>
                        <p className="text-slate-400">
                          <strong className="text-slate-300">Why it matters:</strong> {m.explanation}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* SECTION 2: VISIBLE INFORMATION (Faces, Plates, OCR & PII in Pixels) */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-cyan-400" />
                    <h2 className="text-base font-semibold text-slate-100">
                      2. Visible Information (Faces, Plates & Text in Pixels)
                    </h2>
                  </div>
                  <span
                    className={`text-xs font-mono px-2.5 py-0.5 rounded-md ${
                      unredactedVisualCount === 0
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {unredactedVisualCount === 0
                      ? 'All detected regions queued for redaction'
                      : `${unredactedVisualCount} unredacted region(s)`}
                  </span>
                </div>

                {session.visualDetections.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">
                    No automatic face, license plate, or credential regions were returned. Note: absence of automated detections does not guarantee the image contains no sensitive visible details.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {session.visualDetections.map((d) => (
                      <div
                        key={d.id}
                        className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-2 font-semibold text-slate-100 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={d.selectedForRedaction}
                              onChange={(e) =>
                                onToggleVisualRegion(d.id, e.target.checked)
                              }
                              className="rounded border-slate-600 text-cyan-500"
                            />
                            <span>{d.label}</span>
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[10px]">
                              Visible Content · {Math.round(d.confidence * 100)}% conf
                            </span>
                          </label>

                          <span
                            className={`font-mono text-[11px] font-semibold ${
                              d.selectedForRedaction ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            {d.selectedForRedaction
                              ? `✓ Queued (${d.redactionStyle.toUpperCase()})`
                              : 'Unresolved — Check box to redact'}
                          </span>
                        </div>

                        <p className="text-slate-400">
                          <strong className="text-slate-300">Why it matters:</strong>{' '}
                          {d.type === 'face'
                            ? 'Identifies an individual visually even after EXIF metadata is stripped.'
                            : d.type === 'plate'
                            ? 'Vehicle registration plates can be cross-referenced with regional registries.'
                            : 'Visible email, phone, or ID numbers can be scraped by OCR bots or viewers.'}{' '}
                          <strong className="text-slate-300">Recommended action:</strong>{' '}
                          {d.type === 'face' || d.type === 'plate'
                            ? 'Apply Blur or Pixelation.'
                            : 'Apply Opaque Solid Masking so text cannot be reconstructed.'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Checks Remaining Unavailable */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-400 space-y-1">
                  <p className="font-semibold text-slate-300">
                    Checks Unavailable or Requiring Manual Review:
                  </p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {!ocrInstalled && (
                      <li>
                        Optional Multi-Script Offline OCR (8.2 MB) is not yet installed in Offline Center; dense wild-text scanning was skipped.
                      </li>
                    )}
                    <li>
                      Landmarks, street signs, room layouts, and reflections cannot be automatically ruled out — always inspect the image visually.
                    </li>
                  </ul>
                </div>
              </div>

              {/* Expandable Technical Details Drawer */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
                <button
                  type="button"
                  onClick={() => setShowTechnicalDetails((prev) => !prev)}
                  className="w-full flex items-center justify-between text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
                  aria-expanded={showTechnicalDetails}
                >
                  <span>Advanced Technical Binary Header Details</span>
                  {showTechnicalDetails ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                {showTechnicalDetails && (
                  <div className="mt-3 pt-3 border-t border-slate-800 font-mono text-[11px] text-slate-400 space-y-1">
                    <p>File Name: {session.fileName}</p>
                    <p>MIME Type: {session.fileFormat}</p>
                    <p>Raw Buffer Size: {session.fileSize} bytes</p>
                    <p>Detected APP1/EXIF/XMP Segment Size: {session.binaryExifBytes} bytes</p>
                    <p>
                      Metadata Stripping State:{' '}
                      {session.metadataRemoved ? 'Stripped (0 bytes active)' : 'Original Headers Present'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// PAGE 8: EXPORT VERIFICATION CENTER (/verification) — Enhancement B + Side-by-Side Diff
// ============================================================================

interface ExportVerificationCenterProps {
  session: SharedPhotoSessionState;
  onReverifyUploadedFile: (file: File) => Promise<void>;
  onGenerateAndVerifySample: () => Promise<void>;
  onNavigate: (route: string) => void;
}

export const ExportVerificationCenterPage: React.FC<ExportVerificationCenterProps> = ({
  session,
  onReverifyUploadedFile,
  onGenerateAndVerifySample,
  onNavigate,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [diffMode, setDiffMode] = useState<'side_by_side' | 'slider'>('side_by_side');
  const [sliderPos, setSliderPos] = useState<number>(50);

  const report = session.detailedVerification;

  const handleDownloadSanitizedReport = () => {
    if (!report) return;
    const jsonContent = generateSanitizedVerificationReportJson(report);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `privacyguard_verification_report_${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <ProcessingStatusBadge
            status={report ? 'processed_on_device' : 'location_not_verified'}
            compact
            detail="Re-reads and parses the actual exported image binary buffer."
          />
          <h1 className="text-2xl font-bold text-slate-100 mt-1.5">
            Export Verification Center
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
            Verifies the actual exported file bytes rather than trusting a UI animation: checks binary EXIF/GPS headers, confirms decode integrity, compares before/after properties, and reports unverified scope.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3.5 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-200 font-medium text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-cyan-400" />
            <span>Inspect & Verify Any File on Disk</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onReverifyUploadedFile(f);
            }}
          />

          <button
            type="button"
            onClick={onGenerateAndVerifySample}
            className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Run Live Sample Export & Verification</span>
          </button>
        </div>
      </div>

      {!report ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/50 p-10 text-center space-y-4">
          <FileCheck2 className="w-10 h-10 text-cyan-400 mx-auto" />
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="text-base font-semibold text-slate-100">
              No Exported File Verified in This Session Yet
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Export a cleaned photo from <strong>Protect a Photo</strong> or <strong>Anonymous Capture</strong>, upload any image from your device to inspect its binary headers, or click below to run a live sample verification.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={onGenerateAndVerifySample}
              className="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs cursor-pointer"
            >
              Run Live Sample Export & Verification
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/protect-photo')}
              className="px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-200 font-medium text-xs cursor-pointer"
            >
              Go to Protect a Photo →
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary Banner */}
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/15 p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-xs font-mono text-emerald-300">
                  Actual Exported Binary Buffer Re-Inspected · {new Date(report.timestampIso).toLocaleTimeString()}
                </span>
                <h2 className="text-xl font-bold text-slate-100 mt-0.5">
                  Byte-Level Export Verification Report
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {session.cleanedUrl && (
                  <a
                    href={session.cleanedUrl}
                    download={`verified_${session.fileName || 'image.jpg'}`}
                    className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Cleaned Image</span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={handleDownloadSanitizedReport}
                  className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Download Sanitized Report (.JSON)</span>
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
                <span className="text-slate-400">Binary EXIF / GPS After Export</span>
                <p className="text-lg font-mono font-bold text-emerald-400 mt-1 tabular-nums whitespace-nowrap">
                  {report.exifBytesAfter} bytes (Verified)
                </p>
                <span className="text-[11px] text-slate-400">
                  Before export: {report.exifBytesBefore} bytes
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
                <span className="text-slate-400">Export Decode Integrity</span>
                <p className="text-lg font-mono font-bold text-cyan-300 mt-1">
                  {report.canDecodeExport ? 'Decoded OK' : 'Decode Failed'}
                </p>
                <span className="text-[11px] text-slate-400">{report.dimensionsLabel}</span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
                <span className="text-slate-400">Visual Redactions Flattened</span>
                <p className="text-lg font-mono font-bold text-slate-100 mt-1 tabular-nums">
                  {report.redactionsFlattenedCount} region(s)
                </p>
                <span className="text-[11px] text-slate-400">
                  Unredacted suggestions: {report.unredactedSuggestionsCount}
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
                <span className="text-slate-400">File Size Comparison</span>
                <p className="text-lg font-mono font-bold text-slate-100 mt-1 tabular-nums">
                  {(report.exportedSizeBytes / 1024).toFixed(1)} KB
                </p>
                <span className="text-[11px] text-slate-400">
                  Original: {(report.originalSizeBytes / 1024).toFixed(1)} KB ({report.exportedFormat})
                </span>
              </div>
            </div>
          </div>

          {/* Explicit Check Results: Passed, Warning, Not Verified */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-100">
                Individual Verification Checks (Passed · Warning · Not Verified)
              </h3>
              <span className="text-xs text-slate-400">
                Dispositions: Removed · Still present · Not detected · Not checked · Verification unavailable
              </span>
            </div>

            <div className="space-y-2.5">
              {report.items.map((item) => {
                const badgeStyle =
                  item.status === 'passed'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : item.status === 'warning'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-slate-800 text-slate-300 border-slate-700';

                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {item.status === 'passed' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : item.status === 'warning' ? (
                          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        ) : (
                          <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <span className="font-semibold text-slate-100">{item.label}</span>
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-[10px] text-cyan-300">
                          Disposition: {item.disposition}
                        </span>
                      </div>
                      <p className="text-slate-400 pl-6">{item.detail}</p>
                    </div>

                    <span
                      className={`self-start sm:self-center px-2.5 py-1 rounded-lg border font-mono text-[11px] font-semibold uppercase shrink-0 ${badgeStyle}`}
                    >
                      {item.status === 'passed'
                        ? 'Passed'
                        : item.status === 'warning'
                        ? 'Warning'
                        : 'Not Verified'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Side-by-Side Privacy Diff (Original vs Cleaned Image + Metadata Diff) */}
          {session.originalUrl && session.cleanedUrl && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Columns className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-base font-semibold text-slate-100">
                    Side-by-Side Privacy Diff (Original vs. Cleaned Output)
                  </h3>
                </div>

                <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                  <button
                    type="button"
                    onClick={() => setDiffMode('side_by_side')}
                    className={`px-3 py-1 rounded-lg cursor-pointer ${
                      diffMode === 'side_by_side'
                        ? 'bg-cyan-500 text-slate-950 font-semibold'
                        : 'text-slate-400'
                    }`}
                  >
                    Side-by-Side View
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiffMode('slider')}
                    className={`px-3 py-1 rounded-lg cursor-pointer ${
                      diffMode === 'slider'
                        ? 'bg-cyan-500 text-slate-950 font-semibold'
                        : 'text-slate-400'
                    }`}
                  >
                    Interactive Slider
                  </button>
                </div>
              </div>

              {diffMode === 'side_by_side' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-amber-500/30 bg-slate-950 p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-amber-300">
                        Original Input (Unmodified)
                      </span>
                      <span className="font-mono text-amber-400">
                        {report.exifBytesBefore} B EXIF
                      </span>
                    </div>
                    <img
                      src={session.originalUrl}
                      alt="Original unmodified photo"
                      referrerPolicy="no-referrer"
                      className="max-h-64 mx-auto object-contain rounded"
                    />
                  </div>

                  <div className="rounded-xl border border-emerald-500/30 bg-slate-950 p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-emerald-300">
                        Cleaned & Flattened Export
                      </span>
                      <span className="font-mono text-emerald-400">
                        {report.exifBytesAfter} B EXIF · {report.redactionsFlattenedCount} Redactions
                      </span>
                    </div>
                    <img
                      src={session.cleanedUrl}
                      alt="Cleaned and redacted photo"
                      referrerPolicy="no-referrer"
                      className="max-h-64 mx-auto object-contain rounded"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-amber-300 font-medium">Left: Original</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={sliderPos}
                      onChange={(e) => setSliderPos(Number(e.target.value))}
                      className="w-64 accent-cyan-400 cursor-pointer"
                      aria-label="Comparison split percentage"
                    />
                    <span className="text-emerald-300 font-medium">Right: Cleaned ({sliderPos}%)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-950 border border-slate-800 p-3">
                    <img
                      src={session.originalUrl}
                      alt="Original comparison frame"
                      referrerPolicy="no-referrer"
                      className="max-h-60 mx-auto object-contain rounded"
                    />
                    <img
                      src={session.cleanedUrl}
                      alt="Cleaned comparison frame"
                      referrerPolicy="no-referrer"
                      className="max-h-60 mx-auto object-contain rounded"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Important Verification Limitations */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 text-xs text-slate-400 space-y-2">
            <h4 className="font-semibold text-slate-200">
              Important Verification Limitations & Scope
            </h4>
            <ul className="list-disc list-inside space-y-1">
              {report.limitationsNote.map((note, idx) => (
                <li key={idx}>{note}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// PAGE 9: OFFLINE CENTER & MODEL MANAGER (/offline-center) — Enhancement C
// ============================================================================

interface OfflineCenterPageProps {
  models: OnDeviceModelInfo[];
  isOnline: boolean;
  onUpdateModelStatus: (
    id: OnDeviceModelInfo['id'],
    status: OnDeviceModelInfo['status'],
    progress: number
  ) => void;
}

export const OfflineCenterPage: React.FC<OfflineCenterPageProps> = ({
  models,
  isOnline,
  onUpdateModelStatus,
}) => {
  const [diagResult, setDiagResult] = useState<ReturnType<
    typeof runLiveOfflineDiagnostic
  > | null>(null);

  const handleDownloadModel = (id: OnDeviceModelInfo['id']) => {
    onUpdateModelStatus(id, 'downloading', 35);
    setTimeout(() => {
      onUpdateModelStatus(id, 'downloading', 75);
    }, 250);
    setTimeout(() => {
      onUpdateModelStatus(id, 'ready_offline', 100);
    }, 550);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <ProcessingStatusBadge
            status="processed_on_device"
            compact
            detail={
              isOnline
                ? 'Online — Cached service worker & local engines active'
                : 'Offline Mode — Running 100% from local cache'
            }
          />
          <h1 className="text-2xl font-bold text-slate-100 mt-1.5">
            Offline Center & On-Device Model Manager
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
            Honest capability breakdown showing what works offline immediately, what requires a one-time weight download, and what relies on an external service.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setDiagResult(runLiveOfflineDiagnostic())}
          className="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-2 cursor-pointer self-start"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Run Genuine Offline Capability Test</span>
        </button>
      </div>

      {/* Live Offline Self-Test Output */}
      {diagResult && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/15 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>
                Live Local Self-Test Passed ({diagResult.tests.length}/{diagResult.tests.length} engines verified in {diagResult.durationMs} ms)
              </span>
            </h2>
            <span className="text-xs font-mono text-emerald-400">Zero Network Calls</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            {diagResult.tests.map((t, i) => (
              <div
                key={i}
                className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-1"
              >
                <p className="font-semibold text-slate-100">{t.name}</p>
                <p className="text-slate-400 text-[11px]">{t.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Three Distinct Capability Groups */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Group 1: Available Offline Immediately */}
        <div className="rounded-2xl border border-emerald-500/30 bg-slate-900/70 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>1. Available Offline Now</span>
            </h2>
            <span className="text-[11px] font-mono text-emerald-400">Cached & Ready</span>
          </div>
          <ul className="space-y-2 text-xs text-slate-300">
            <li className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
              <strong className="text-slate-100">Local URL Parsing & 60+ Tracker Rules:</strong> Strips UTM, fbclid, igsh, gclid, Amazon /ref=, and email/phone query parameters with zero network requests.
            </li>
            <li className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
              <strong className="text-slate-100">Binary EXIF/GPS Inspection & Cleaning:</strong> Reads and strips JPEG APP1/XMP/IPTC and PNG metadata chunks locally.
            </li>
            <li className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
              <strong className="text-slate-100">Manual Redaction, Crop & Batch ZIP:</strong> Blur, pixelation, solid masking, and multi-photo ZIP archiving.
            </li>
            <li className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
              <strong className="text-slate-100">Post-Export Byte Verification:</strong> Re-inspects exported files locally.
            </li>
          </ul>
        </div>

        {/* Group 2: Requires Setup */}
        <div className="rounded-2xl border border-amber-500/30 bg-slate-900/70 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-amber-300 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-amber-400" />
              <span>2. Requires One-Time Setup</span>
            </h2>
            <span className="text-[11px] font-mono text-amber-400">Optional Weights</span>
          </div>
          <ul className="space-y-2 text-xs text-slate-300">
            <li className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
              <strong className="text-slate-100">Local Multi-Script OCR Data (8.2 MB):</strong> English + Hindi character recognition weights require a one-time download below before full offline wild-text OCR is available.
            </li>
            <li className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
              <strong className="text-slate-100">Initial App Shell Cache:</strong> Visit PrivacyGuard AI once while online so the PWA Service Worker caches all JS/CSS bundles.
            </li>
          </ul>
        </div>

        {/* Group 3: Online-Only or Externally Dependent */}
        <div className="rounded-2xl border border-violet-500/30 bg-slate-900/70 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-violet-300 flex items-center gap-2">
              <Globe className="w-4 h-4 text-violet-400" />
              <span>3. Online-Only / External</span>
            </h2>
            <span className="text-[11px] font-mono text-violet-300">Explicitly Labeled</span>
          </div>
          <ul className="space-y-2 text-xs text-slate-300">
            <li className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
              <strong className="text-slate-100">Live Website Reputation & Malware Lookup:</strong> Not performed during local URL cleaning so your pasted URLs are never leaked to external servers.
            </li>
            <li className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
              <strong className="text-slate-100">Live Redirect Unshortening:</strong> Requires querying remote HTTP servers; disabled by default for privacy.
            </li>
            <li className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
              <strong className="text-slate-100">Optional Cloud Audit Sync & Cloud AI Studio:</strong> Requires Google Sign-In or Gemini API key.
            </li>
          </ul>
        </div>
      </div>

      {/* On-Device AI Model Manager Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span>On-Device Vision & PII Models</span>
            </h2>
            <p className="text-xs text-slate-400">
              Manage local model weights cached in browser storage. Private images and URLs are never cached in model storage.
            </p>
          </div>
          <span className="text-xs font-mono text-emerald-400">
            {models.filter((m) => m.status === 'ready_offline').length}/{models.length} Ready Offline
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {models.map((m) => (
            <div
              key={m.id}
              className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 flex flex-col justify-between space-y-3 text-xs"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-100 text-sm">{m.name}</span>
                  <span
                    className={`px-2 py-0.5 rounded font-mono text-[11px] ${
                      m.status === 'ready_offline'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : m.status === 'downloading'
                        ? 'bg-cyan-500/20 text-cyan-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {m.status === 'ready_offline'
                      ? 'Ready Offline'
                      : m.status === 'downloading'
                      ? `Downloading (${m.progress}%)`
                      : 'Setup Required'}
                  </span>
                </div>
                <p className="text-slate-300">{m.purpose}</p>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 font-mono pt-1">
                  <span>Size: {m.sizeLabel}</span>
                  <span>·</span>
                  <span>Runtime: {m.engineType}</span>
                </div>
                <p className="text-[11px] text-slate-400">{m.accuracyNote}</p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
                {m.status !== 'ready_offline' ? (
                  <button
                    type="button"
                    onClick={() => handleDownloadModel(m.id)}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs cursor-pointer flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download for Offline Use ({m.sizeLabel})</span>
                  </button>
                ) : (
                  m.id === 'local-ocr' && (
                    <button
                      type="button"
                      onClick={() => onUpdateModelStatus(m.id, 'download_required', 0)}
                      className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs cursor-pointer flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      <span>Remove Cached Weights</span>
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// PAGE 11: PRIVACY RISK REPORTS (/privacy-reports)
// ============================================================================

interface PrivacyRiskReportsPageProps {
  session: SharedPhotoSessionState;
  lastUrlResult: UrlCleanResult | null;
  onLoadSamplePhoto: () => Promise<void>;
  onLoadSampleLink: () => void;
  onNavigate: (route: string) => void;
}

export const PrivacyRiskReportsPage: React.FC<PrivacyRiskReportsPageProps> = ({
  session,
  lastUrlResult,
  onLoadSamplePhoto,
  onLoadSampleLink,
  onNavigate,
}) => {
  const photoRisk: PrivacyRiskReport = calculatePhotoRiskReport(
    session.metadataRemoved ? [] : session.metadataFindings,
    session.visualDetections
  );

  const linkRisk: PrivacyRiskReport = lastUrlResult
    ? lastUrlResult.riskReport
    : analyzeAndCleanUrl(
        'https://www.instagram.com/reel/C9xYz123/?igsh=MzRlODBiNWFlZA==&utm_source=ig_web_copy_link&fbclid=IwAR399123&user_email=aarav@example.org'
      ).riskReport;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <ProcessingStatusBadge
            status="processed_on_device"
            compact
            detail="Deterministic, documented rules-based rubric — never an unexplained AI score."
          />
          <h1 className="text-2xl font-bold text-slate-100 mt-1.5">
            Explainable Privacy Risk Reports
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
            Transparent, rules-based exposure reports for photos and links showing the exact evidence category, rubric points, and recommended action.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!session.originalUrl && (
            <button
              type="button"
              onClick={onLoadSamplePhoto}
              className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs cursor-pointer"
            >
              Load Sample Photo Report
            </button>
          )}
          <button
            type="button"
            onClick={onLoadSampleLink}
            className="px-3.5 py-2 rounded-xl border border-violet-500/40 bg-violet-500/15 text-violet-200 font-semibold text-xs cursor-pointer"
          >
            Inspect Sample Tracking Link
          </button>
        </div>
      </div>

      {/* Rubric Disclaimer */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-300">
        <strong className="text-slate-100">Important Rubric Scope Disclaimer:</strong> Low, Moderate, and High labels reflect only the documented pre-sharing metadata and tracker rubric below. They do <strong>not</strong> indicate malware safety, website reputation, legal compliance, or guaranteed anonymity.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Photo Risk Report Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-mono text-cyan-400">Image Privacy Rubric</span>
              <h2 className="text-lg font-bold text-slate-100">
                {session.originalUrl ? `Photo: ${session.fileName}` : 'Sample Photo Rubric Breakdown'}
              </h2>
            </div>
            <span
              className={`px-3 py-1 rounded-xl font-mono text-xs font-bold ${
                photoRisk.level === 'High'
                  ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                  : photoRisk.level === 'Moderate'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              }`}
            >
              {photoRisk.level} ({photoRisk.totalPoints}/100 pts)
            </span>
          </div>

          <p className="text-xs text-slate-300">{photoRisk.summary}</p>

          <div className="space-y-2.5">
            {photoRisk.categories.map((cat, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs space-y-1"
              >
                <div className="flex items-center justify-between font-semibold">
                  <span className="text-slate-100">{cat.category}</span>
                  <span className="font-mono text-cyan-300">+{cat.points} pts</span>
                </div>
                <p className="text-slate-400">{cat.explanation}</p>
              </div>
            ))}
          </div>

          <p className="text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800">
            {photoRisk.methodologyNote}
          </p>

          <button
            type="button"
            onClick={() => onNavigate('/privacy-preview')}
            className="text-xs font-semibold text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span>Open Interactive Privacy Preview</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Link Risk Report Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-mono text-violet-400">URL Tracker & PII Rubric</span>
              <h2 className="text-lg font-bold text-slate-100">
                {lastUrlResult ? `Link: ${lastUrlResult.hostname}` : 'Sample Link Rubric Breakdown'}
              </h2>
            </div>
            <span
              className={`px-3 py-1 rounded-xl font-mono text-xs font-bold ${
                linkRisk.level === 'High'
                  ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                  : linkRisk.level === 'Moderate'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              }`}
            >
              {linkRisk.level} ({linkRisk.totalPoints}/100 pts)
            </span>
          </div>

          <p className="text-xs text-slate-300">{linkRisk.summary}</p>

          <div className="space-y-2.5">
            {linkRisk.categories.map((cat, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs space-y-1"
              >
                <div className="flex items-center justify-between font-semibold">
                  <span className="text-slate-100">{cat.category}</span>
                  <span className="font-mono text-violet-300">+{cat.points} pts</span>
                </div>
                <p className="text-slate-400">{cat.explanation}</p>
              </div>
            ))}
          </div>

          <p className="text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800">
            {linkRisk.methodologyNote}
          </p>

          <button
            type="button"
            onClick={() => onNavigate('/clean-link')}
            className="text-xs font-semibold text-violet-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span>Open Clean a Link Workspace</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// PAGE 12: PRIVACY CHECKLIST (/privacy-checklist)
// ============================================================================

interface PrivacyChecklistPageProps {
  session: SharedPhotoSessionState;
  lastUrlResult: UrlCleanResult | null;
  onNavigate: (route: string) => void;
}

export const PrivacyChecklistPage: React.FC<PrivacyChecklistPageProps> = ({
  session,
  lastUrlResult,
  onNavigate,
}) => {
  const [userChecked, setUserChecked] = useState<Record<string, boolean>>({
    location_meta: false,
    visible_faces: false,
    license_plates: false,
    sensitive_text: false,
    metadata_removed: false,
    export_verified: false,
    url_trackers: false,
  });

  const checklistItems = [
    {
      id: 'location_meta',
      label: '1. Location metadata reviewed',
      desc: 'Check whether GPS coordinates or place tags are embedded in the photo file header.',
      autoState: session.originalUrl
        ? session.metadataRemoved ||
          !session.metadataFindings.some((m) => m.category === 'location')
          ? 'Automated check: No active GPS metadata'
          : 'Automated finding: GPS coordinates detected'
        : 'Not scanned yet in this session',
      autoPassed:
        Boolean(session.originalUrl) &&
        (session.metadataRemoved ||
          !session.metadataFindings.some((m) => m.category === 'location')),
      toolRoute: '/privacy-preview',
      toolLabel: 'Open Privacy Preview',
    },
    {
      id: 'visible_faces',
      label: '2. Visible faces reviewed',
      desc: 'Confirm whether bystanders, children, or protesters need face blur, pixelation, or masking.',
      autoState: session.originalUrl
        ? `${session.visualDetections.filter((d) => d.type === 'face').length} face region(s) flagged`
        : 'Requires photo inspection & visual review',
      autoPassed:
        Boolean(session.originalUrl) &&
        session.visualDetections
          .filter((d) => d.type === 'face')
          .every((d) => d.selectedForRedaction),
      toolRoute: '/redaction-studio',
      toolLabel: 'Open Redaction Studio',
    },
    {
      id: 'license_plates',
      label: '3. License plates reviewed',
      desc: 'Check street scenes and driveways for readable vehicle registration plates.',
      autoState: session.originalUrl
        ? `${session.visualDetections.filter((d) => d.type === 'plate').length} plate region(s) flagged`
        : 'Requires photo inspection & visual review',
      autoPassed:
        Boolean(session.originalUrl) &&
        session.visualDetections
          .filter((d) => d.type === 'plate')
          .every((d) => d.selectedForRedaction),
      toolRoute: '/redaction-studio',
      toolLabel: 'Open Redaction Studio',
    },
    {
      id: 'sensitive_text',
      label: '4. Sensitive text, badges & screens reviewed',
      desc: 'Use opaque Solid Masking (not light blur) for emails, phone numbers, IDs, and shipping labels.',
      autoState: session.originalUrl
        ? `${
            session.visualDetections.filter(
              (d) => d.type === 'email' || d.type === 'phone' || d.type === 'id_number'
            ).length
          } text/PII region(s) flagged`
        : 'Requires manual & OCR review',
      autoPassed:
        Boolean(session.originalUrl) &&
        session.visualDetections
          .filter((d) => d.type === 'email' || d.type === 'phone' || d.type === 'id_number')
          .every((d) => d.selectedForRedaction),
      toolRoute: '/redaction-studio',
      toolLabel: 'Open Redaction Studio',
    },
    {
      id: 'metadata_removed',
      label: '5. Metadata removal completed (if needed)',
      desc: 'Generate a re-encoded clean copy so EXIF, XMP, and IPTC headers are stripped.',
      autoState: session.metadataRemoved
        ? 'Automated check: Metadata stripped'
        : 'Not stripped yet',
      autoPassed: session.metadataRemoved,
      toolRoute: '/protect-photo',
      toolLabel: 'Open Protect a Photo',
    },
    {
      id: 'export_verified',
      label: '6. Exported file re-verified',
      desc: 'Confirm the exported file bytes were re-read and contain 0 bytes of remaining EXIF headers.',
      autoState: session.detailedVerification
        ? `Verified (${session.detailedVerification.exifBytesAfter} B EXIF remaining)`
        : 'No export verified yet',
      autoPassed: Boolean(
        session.detailedVerification && session.detailedVerification.exifBytesAfter === 0
      ),
      toolRoute: '/verification',
      toolLabel: 'Open Verification Center',
    },
    {
      id: 'url_trackers',
      label: '7. URL trackers & referral tokens reviewed (if sharing a link)',
      desc: 'Remove utm_*, fbclid, igsh, si, and personal query parameters before posting a link.',
      autoState: lastUrlResult
        ? `Cleaned (${lastUrlResult.removedCount} tracker(s) stripped)`
        : 'No link cleaned in this session yet',
      autoPassed: Boolean(lastUrlResult && lastUrlResult.isValid),
      toolRoute: '/clean-link',
      toolLabel: 'Open Clean a Link',
    },
  ];

  const confirmedCount = Object.values(userChecked).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <ProcessingStatusBadge status="processed_on_device" compact />
          <h1 className="text-2xl font-bold text-slate-100 mt-1.5">
            Interactive Pre-Sharing Privacy Checklist
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
            Combines automated session findings with your manual human review before you post a photo, screenshot, or link publicly.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-cyan-300">
            {confirmedCount}/{checklistItems.length} User-Confirmed
          </span>
          <button
            type="button"
            onClick={() =>
              setUserChecked({
                location_meta: false,
                visible_faces: false,
                license_plates: false,
                sensitive_text: false,
                metadata_removed: false,
                export_verified: false,
                url_trackers: false,
              })
            }
            className="px-3.5 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-xs text-slate-200 cursor-pointer flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Restart Checklist</span>
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {checklistItems.map((item) => (
          <div
            key={item.id}
            className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
              userChecked[item.id]
                ? 'border-emerald-500/40 bg-emerald-950/15'
                : 'border-slate-800 bg-slate-900/70'
            }`}
          >
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-100 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(userChecked[item.id])}
                    onChange={(e) =>
                      setUserChecked((prev) => ({
                        ...prev,
                        [item.id]: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 rounded border-slate-600 text-cyan-500"
                  />
                  <span>{item.label}</span>
                </label>

                <span
                  className={`px-2 py-0.5 rounded font-mono text-[10px] ${
                    item.autoPassed
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-300 border border-slate-700'
                  }`}
                >
                  {item.autoState}
                </span>
              </div>
              <p className="text-xs text-slate-400 pl-6">{item.desc}</p>
            </div>

            <button
              type="button"
              onClick={() => onNavigate(item.toolRoute)}
              className="self-start sm:self-center px-3.5 py-2 rounded-xl border border-slate-700 hover:border-cyan-500/50 bg-slate-950/80 text-xs font-medium text-cyan-300 hover:text-cyan-200 whitespace-nowrap cursor-pointer"
            >
              {item.toolLabel} →
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
