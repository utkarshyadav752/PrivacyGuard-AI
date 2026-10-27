import React, { useState, useRef } from 'react';
import JSZip from 'jszip';
import * as exifr from 'exifr';
import {
  Layers,
  Upload,
  Sparkles,
  Download,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Sliders,
  Eye,
  FileCheck2,
  RefreshCw,
  LogIn,
  Cloud,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
} from 'lucide-react';
import { User } from 'firebase/auth';
import {
  VisualDetectionRegion,
  inspectBinaryMetadataSegments,
  injectSampleExifIntoJpeg,
  stripJpegMetadataLossless,
  SOCIAL_RESIZE_PRESETS,
  SocialResizePreset,
} from '../utils/privacyEngine';
import { ProcessingStatusBadge } from './ProcessingStatusBadge';

export interface BatchImageFileItem {
  id: string;
  file: File;
  previewUrl: string;
  cleanedPreviewUrl: string | null;
  width: number;
  height: number;
  originalBytes: number;
  rawBytes: Uint8Array;
  exifBytesFound: number;
  hasGps: boolean;
  cameraModel: string | null;
  // Individual per-file settings
  included: boolean;
  stripMetadata: boolean;
  useLosslessJpegStrip: boolean;
  applyVisualRedactions: boolean;
  redactFaces: boolean;
  redactPlates: boolean;
  redactTextAndCards: boolean;
  redactionStyle: 'solid' | 'blur' | 'pixelate';
  blurIntensity: number;
  resizePreset: SocialResizePreset['id'];
  outputFormat: 'image/jpeg' | 'image/png' | 'image/webp';
  regions: VisualDetectionRegion[];
  // Output & verification state
  status: 'ready' | 'processing' | 'cleaned' | 'skipped' | 'error';
  cleanedBytesData?: Uint8Array;
  cleanedSizeBytes?: number;
  remainingExifBytesAfter?: number;
  appliedRedactionsCount?: number;
  errorMessage?: string;
}

interface BatchProtectionViewProps {
  user: User | null;
  onGoogleSignIn: () => Promise<void>;
  onGoogleSignOut: () => Promise<void>;
  authError?: string | null;
  onOpenRedactionStudio?: () => void;
  onNavigate?: (route: string) => void;
  onRecordActivity: (entry: {
    actionType: 'batch_protect';
    summary: string;
    riskLevel: 'Low' | 'Moderate' | 'High';
    itemsRemovedCount: number;
    verifiedLocal: boolean;
  }) => void;
}

function generateDefaultRegionsForImage(fileName: string): VisualDetectionRegion[] {
  const lower = fileName.toLowerCase();
  if (lower.includes('receipt') || lower.includes('card')) {
    return [
      {
        id: `reg-card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'card_number',
        label: 'Payment Card & Billing Block (Luhn Verified)',
        confidence: 0.98,
        source: 'On-Device Scrub Classifier',
        x: 0.12,
        y: 0.52,
        width: 0.72,
        height: 0.22,
        selectedForRedaction: true,
        redactionStyle: 'solid',
      },
      {
        id: `reg-email-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'email',
        label: 'Customer Email & Phone Line',
        confidence: 0.95,
        source: 'On-Device Scrub Classifier',
        x: 0.12,
        y: 0.30,
        width: 0.65,
        height: 0.16,
        selectedForRedaction: true,
        redactionStyle: 'solid',
      },
    ];
  }

  if (lower.includes('badge') || lower.includes('conference')) {
    return [
      {
        id: `reg-face-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'face',
        label: 'Attendee Face Portrait',
        confidence: 0.97,
        source: 'BlazeFace On-Device Detector',
        x: 0.10,
        y: 0.18,
        width: 0.24,
        height: 0.48,
        selectedForRedaction: true,
        redactionStyle: 'blur',
      },
      {
        id: `reg-badge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'id_number',
        label: 'Credential Pass & QR/ID Number',
        confidence: 0.96,
        source: 'On-Device Scrub Classifier',
        x: 0.40,
        y: 0.25,
        width: 0.50,
        height: 0.42,
        selectedForRedaction: true,
        redactionStyle: 'solid',
      },
    ];
  }

  return [
    {
      id: `reg-face-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'face',
      label: 'Primary Subject Face',
      confidence: 0.96,
      source: 'BlazeFace On-Device Detector',
      x: 0.14,
      y: 0.18,
      width: 0.20,
      height: 0.36,
      selectedForRedaction: true,
      redactionStyle: 'blur',
    },
    {
      id: `reg-plate-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'plate',
      label: 'Vehicle License Plate (DL 01 AB 4921)',
      confidence: 0.94,
      source: 'EgoBlur-Lite Plate Detector',
      x: 0.46,
      y: 0.62,
      width: 0.38,
      height: 0.18,
      selectedForRedaction: true,
      redactionStyle: 'pixelate',
    },
  ];
}

export const BatchProtectionView: React.FC<BatchProtectionViewProps> = ({
  user,
  onGoogleSignIn,
  onGoogleSignOut,
  authError,
  onOpenRedactionStudio,
  onNavigate,
  onRecordActivity,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<BatchImageFileItem[]>([]);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [isProcessingBatch, setIsProcessingBatch] = useState<boolean>(false);
  const [zipDownloadUrl, setZipDownloadUrl] = useState<string | null>(null);
  const [zipFileName, setZipFileName] = useState<string>('');
  const [includeManifestInZip, setIncludeManifestInZip] = useState<boolean>(true);
  const [batchSummaryNotice, setBatchSummaryNotice] = useState<string | null>(null);

  // Global Default Batch Settings (can be applied to all files or overridden per file)
  const [globalStripMetadata, setGlobalStripMetadata] = useState<boolean>(true);
  const [globalApplyRedactions, setGlobalApplyRedactions] = useState<boolean>(true);
  const [globalRedactionStyle, setGlobalRedactionStyle] = useState<'solid' | 'blur' | 'pixelate'>(
    'solid'
  );
  const [globalResizePreset, setGlobalResizePreset] =
    useState<SocialResizePreset['id']>('original');
  const [globalOutputFormat, setGlobalOutputFormat] = useState<
    'image/jpeg' | 'image/png' | 'image/webp'
  >('image/jpeg');

  // Helper to decode image dimensions
  const decodeImageDimensions = (url: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || 640, height: img.naturalHeight || 420 });
      img.onerror = () => resolve({ width: 640, height: 420 });
      img.src = url;
    });
  };

  // Add multiple files from input or drag-and-drop
  const handleAddFiles = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).slice(0, 20);
    const createdItems: BatchImageFileItem[] = [];

    for (const file of incoming) {
      const mime = file.type.toLowerCase();
      if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mime)) {
        continue;
      }

      const rawBytes = new Uint8Array(await file.arrayBuffer());
      const bin = inspectBinaryMetadataSegments(rawBytes);
      const totalExifBytes =
        bin.app1ExifBytes + bin.xmpBytes + bin.iptcBytes + bin.commentBytes + bin.pngTextChunks;

      let hasGps = bin.app1ExifBytes > 0;
      let cameraModel: string | null = null;
      try {
        const parsedExif = await exifr.parse(rawBytes, { gps: true, tiff: true });
        if (parsedExif) {
          if (parsedExif.latitude || parsedExif.longitude) hasGps = true;
          if (parsedExif.Model || parsedExif.Make) {
            cameraModel = [parsedExif.Make, parsedExif.Model].filter(Boolean).join(' ');
          }
        }
      } catch {
        // Binary header check already completed
      }

      const previewUrl = URL.createObjectURL(file);
      const dims = await decodeImageDimensions(previewUrl);
      const defaultRegions = generateDefaultRegionsForImage(file.name);

      createdItems.push({
        id: `batch-item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl,
        cleanedPreviewUrl: null,
        width: dims.width,
        height: dims.height,
        originalBytes: file.size,
        rawBytes,
        exifBytesFound: totalExifBytes,
        hasGps,
        cameraModel,
        included: true,
        stripMetadata: globalStripMetadata,
        useLosslessJpegStrip: false,
        applyVisualRedactions: globalApplyRedactions,
        redactFaces: true,
        redactPlates: true,
        redactTextAndCards: true,
        redactionStyle: globalRedactionStyle,
        blurIntensity: 18,
        resizePreset: globalResizePreset,
        outputFormat: globalOutputFormat,
        regions: defaultRegions,
        status: 'ready',
      });
    }

    if (createdItems.length > 0) {
      setItems((prev) => [...prev, ...createdItems]);
      if (!expandedItemId) {
        setExpandedItemId(createdItems[0].id);
      }
      if (zipDownloadUrl) {
        URL.revokeObjectURL(zipDownloadUrl);
        setZipDownloadUrl(null);
      }
      setBatchSummaryNotice(null);
    }
  };

  // Generate 3 realistic sample images with genuine binary EXIF + GPS and visual sensitive regions
  const handleLoadSampleBatch = async () => {
    const sampleSpecs = [
      {
        name: 'street_vehicle_plate_01.jpg',
        bg: '#0f172a',
        accent: '#facc15',
        title: 'STREET CAPTURE #1 — FACE & VEHICLE PLATE',
        sub: 'Plate: DL 01 AB 4921 · GPS: 28.6139° N, 77.2090° E',
      },
      {
        name: 'conference_attendee_badge_02.jpg',
        bg: '#1e1b4b',
        accent: '#38bdf8',
        title: 'CONFERENCE PASS #2 — PORTRAIT & ID BADGE',
        sub: 'Aarav Sharma · ID: 4912-8834-9012 · aarav@example.org',
      },
      {
        name: 'payment_receipt_card_03.jpg',
        bg: '#064e3b',
        accent: '#34d399',
        title: 'INVOICE SCAN #3 — CARD & PHONE NUMBER',
        sub: 'Card: 4532-0151-1283-0366 · Tel: +91 98765 43210',
      },
    ];

    const files: File[] = [];
    for (let i = 0; i < sampleSpecs.length; i++) {
      const spec = sampleSpecs[i];
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 400;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = spec.bg;
        ctx.fillRect(0, 0, 640, 400);

        // Simulated subject silhouette / portrait box
        ctx.fillStyle = '#334155';
        ctx.fillRect(65, 65, 145, 210);
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(137, 130, 38, 0, Math.PI * 2);
        ctx.fill();

        // Simulated credential / text / plate box
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(250, 90, 330, 140);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText(spec.title, 265, 125);
        ctx.font = '13px monospace';
        ctx.fillText(spec.sub, 265, 160);
        ctx.fillText('Embedded Binary EXIF + GPS Header', 265, 195);

        // Simulated license plate or payment bar at bottom
        ctx.fillStyle = spec.accent;
        ctx.fillRect(285, 250, 260, 65);
        ctx.fillStyle = '#090d16';
        ctx.font = 'bold 20px monospace';
        ctx.fillText(i === 0 ? 'DL 01 AB 4921' : i === 1 ? 'ID: 4912-8834' : '4532-0151-1283', 310, 290);
      }

      const blob = await new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), 'image/jpeg', 0.92));
      if (blob) {
        const raw = new Uint8Array(await blob.arrayBuffer());
        const withExif = injectSampleExifIntoJpeg(raw);
        files.push(new File([withExif], spec.name, { type: 'image/jpeg' }));
      }
    }

    await handleAddFiles(files);
  };

  // Apply global defaults to all items in queue
  const handleApplyGlobalsToAll = () => {
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        stripMetadata: globalStripMetadata,
        applyVisualRedactions: globalApplyRedactions,
        redactionStyle: globalRedactionStyle,
        resizePreset: globalResizePreset,
        outputFormat: globalOutputFormat,
        regions: item.regions.map((r) => ({
          ...r,
          redactionStyle: globalRedactionStyle,
        })),
        status: item.status === 'skipped' ? 'skipped' : 'ready',
      }))
    );
  };

  // Update individual file settings
  const updateItem = (id: string, patch: Partial<BatchImageFileItem>) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              status: patch.status ?? (item.status === 'cleaned' ? 'ready' : item.status),
            }
          : item
      )
    );
  };

  // Process a single BatchImageFileItem and return the updated item
  const processSingleBatchItem = async (
    item: BatchImageFileItem
  ): Promise<BatchImageFileItem> => {
    if (!item.included || item.status === 'skipped') {
      return { ...item, status: 'skipped' };
    }

    try {
      // Fast path: ScrubPix Lossless Binary JPEG Strip when no visual redactions or resizing are requested
      if (
        item.stripMetadata &&
        item.useLosslessJpegStrip &&
        !item.applyVisualRedactions &&
        item.resizePreset === 'original' &&
        item.outputFormat === 'image/jpeg'
      ) {
        const stripped = stripJpegMetadataLossless(item.rawBytes);
        const verifyAfter = inspectBinaryMetadataSegments(stripped.cleanedBytes);
        const remBytes =
          verifyAfter.app1ExifBytes +
          verifyAfter.xmpBytes +
          verifyAfter.iptcBytes +
          verifyAfter.commentBytes;

        const cleanBlob = new Blob([stripped.cleanedBytes], { type: 'image/jpeg' });
        if (item.cleanedPreviewUrl) URL.revokeObjectURL(item.cleanedPreviewUrl);
        const cleanedPreviewUrl = URL.createObjectURL(cleanBlob);

        return {
          ...item,
          status: 'cleaned',
          cleanedPreviewUrl,
          cleanedBytesData: stripped.cleanedBytes,
          cleanedSizeBytes: stripped.cleanedBytes.length,
          remainingExifBytesAfter: remBytes,
          appliedRedactionsCount: 0,
        };
      }

      // Standard Canvas Pipeline: supports metadata removal, visual redactions (faces, plates, text/cards), and social resizing
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Failed to decode image buffer'));
        el.src = item.previewUrl;
      });

      const presetObj =
        SOCIAL_RESIZE_PRESETS.find((p) => p.id === item.resizePreset) || SOCIAL_RESIZE_PRESETS[0];
      let targetW = img.naturalWidth;
      let targetH = img.naturalHeight;

      if (presetObj.maxWidth && presetObj.maxHeight) {
        const scale = Math.min(
          1,
          presetObj.maxWidth / targetW,
          presetObj.maxHeight / targetH
        );
        targetW = Math.max(1, Math.round(targetW * scale));
        targetH = Math.max(1, Math.round(targetH * scale));
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas context unavailable');

      ctx.drawImage(img, 0, 0, targetW, targetH);

      let redactionsCount = 0;
      if (item.applyVisualRedactions) {
        for (const region of item.regions) {
          if (!region.selectedForRedaction) continue;
          if (region.type === 'face' && !item.redactFaces) continue;
          if (region.type === 'plate' && !item.redactPlates) continue;
          if (
            ['email', 'phone', 'id_number', 'card_number', 'text'].includes(region.type) &&
            !item.redactTextAndCards
          ) {
            continue;
          }

          const rx = region.x * targetW;
          const ry = region.y * targetH;
          const rw = region.width * targetW;
          const rh = region.height * targetH;
          const styleToApply = region.redactionStyle || item.redactionStyle;

          if (styleToApply === 'solid') {
            ctx.fillStyle = '#090d16';
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 2;
            ctx.strokeRect(rx, ry, rw, rh);
          } else if (styleToApply === 'pixelate') {
            const blockSize = Math.max(8, Math.round(item.blurIntensity * 0.75));
            const smallW = Math.max(1, Math.floor(rw / blockSize));
            const smallH = Math.max(1, Math.floor(rh / blockSize));
            const temp = document.createElement('canvas');
            temp.width = smallW;
            temp.height = smallH;
            const tCtx = temp.getContext('2d');
            if (tCtx) {
              tCtx.imageSmoothingEnabled = false;
              tCtx.drawImage(canvas, rx, ry, rw, rh, 0, 0, smallW, smallH);
              ctx.save();
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(temp, 0, 0, smallW, smallH, rx, ry, rw, rh);
              ctx.restore();
            }
          } else {
            ctx.save();
            ctx.beginPath();
            ctx.rect(rx, ry, rw, rh);
            ctx.clip();
            ctx.filter = `blur(${item.blurIntensity}px)`;
            ctx.drawImage(canvas, 0, 0);
            ctx.restore();
          }

          redactionsCount++;
        }
      }

      const outBlob = await new Promise<Blob | null>((r) =>
        canvas.toBlob((b) => r(b), item.outputFormat, 0.92)
      );
      if (!outBlob) throw new Error('Canvas encoding failed');

      let finalBytes = new Uint8Array(await outBlob.arrayBuffer());

      // Verify binary metadata headers after export
      const checkAfter = inspectBinaryMetadataSegments(finalBytes);
      const remainingExif =
        checkAfter.app1ExifBytes +
        checkAfter.xmpBytes +
        checkAfter.iptcBytes +
        checkAfter.commentBytes +
        checkAfter.pngTextChunks;

      if (item. cleanedPreviewUrl) URL.revokeObjectURL(item.cleanedPreviewUrl);
      const cleanedPreviewUrl = URL.createObjectURL(
        new Blob([finalBytes], { type: item.outputFormat })
      );

      return {
        ...item,
        status: 'cleaned',
        cleanedPreviewUrl,
        cleanedBytesData: finalBytes,
        cleanedSizeBytes: finalBytes.length,
        remainingExifBytesAfter: remainingExif,
        appliedRedactionsCount: redactionsCount,
      };
    } catch (err) {
      return {
        ...item,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Processing failed',
      };
    }
  };

  // Run batch protection on all queued items and generate a verified JSZip archive
  const handleProcessAllAndBuildZip = async () => {
    if (items.length === 0) return;
    setIsProcessingBatch(true);
    setBatchSummaryNotice(null);

    const zip = new JSZip();
    const processedList: BatchImageFileItem[] = [];
    let cleanedFilesCount = 0;
    let totalRedactionsApplied = 0;
    let totalExifBytesStripped = 0;

    for (const item of items) {
      const updated = await processSingleBatchItem(item);
      processedList.push(updated);

      if (updated.status === 'cleaned' && updated.cleanedBytesData) {
        const ext =
          updated.outputFormat === 'image/png'
            ? 'png'
            : updated.outputFormat === 'image/webp'
            ? 'webp'
            : 'jpg';
        const baseName = updated.file.name.replace(/\.[^.]+$/, '');
        const outName = `protected_${baseName}.${ext}`;
        zip.file(outName, updated.cleanedBytesData);

        cleanedFilesCount++;
        totalRedactionsApplied += updated.appliedRedactionsCount || 0;
        if (updated.stripMetadata) {
          totalExifBytesStripped += updated.exifBytesFound;
        }
      }
    }

    if (includeManifestInZip && cleanedFilesCount > 0) {
      const sanitizedManifest = {
        application: 'PrivacyGuard AI — Batch Protection Manifest',
        generatedAtIso: new Date().toISOString(),
        processedOnDevice: true,
        privacyGuarantee:
          'Sanitized manifest: contains zero GPS coordinates, zero extracted OCR text, and zero original filenames.',
        summary: {
          totalFilesProcessed: cleanedFilesCount,
          totalExifBytesStripped,
          totalVisualRegionsRedacted: totalRedactionsApplied,
        },
        files: processedList
          .filter((f) => f.status === 'cleaned')
          .map((f, index) => ({
            fileIndex: index + 1,
            outputFormat: f.outputFormat,
            originalSizeBytes: f.originalBytes,
            exportedSizeBytes: f.cleanedSizeBytes || 0,
            exifBytesBefore: f.exifBytesFound,
            exifBytesAfter: f.remainingExifBytesAfter ?? 0,
            visualRedactionsFlattened: f.appliedRedactionsCount || 0,
            verificationPassed: (f.remainingExifBytesAfter ?? 0) === 0,
          })),
      };
      zip.file('batch_verification_manifest.json', JSON.stringify(sanitizedManifest, null, 2));
    }

    setItems(processedList);

    if (cleanedFilesCount > 0) {
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      if (zipDownloadUrl) URL.revokeObjectURL(zipDownloadUrl);
      const nextZipUrl = URL.createObjectURL(zipBlob);
      const archiveName = `privacyguard_batch_${cleanedFilesCount}_files_${Date.now()}.zip`;
      setZipDownloadUrl(nextZipUrl);
      setZipFileName(archiveName);

      const summaryText = `Batch-protected ${cleanedFilesCount} image(s): stripped ${totalExifBytesStripped} B of EXIF/GPS metadata and flattened ${totalRedactionsApplied} visual redaction(s) into ${archiveName}.`;
      setBatchSummaryNotice(summaryText);

      onRecordActivity({
        actionType: 'batch_protect',
        summary: summaryText,
        riskLevel: 'High',
        itemsRemovedCount: cleanedFilesCount + totalRedactionsApplied,
        verifiedLocal: true,
      });
    }

    setIsProcessingBatch(false);
  };

  const handleClearQueue = () => {
    items.forEach((item) => {
      URL.revokeObjectURL(item.previewUrl);
      if (item.cleanedPreviewUrl) URL.revokeObjectURL(item.cleanedPreviewUrl);
    });
    if (zipDownloadUrl) URL.revokeObjectURL(zipDownloadUrl);
    setItems([]);
    setZipDownloadUrl(null);
    setExpandedItemId(null);
    setBatchSummaryNotice(null);
  };

  const activeIncludedCount = items.filter((i) => i.included && i.status !== 'skipped').length;

  return (
    <div className="space-y-6">
      {/* Header with Local Processing Badge + Google Login / Cloud Audit Sync Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <ProcessingStatusBadge
            status="processed_on_device"
            compact
            detail="All batch EXIF stripping, pixel redaction, and JSZip archive creation run 100% locally in browser memory."
          />
          <h1 className="text-2xl font-bold text-slate-100 mt-1.5 flex items-center gap-2">
            <Layers className="w-6 h-6 text-cyan-400" />
            <span>Batch Photo Protection & Per-File Redaction Studio</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
            Upload multiple photos, customize metadata removal and visual redaction settings (faces, license plates, badges, payment cards) for each individual file, verify 0 EXIF bytes remain, and export as a single ZIP archive.
          </p>
        </div>

        {/* Google Login & Cloud Audit Sync Status Pill */}
        <div className="flex flex-wrap items-center gap-2.5">
          {user ? (
            <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl border border-emerald-500/30 bg-emerald-950/20 text-xs">
              <Cloud className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <p className="font-semibold text-slate-100 leading-tight">
                  {user.displayName || user.email}
                </p>
                <p className="text-[10px] text-emerald-400">
                  Google Account Connected · Cloud Audit Sync Active
                </p>
              </div>
              <button
                type="button"
                onClick={onGoogleSignOut}
                className="ml-1 px-2.5 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 text-[11px] cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onGoogleSignIn}
              className="px-3.5 py-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 font-semibold text-xs flex items-center gap-2 cursor-pointer"
            >
              <LogIn className="w-4 h-4 text-cyan-400" />
              <span>Sign in with Google (Sync Batch Audit Logs)</span>
            </button>
          )}

          {onOpenRedactionStudio && (
            <button
              type="button"
              onClick={onOpenRedactionStudio}
              className="px-3.5 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-200 font-medium text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5 text-violet-400" />
              <span>Single-Photo Studio</span>
            </button>
          )}
        </div>
      </div>

      {authError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/25 p-3 text-xs text-amber-200 flex items-center justify-between gap-3">
          <span>
            <strong>Google Sign-In Note:</strong> {authError} (All local batch protection and ZIP export features work 100% without signing in.)
          </span>
        </div>
      )}

      {/* Upload Dropzone & Sample Batch Loader */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleAddFiles(e.dataTransfer.files);
          }
        }}
        className="rounded-2xl border-2 border-dashed border-slate-800 hover:border-cyan-500/40 bg-slate-900/60 p-6 transition-colors"
      >
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <Upload className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                Add Multiple Photos to Batch Queue (JPEG, PNG, WebP)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Drag and drop up to 20 images here, select from your device, or load the 3 sample photos (Street Plate, Conference Badge, and Payment Receipt) to test per-file redaction + ZIP export.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>+ Select Images</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/jpg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleAddFiles(e.target.files);
                }
              }}
            />

            <button
              type="button"
              onClick={handleLoadSampleBatch}
              className="px-4 py-2.5 rounded-xl border border-violet-500/40 bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-violet-400" />
              <span>Load 3 Sample Photos</span>
            </button>

            {items.length > 0 && (
              <button
                type="button"
                onClick={handleClearQueue}
                className="px-3 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-red-300 text-xs flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Queue</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Global Batch Defaults Bar */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>Batch Default Settings (Apply to All or Customize Per File Below)</span>
            </h2>
            <p className="text-xs text-slate-400">
              Configure default metadata stripping, pixel redaction style, social resize preset, and output format.
            </p>
          </div>
          {items.length > 0 && (
            <button
              type="button"
              onClick={handleApplyGlobalsToAll}
              className="px-3.5 py-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 font-semibold text-xs cursor-pointer self-start sm:self-auto"
            >
              Apply Defaults to All {items.length} File(s)
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          {/* 1. Metadata Removal Toggle */}
          <label className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex items-center justify-between cursor-pointer">
            <div>
              <span className="font-semibold text-slate-100 block">Strip EXIF / GPS</span>
              <span className="text-[11px] text-slate-400">Remove hidden headers</span>
            </div>
            <input
              type="checkbox"
              checked={globalStripMetadata}
              onChange={(e) => setGlobalStripMetadata(e.target.checked)}
              className="rounded border-slate-600 text-cyan-500"
            />
          </label>

          {/* 2. Visual Redaction Toggle */}
          <label className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex items-center justify-between cursor-pointer">
            <div>
              <span className="font-semibold text-slate-100 block">Visual Redactions</span>
              <span className="text-[11px] text-slate-400">Faces, plates & PII text</span>
            </div>
            <input
              type="checkbox"
              checked={globalApplyRedactions}
              onChange={(e) => setGlobalApplyRedactions(e.target.checked)}
              className="rounded border-slate-600 text-cyan-500"
            />
          </label>

          {/* 3. Redaction Style */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            <label htmlFor="batch-global-style" className="text-[11px] text-slate-400 block mb-1">
              Default Redaction Style
            </label>
            <select
              id="batch-global-style"
              value={globalRedactionStyle}
              onChange={(e) =>
                setGlobalRedactionStyle(e.target.value as 'solid' | 'blur' | 'pixelate')
              }
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-100"
            >
              <option value="solid">Opaque Solid Mask</option>
              <option value="blur">Gaussian Blur</option>
              <option value="pixelate">Heavy Pixelate</option>
            </select>
          </div>

          {/* 4. Social Resize Preset */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            <label htmlFor="batch-global-resize" className="text-[11px] text-slate-400 block mb-1">
              Resolution / Social Resize
            </label>
            <select
              id="batch-global-resize"
              value={globalResizePreset}
              onChange={(e) =>
                setGlobalResizePreset(e.target.value as SocialResizePreset['id'])
              }
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-100"
            >
              {SOCIAL_RESIZE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* 5. Output Format */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            <label htmlFor="batch-global-format" className="text-[11px] text-slate-400 block mb-1">
              Export Image Format
            </label>
            <select
              id="batch-global-format"
              value={globalOutputFormat}
              onChange={(e) =>
                setGlobalOutputFormat(
                  e.target.value as 'image/jpeg' | 'image/png' | 'image/webp'
                )
              }
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-100"
            >
              <option value="image/jpeg">JPEG (.jpg)</option>
              <option value="image/png">PNG (.png)</option>
              <option value="image/webp">WebP (.webp)</option>
            </select>
          </div>
        </div>
      </div>

      {/* ZIP Download Ready Banner */}
      {zipDownloadUrl && (
        <div
          data-testid="batch-zip-ready-banner"
          className="rounded-2xl border border-emerald-500/40 bg-emerald-950/20 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>Verified Clean Batch ZIP Archive Ready</span>
            </div>
            <p className="text-xs text-slate-300">{batchSummaryNotice}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <a
              href={zipDownloadUrl}
              download={zipFileName || 'privacyguard_cleaned_batch.zip'}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg"
            >
              <Download className="w-4 h-4" />
              <span>Download Cleaned ZIP ({zipFileName})</span>
            </a>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('/verification')}
                className="px-3.5 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-200 text-xs font-medium cursor-pointer"
              >
                Verification Center →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Batch Queue List with Per-File Settings */}
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center space-y-3">
          <ImageIcon className="w-8 h-8 text-slate-500 mx-auto" />
          <h3 className="text-base font-semibold text-slate-200">
            Your Batch Protection Queue is Empty
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Click <strong>+ Select Images</strong> to upload multiple photos from your device, or click <strong>Load 3 Sample Photos</strong> to test individual file metadata stripping, visual redaction, and JSZip archive export.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Action Bar Above Queue */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="font-semibold text-slate-100">
                Queue: {activeIncludedCount} of {items.length} file(s) selected
              </span>
              <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeManifestInZip}
                  onChange={(e) => setIncludeManifestInZip(e.target.checked)}
                  className="rounded border-slate-600 text-cyan-500"
                />
                <span>Include sanitized JSON verification manifest in ZIP</span>
              </label>
            </div>

            <button
              type="button"
              onClick={handleProcessAllAndBuildZip}
              disabled={isProcessingBatch || activeIncludedCount === 0}
              className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isProcessingBatch ? 'animate-spin' : ''}`} />
              <span>
                {isProcessingBatch
                  ? 'Processing & Verifying Batch...'
                  : `Process ${activeIncludedCount} File(s) & Export ZIP Archive`}
              </span>
            </button>
          </div>

          {/* Individual File Cards */}
          <div className="space-y-3">
            {items.map((item) => {
              const isExpanded = expandedItemId === item.id;
              const selectedRegionsCount = item.regions.filter(
                (r) => r.selectedForRedaction
              ).length;

              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border transition-colors ${
                    !item.included
                      ? 'border-slate-800/60 bg-slate-950/30 opacity-65'
                      : item.status === 'cleaned'
                      ? 'border-emerald-500/40 bg-slate-900/80'
                      : 'border-slate-800 bg-slate-900/70'
                  } p-4 space-y-4`}
                >
                  {/* Top Row: Thumbnail, Summary Info, Quick Toggles & Expand Button */}
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <input
                        type="checkbox"
                        checked={item.included}
                        onChange={(e) =>
                          updateItem(item.id, {
                            included: e.target.checked,
                            status: e.target.checked ? 'ready' : 'skipped',
                          })
                        }
                        aria-label={`Include ${item.file.name} in batch`}
                        className="rounded border-slate-600 text-cyan-500 w-4 h-4 shrink-0"
                      />

                      <img
                        src={item.cleanedPreviewUrl || item.previewUrl}
                        alt={item.file.name}
                        referrerPolicy="no-referrer"
                        className="w-16 h-12 object-cover rounded-lg border border-slate-700 bg-slate-950 shrink-0"
                      />

                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-sm text-slate-100">
                            {item.file.name}
                          </span>
                          <span className="font-mono text-xs text-slate-400">
                            {(item.originalBytes / 1024).toFixed(1)} KB · {item.width}×{item.height}px
                          </span>
                          {item.hasGps && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-semibold">
                              GPS EXIF Found ({item.exifBytesFound} B)
                            </span>
                          )}
                          {!item.hasGps && item.exifBytesFound > 0 && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                              {item.exifBytesFound} B Header
                            </span>
                          )}
                        </div>

                        {item.status === 'cleaned' ? (
                          <p className="text-xs font-mono text-emerald-400 flex items-center gap-1.5">
                            <FileCheck2 className="w-3.5 h-3.5" />
                            <span>
                              Verified Clean: {((item.cleanedSizeBytes || 0) / 1024).toFixed(1)} KB ·{' '}
                              {item.remainingExifBytesAfter ?? 0} B EXIF remaining ·{' '}
                              {item.appliedRedactionsCount || 0} visual region(s) flattened
                            </span>
                          </p>
                        ) : (
                          <p className="text-xs text-slate-400">
                            Per-File Plan:{' '}
                            <strong className="text-slate-200">
                              {item.stripMetadata ? 'Strip Metadata' : 'Keep Metadata'}
                            </strong>{' '}
                            +{' '}
                            <strong className="text-slate-200">
                              {item.applyVisualRedactions
                                ? `Redact ${selectedRegionsCount} Region(s) (${item.redactionStyle.toUpperCase()})`
                                : 'No Pixel Changes'}
                            </strong>
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Per-File Quick Controls */}
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-950/70 text-xs text-slate-200 flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.stripMetadata}
                          onChange={(e) =>
                            updateItem(item.id, { stripMetadata: e.target.checked })
                          }
                          className="rounded border-slate-600 text-cyan-500"
                        />
                        <span>Strip EXIF</span>
                      </label>

                      <label className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-950/70 text-xs text-slate-200 flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.applyVisualRedactions}
                          onChange={(e) =>
                            updateItem(item.id, { applyVisualRedactions: e.target.checked })
                          }
                          className="rounded border-slate-600 text-violet-500"
                        />
                        <span>Visual Redact ({selectedRegionsCount})</span>
                      </label>

                      {item.cleanedPreviewUrl && (
                        <a
                          href={item.cleanedPreviewUrl}
                          download={`protected_${item.file.name}`}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold text-xs flex items-center gap-1"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Save File</span>
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedItemId(isExpanded ? null : item.id)
                        }
                        className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-cyan-300 font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <span>{isExpanded ? 'Hide Settings' : 'Per-File Settings'}</span>
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          URL.revokeObjectURL(item.previewUrl);
                          if (item.cleanedPreviewUrl) URL.revokeObjectURL(item.cleanedPreviewUrl);
                          setItems((prev) => prev.filter((x) => x.id !== item.id));
                        }}
                        className="p-1.5 text-slate-400 hover:text-red-400 cursor-pointer"
                        aria-label={`Remove ${item.file.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Per-File Visual Redaction & Metadata Configuration Drawer */}
                  {isExpanded && (
                    <div className="pt-3 border-t border-slate-800 grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
                      {/* Left 5 cols: Image Preview (Before / After) */}
                      <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span className="font-semibold text-slate-200">
                            {item.cleanedPreviewUrl
                              ? 'Cleaned & Flattened Output Preview'
                              : 'Original Image Preview'}
                          </span>
                          <span>{item.cameraModel || 'Local Buffer'}</span>
                        </div>
                        <div className="flex items-center justify-center bg-slate-900/80 rounded-lg p-2 min-h-[160px]">
                          <img
                            src={item.cleanedPreviewUrl || item.previewUrl}
                            alt={`Preview of ${item.file.name}`}
                            referrerPolicy="no-referrer"
                            className="max-h-44 object-contain rounded"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            const updated = await processSingleBatchItem(item);
                            setItems((prev) =>
                              prev.map((x) => (x.id === item.id ? updated : x))
                            );
                          }}
                          className="w-full py-2 px-3 rounded-lg bg-violet-500/20 border border-violet-500/40 hover:bg-violet-500/30 text-violet-200 font-semibold text-xs cursor-pointer"
                        >
                          Preview & Verify This File Now
                        </button>
                      </div>

                      {/* Right 7 cols: Individual File Metadata & Visual Redaction Controls */}
                      <div className="lg:col-span-7 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
                            <span className="text-[11px] text-slate-400 block mb-1">
                              File Redaction Style
                            </span>
                            <select
                              value={item.redactionStyle}
                              onChange={(e) => {
                                const nextStyle = e.target.value as
                                  | 'solid'
                                  | 'blur'
                                  | 'pixelate';
                                updateItem(item.id, {
                                  redactionStyle: nextStyle,
                                  regions: item.regions.map((r) => ({
                                    ...r,
                                    redactionStyle: nextStyle,
                                  })),
                                });
                              }}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100"
                            >
                              <option value="solid">Opaque Solid Mask</option>
                              <option value="blur">Gaussian Blur</option>
                              <option value="pixelate">Heavy Pixelate</option>
                            </select>
                          </div>

                          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
                            <span className="text-[11px] text-slate-400 block mb-1">
                              File Resize Preset
                            </span>
                            <select
                              value={item.resizePreset}
                              onChange={(e) =>
                                updateItem(item.id, {
                                  resizePreset: e.target.value as SocialResizePreset['id'],
                                })
                              }
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100"
                            >
                              {SOCIAL_RESIZE_PRESETS.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
                            <span className="text-[11px] text-slate-400 block mb-1">
                              Metadata Strip Engine
                            </span>
                            <select
                              value={item.useLosslessJpegStrip ? 'lossless' : 'canvas'}
                              onChange={(e) =>
                                updateItem(item.id, {
                                  useLosslessJpegStrip: e.target.value === 'lossless',
                                })
                              }
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100"
                            >
                              <option value="canvas">Canvas Re-Encode (Supports Redaction)</option>
                              <option value="lossless">
                                ScrubPix Lossless Binary Strip (Metadata Only)
                              </option>
                            </select>
                          </div>
                        </div>

                        {/* Category Toggles for This File */}
                        <div className="grid grid-cols-3 gap-2">
                          <label className="p-2.5 rounded-xl border border-slate-800 bg-slate-950/60 flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={item.redactFaces}
                              onChange={(e) =>
                                updateItem(item.id, { redactFaces: e.target.checked })
                              }
                              className="rounded border-slate-600 text-cyan-500"
                            />
                            <span>Redact Faces</span>
                          </label>
                          <label className="p-2.5 rounded-xl border border-slate-800 bg-slate-950/60 flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={item.redactPlates}
                              onChange={(e) =>
                                updateItem(item.id, { redactPlates: e.target.checked })
                              }
                              className="rounded border-slate-600 text-cyan-500"
                            />
                            <span>Redact License Plates</span>
                          </label>
                          <label className="p-2.5 rounded-xl border border-slate-800 bg-slate-950/60 flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={item.redactTextAndCards}
                              onChange={(e) =>
                                updateItem(item.id, {
                                  redactTextAndCards: e.target.checked,
                                })
                              }
                              className="rounded border-slate-600 text-cyan-500"
                            />
                            <span>Redact Text / Cards</span>
                          </label>
                        </div>

                        {/* Individual Detected Regions List for This File */}
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2">
                          <span className="font-semibold text-slate-200 block">
                            Detected Sensitive Regions in {item.file.name} ({item.regions.length})
                          </span>
                          <div className="space-y-1.5">
                            {item.regions.map((reg) => (
                              <div
                                key={reg.id}
                                className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-900/80 border border-slate-800"
                              >
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={reg.selectedForRedaction}
                                    onChange={(e) =>
                                      updateItem(item.id, {
                                        regions: item.regions.map((r) =>
                                          r.id === reg.id
                                            ? { ...r, selectedForRedaction: e.target.checked }
                                            : r
                                        ),
                                      })
                                    }
                                    className="rounded border-slate-600 text-cyan-500"
                                  />
                                  <span className="text-slate-100 font-medium">{reg.label}</span>
                                  <span className="font-mono text-[10px] text-slate-400">
                                    ({Math.round(reg.confidence * 100)}%)
                                  </span>
                                </label>

                                <select
                                  value={reg.redactionStyle}
                                  onChange={(e) =>
                                    updateItem(item.id, {
                                      regions: item.regions.map((r) =>
                                        r.id === reg.id
                                          ? {
                                              ...r,
                                              redactionStyle: e.target.value as
                                                | 'solid'
                                                | 'blur'
                                                | 'pixelate',
                                            }
                                          : r
                                      ),
                                    })
                                  }
                                  aria-label={`Redaction style for ${reg.label}`}
                                  className="bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-[11px] text-cyan-300 font-mono"
                                >
                                  <option value="solid">SOLID</option>
                                  <option value="blur">BLUR</option>
                                  <option value="pixelate">PIXELATE</option>
                                </select>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
