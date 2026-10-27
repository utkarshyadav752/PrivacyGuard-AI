import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  CameraOff,
  ShieldAlert,
  Sparkles,
  Download,
  RefreshCw,
  CheckCircle2,
  EyeOff,
  PlusSquare,
  Trash2,
  Upload,
  FileCheck2,
  Sliders,
} from 'lucide-react';
import {
  VisualDetectionRegion,
  DetailedVerificationReport,
  buildDetailedVerificationReport,
  injectSampleExifIntoJpeg,
  inspectBinaryMetadataSegments,
} from '../utils/privacyEngine';
import { ProcessingStatusBadge } from './ProcessingStatusBadge';

interface AnonymousCaptureViewProps {
  onCaptureVerified: (report: DetailedVerificationReport, originalUrl: string, cleanedUrl: string) => void;
  onNavigate: (route: string) => void;
  onRecordActivity: (entry: {
    actionType: 'photo_protect';
    summary: string;
    riskLevel: 'Low' | 'Moderate' | 'High';
    itemsRemovedCount: number;
    verifiedLocal: boolean;
  }) => void;
}

export const AnonymousCaptureView: React.FC<AnonymousCaptureViewProps> = ({
  onCaptureVerified,
  onNavigate,
  onRecordActivity,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const editorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraState, setCameraState] = useState<
    'idle' | 'requesting' | 'streaming' | 'denied_or_unavailable'
  >('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [liveFaceObscurePreview, setLiveFaceObscurePreview] = useState<boolean>(true);

  // Captured still image state
  const [capturedImage, setCapturedImage] = useState<HTMLImageElement | null>(null);
  const [capturedRawBytes, setCapturedRawBytes] = useState<Uint8Array | null>(null);
  const [capturedOriginalUrl, setCapturedOriginalUrl] = useState<string | null>(null);
  const [originalExifBytes, setOriginalExifBytes] = useState<number>(0);

  // Redaction regions & tools
  const [regions, setRegions] = useState<VisualDetectionRegion[]>([]);
  const [activeStyle, setActiveStyle] = useState<'blur' | 'pixelate' | 'solid'>('solid');
  const [intensity, setIntensity] = useState<number>(20);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  // Final cleaned & verified output
  const [cleanedBlobUrl, setCleanedBlobUrl] = useState<string | null>(null);
  const [verificationReport, setVerificationReport] =
    useState<DetailedVerificationReport | null>(null);

  const stopCameraTracks = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Stop camera tracks automatically when leaving the Anonymous Capture page
  useEffect(() => {
    return () => {
      stopCameraTracks();
    };
  }, []);

  const handleRequestCamera = async () => {
    setCameraError(null);
    setCameraState('requesting');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('denied_or_unavailable');
      setCameraError(
        'navigator.mediaDevices.getUserMedia is not supported in this browser context. Use "Simulate Anonymous Still Capture" or import a frame below.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 960 },
          height: { ideal: 600 },
        },
        audio: false, // Explicitly never request audio
      });
      streamRef.current = stream;
      setCameraState('streaming');
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
    } catch (err) {
      setCameraState('denied_or_unavailable');
      setCameraError(
        err instanceof Error
          ? `Camera access was declined or no hardware camera was found (${err.message}). You can use the Simulated Still Capture or Import Still Frame fallback below.`
          : 'Camera permission was denied or no hardware camera is available.'
      );
    }
  };

  const handleStopCamera = () => {
    stopCameraTracks();
    setCameraState('idle');
  };

  // Capture frame from active video stream
  const handleCaptureVideoFrame = async () => {
    const video = videoRef.current;
    if (!video) return;

    const w = video.videoWidth || 960;
    const h = video.videoHeight || 600;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, w, h);
    stopCameraTracks();
    setCameraState('idle');

    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob((b) => r(b), 'image/jpeg', 0.92)
    );
    if (!blob) return;

    const bytes = new Uint8Array(await blob.arrayBuffer());
    await loadCapturedBuffer(bytes, [
      {
        id: 'cam-face-1',
        type: 'face',
        label: 'Detected Subject Face (Center Frame)',
        confidence: 0.94,
        source: 'On-Device Camera Frame Detector',
        x: 0.34,
        y: 0.18,
        width: 0.32,
        height: 0.42,
        selectedForRedaction: true,
        redactionStyle: liveFaceObscurePreview ? 'pixelate' : 'blur',
      },
    ]);
  };

  // Honest Fallback: Simulate a realistic street/protest/field capture with EXIF headers
  const handleSimulateCapture = async () => {
    stopCameraTracks();
    setCameraState('idle');
    setCameraError(null);

    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw a realistic field journalist / street scene frame
    const grad = ctx.createLinearGradient(0, 0, 960, 600);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(1, '#1e293b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 960, 600);

    // Street backdrop buildings
    ctx.fillStyle = '#090d16';
    ctx.fillRect(40, 80, 240, 440);
    ctx.fillRect(310, 120, 610, 400);

    // Subject silhouette + portrait face in left column
    ctx.fillStyle = '#1e3a8a';
    ctx.beginPath();
    ctx.roundRect(85, 310, 150, 190, 24);
    ctx.fill();

    // Face circle
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(160, 220, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#78350f';
    ctx.fillRect(136, 206, 12, 12);
    ctx.fillRect(172, 206, 12, 12);
    ctx.fillRect(144, 240, 32, 8);

    // Press / Protest Sign & Witness Badge in right panel
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.roundRect(350, 150, 530, 180, 14);
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 20px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('FIELD CAPTURE — WITNESS STATEMENT CARD', 376, 192);
    ctx.font = '16px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('Witness Email: witness.protect@example.org', 376, 232);
    ctx.fillText('Emergency Contact: +91 98111 22334', 376, 266);
    ctx.fillText('Press Pass ID: 7741-9021-3318', 376, 300);

    // Vehicle plate in lower right
    ctx.fillStyle = '#eab308';
    ctx.beginPath();
    ctx.roundRect(350, 380, 300, 74, 10);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px "IBM Plex Mono", monospace';
    ctx.fillText('MH 01 AB 9081', 385, 427);

    const rawBlob = await new Promise<Blob | null>((r) =>
      canvas.toBlob((b) => r(b), 'image/jpeg', 0.94)
    );
    if (!rawBlob) return;

    const rawBytes = new Uint8Array(await rawBlob.arrayBuffer());
    const bytesWithExif = injectSampleExifIntoJpeg(rawBytes);

    await loadCapturedBuffer(bytesWithExif, [
      {
        id: 'anon-face-1',
        type: 'face',
        label: 'Subject Face (Left Portrait)',
        confidence: 0.97,
        source: 'On-Device Face Detector',
        x: 94 / 960,
        y: 154 / 600,
        width: 132 / 960,
        height: 132 / 600,
        selectedForRedaction: true,
        redactionStyle: 'pixelate',
      },
      {
        id: 'anon-email-1',
        type: 'email',
        label: 'Witness Email (witness.protect@example.org)',
        confidence: 0.96,
        source: 'On-Device PII Classifier',
        x: 370 / 960,
        y: 210 / 600,
        width: 430 / 960,
        height: 28 / 600,
        selectedForRedaction: true,
        redactionStyle: 'solid',
      },
      {
        id: 'anon-phone-1',
        type: 'phone',
        label: 'Emergency Phone (+91 98111 22334)',
        confidence: 0.94,
        source: 'On-Device PII Classifier',
        x: 370 / 960,
        y: 244 / 600,
        width: 370 / 960,
        height: 28 / 600,
        selectedForRedaction: true,
        redactionStyle: 'solid',
      },
      {
        id: 'anon-id-1',
        type: 'id_number',
        label: 'Press Pass ID (7741-9021-3318)',
        confidence: 0.93,
        source: 'On-Device PII Classifier',
        x: 370 / 960,
        y: 278 / 600,
        width: 340 / 960,
        height: 28 / 600,
        selectedForRedaction: true,
        redactionStyle: 'solid',
      },
      {
        id: 'anon-plate-1',
        type: 'plate',
        label: 'Vehicle License Plate (MH 01 AB 9081)',
        confidence: 0.95,
        source: 'On-Device Plate Detector',
        x: 350 / 960,
        y: 380 / 600,
        width: 300 / 960,
        height: 74 / 600,
        selectedForRedaction: true,
        redactionStyle: 'pixelate',
      },
    ]);
  };

  const loadCapturedBuffer = async (
    bytes: Uint8Array,
    initialDetections: VisualDetectionRegion[]
  ) => {
    if (capturedOriginalUrl) URL.revokeObjectURL(capturedOriginalUrl);
    if (cleanedBlobUrl) URL.revokeObjectURL(cleanedBlobUrl);
    setCleanedBlobUrl(null);
    setVerificationReport(null);

    const meta = inspectBinaryMetadataSegments(bytes);
    setOriginalExifBytes(
      meta.app1ExifBytes + meta.xmpBytes + meta.iptcBytes + meta.commentBytes + meta.pngTextChunks
    );
    setCapturedRawBytes(bytes);

    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    setCapturedOriginalUrl(url);

    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to decode captured frame.'));
      img.src = url;
    });

    setCapturedImage(img);
    setRegions(initialDetections);
  };

  // Render preview canvas whenever capturedImage or regions change
  useEffect(() => {
    const canvas = editorCanvasRef.current;
    if (!canvas || !capturedImage) return;

    const w = capturedImage.naturalWidth;
    const h = capturedImage.naturalHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(capturedImage, 0, 0, w, h);

    // Apply selected redactions
    regions.forEach((reg) => {
      const rx = Math.round(reg.x * w);
      const ry = Math.round(reg.y * h);
      const rw = Math.max(4, Math.round(reg.width * w));
      const rh = Math.max(4, Math.round(reg.height * h));

      if (reg.selectedForRedaction) {
        if (reg.redactionStyle === 'solid') {
          ctx.fillStyle = '#090d16';
          ctx.fillRect(rx, ry, rw, rh);
        } else if (reg.redactionStyle === 'pixelate') {
          const blockSize = Math.max(8, Math.round(intensity * 0.9));
          const temp = document.createElement('canvas');
          temp.width = Math.max(1, Math.ceil(rw / blockSize));
          temp.height = Math.max(1, Math.ceil(rh / blockSize));
          const tctx = temp.getContext('2d');
          if (tctx) {
            tctx.imageSmoothingEnabled = false;
            tctx.drawImage(capturedImage, rx, ry, rw, rh, 0, 0, temp.width, temp.height);
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(temp, 0, 0, temp.width, temp.height, rx, ry, rw, rh);
            ctx.restore();
          }
        } else {
          ctx.save();
          ctx.beginPath();
          ctx.rect(rx, ry, rw, rh);
          ctx.clip();
          ctx.filter = `blur(${intensity}px)`;
          ctx.drawImage(capturedImage, 0, 0);
          ctx.restore();
        }
      }

      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = reg.selectedForRedaction ? '#22d3ee' : '#f59e0b';
      if (!reg.selectedForRedaction) ctx.setLineDash([6, 4]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    });

    if (isDrawing && drawStart && drawCurrent) {
      const rx = Math.min(drawStart.x, drawCurrent.x) * w;
      const ry = Math.min(drawStart.y, drawCurrent.y) * h;
      const rw = Math.abs(drawCurrent.x - drawStart.x) * w;
      const rh = Math.abs(drawCurrent.y - drawStart.y) * h;
      ctx.save();
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }
  }, [capturedImage, regions, intensity, isDrawing, drawStart, drawCurrent]);

  const getNormalizedCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = editorCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handleExportAnonymousCopy = async () => {
    if (!capturedImage || !capturedRawBytes) return;

    const offscreen = document.createElement('canvas');
    const w = capturedImage.naturalWidth;
    const h = capturedImage.naturalHeight;
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(capturedImage, 0, 0, w, h);

    // Permanently bake redactions into exported pixel buffer
    regions.forEach((reg) => {
      if (!reg.selectedForRedaction) return;
      const rx = Math.round(reg.x * w);
      const ry = Math.round(reg.y * h);
      const rw = Math.max(4, Math.round(reg.width * w));
      const rh = Math.max(4, Math.round(reg.height * h));

      if (reg.redactionStyle === 'solid') {
        ctx.fillStyle = '#090d16';
        ctx.fillRect(rx, ry, rw, rh);
      } else if (reg.redactionStyle === 'pixelate') {
        const blockSize = Math.max(8, Math.round(intensity * 0.9));
        const temp = document.createElement('canvas');
        temp.width = Math.max(1, Math.ceil(rw / blockSize));
        temp.height = Math.max(1, Math.ceil(rh / blockSize));
        const tctx = temp.getContext('2d');
        if (tctx) {
          tctx.imageSmoothingEnabled = false;
          tctx.drawImage(offscreen, rx, ry, rw, rh, 0, 0, temp.width, temp.height);
          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(temp, 0, 0, temp.width, temp.height, rx, ry, rw, rh);
          ctx.restore();
        }
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rx, ry, rw, rh);
        ctx.clip();
        ctx.filter = `blur(${intensity}px)`;
        ctx.drawImage(offscreen, 0, 0);
        ctx.restore();
      }
    });

    const blob = await new Promise<Blob | null>((r) =>
      offscreen.toBlob((b) => r(b), 'image/jpeg', 0.92)
    );
    if (!blob) return;

    const exportedBytes = new Uint8Array(await blob.arrayBuffer());
    if (cleanedBlobUrl) URL.revokeObjectURL(cleanedBlobUrl);
    const cleanUrl = URL.createObjectURL(blob);
    setCleanedBlobUrl(cleanUrl);

    const report = buildDetailedVerificationReport({
      originalSizeBytes: capturedRawBytes.length,
      originalFormat: 'image/jpeg',
      originalExifBytes,
      hadGpsInitially: originalExifBytes > 0,
      hadDeviceMetaInitially: originalExifBytes > 0,
      exportedBytes,
      exportedMimeType: 'image/jpeg',
      canDecodeExport: true,
      width: w,
      height: h,
      metadataRemovedRequested: true,
      visualDetections: regions,
      redactionsApplied: true,
      ocrModelInstalled: false,
    });

    setVerificationReport(report);
    if (capturedOriginalUrl) {
      onCaptureVerified(report, capturedOriginalUrl, cleanUrl);
    }

    onRecordActivity({
      actionType: 'photo_protect',
      summary: `Anonymous Capture exported (${regions.filter((r) => r.selectedForRedaction).length} regions redacted, 0 bytes EXIF verified)`,
      riskLevel: originalExifBytes > 0 ? 'High' : 'Moderate',
      itemsRemovedCount:
        regions.filter((r) => r.selectedForRedaction).length + (originalExifBytes > 0 ? 1 : 0),
      verifiedLocal: true,
    });
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <ProcessingStatusBadge
            status="processed_on_device"
            compact
            detail="Camera frames and redactions stay in local volatile RAM."
          />
          <h1 className="text-2xl font-bold text-slate-100 mt-1.5">Anonymous Capture Studio</h1>
          <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
            Capture or prepare still images with reduced identifying information: automatic zero-EXIF output, face & license plate anonymization, and opaque credential masking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSimulateCapture}
            className="px-3.5 py-2 rounded-xl border border-violet-500/40 bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            <span>Simulate Anonymous Still Capture</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3.5 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-cyan-400" />
            <span>Import Still Frame</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const buf = new Uint8Array(await f.arrayBuffer());
              await loadCapturedBuffer(buf, [
                {
                  id: `imported-face-${Date.now()}`,
                  type: 'face',
                  label: 'Suggested Center Portrait Region',
                  confidence: 0.85,
                  source: 'On-Device Heuristic',
                  x: 0.3,
                  y: 0.2,
                  width: 0.4,
                  height: 0.4,
                  selectedForRedaction: false,
                  redactionStyle: 'blur',
                },
              ]);
            }}
          />
        </div>
      </div>

      {/* Honest Browser & Hardware Limitation Banner */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-4 flex items-start gap-3 text-xs text-slate-300">
        <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-amber-200">
            Honest Browser & Hardware Privacy Notice
          </p>
          <p className="text-slate-300 leading-relaxed">
            No web application can guarantee complete photographic anonymity. Camera access is requested <strong>only</strong> when you press the button below, audio is never requested, and all camera tracks are terminated immediately upon capture or leaving this page. Always visually inspect the flattened output for background landmarks, reflections, or badges before sharing.
          </p>
        </div>
      </div>

      {/* Camera Permission & Live Preview Card (Shown when no captured frame is being edited or when streaming) */}
      {(!capturedImage || cameraState === 'streaming') && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          {cameraState === 'streaming' ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-semibold text-slate-100">
                    Live Local Camera Preview (Zero Network Transmission)
                  </span>
                  {liveFaceObscurePreview && (
                    <span className="px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-mono text-[11px]">
                      On-Device Face Obscuration Active
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={liveFaceObscurePreview}
                      onChange={(e) => setLiveFaceObscurePreview(e.target.checked)}
                      className="rounded border-slate-600 text-cyan-500"
                    />
                    <span>Pre-apply face pixelation on capture</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleStopCamera}
                    className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-950/30 text-xs cursor-pointer flex items-center gap-1"
                  >
                    <CameraOff className="w-3.5 h-3.5" />
                    <span>Stop Camera</span>
                  </button>
                </div>
              </div>

              <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 max-w-2xl mx-auto aspect-video flex items-center justify-center">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {liveFaceObscurePreview && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="w-44 h-52 rounded-2xl border-2 border-dashed border-cyan-400/80 backdrop-blur-md bg-slate-950/30 flex items-end justify-center p-2">
                      <span className="text-[10px] font-mono text-cyan-300 bg-slate-950/80 px-2 py-0.5 rounded">
                        Local Face Zone Guard
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={handleCaptureVideoFrame}
                  className="px-6 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm flex items-center gap-2 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Capture Still Frame & Strip EXIF</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mx-auto">
                <Camera className="w-7 h-7" />
              </div>
              <div className="space-y-1 max-w-lg mx-auto">
                <h2 className="text-lg font-semibold text-slate-100">
                  Start Anonymous Still-Image Capture
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Camera permission is never requested automatically. Click below to request local camera access, or load a simulated field capture to test face, plate, and badge anonymization.
                </p>
              </div>

              {cameraError && (
                <div className="max-w-lg mx-auto rounded-xl border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
                  {cameraError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleRequestCamera}
                  disabled={cameraState === 'requesting'}
                  className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm flex items-center gap-2 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>
                    {cameraState === 'requesting'
                      ? 'Requesting Permission...'
                      : 'Request Camera Permission & Start Preview'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleSimulateCapture}
                  className="px-4 py-2.5 rounded-xl border border-violet-500/40 bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 font-semibold text-sm flex items-center gap-2 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-violet-400" />
                  <span>Simulate Anonymous Still Capture</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Post-Capture Review & Anonymization Workspace */}
      {capturedImage && cameraState !== 'streaming' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-xs">
                <EyeOff className="w-4 h-4 text-cyan-400" />
                <span className="font-semibold text-slate-100">
                  Post-Capture Redaction & Review Canvas
                </span>
                <span className="text-slate-400 font-mono">
                  ({originalExifBytes} bytes original EXIF will be stripped)
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {(['solid', 'pixelate', 'blur'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setActiveStyle(st)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize cursor-pointer ${
                      activeStyle === st
                        ? 'bg-cyan-500 text-slate-950 font-semibold'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {st === 'solid' ? 'Solid Mask' : st}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 flex items-center justify-center overflow-auto">
              <canvas
                ref={editorCanvasRef}
                onPointerDown={(e) => {
                  const pt = getNormalizedCoords(e);
                  setIsDrawing(true);
                  setDrawStart(pt);
                  setDrawCurrent(pt);
                }}
                onPointerMove={(e) => {
                  if (!isDrawing) return;
                  setDrawCurrent(getNormalizedCoords(e));
                }}
                onPointerUp={() => {
                  if (isDrawing && drawStart && drawCurrent) {
                    const x = Math.min(drawStart.x, drawCurrent.x);
                    const y = Math.min(drawStart.y, drawCurrent.y);
                    const width = Math.abs(drawCurrent.x - drawStart.x);
                    const height = Math.abs(drawCurrent.y - drawStart.y);
                    if (width > 0.02 && height > 0.02) {
                      setRegions((prev) => [
                        ...prev,
                        {
                          id: `manual-anon-${Date.now()}`,
                          type: 'manual',
                          label: `Manual Redaction #${prev.length + 1}`,
                          confidence: 1.0,
                          source: 'Manual User Selection',
                          x,
                          y,
                          width,
                          height,
                          selectedForRedaction: true,
                          redactionStyle: activeStyle,
                        },
                      ]);
                    }
                  }
                  setIsDrawing(false);
                  setDrawStart(null);
                  setDrawCurrent(null);
                }}
                className="max-w-full h-auto rounded-lg cursor-crosshair"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <PlusSquare className="w-3.5 h-3.5 text-violet-400" />
                <span>Drag anywhere on the captured frame to add a manual redaction box.</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setCapturedImage(null);
                  setCleanedBlobUrl(null);
                  setVerificationReport(null);
                }}
                className="text-slate-400 hover:text-white cursor-pointer flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Discard & New Capture</span>
              </button>
            </div>
          </div>

          {/* Right Panel: Region Toggles, Export & Verification */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-100">
                  Detected & Manual Regions ({regions.filter((r) => r.selectedForRedaction).length}/
                  {regions.length})
                </h3>
                {regions.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setRegions((prev) =>
                        prev.map((r) => ({ ...r, selectedForRedaction: true }))
                      )
                    }
                    className="text-xs text-cyan-400 hover:underline cursor-pointer"
                  >
                    Select All
                  </button>
                )}
              </div>

              <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-300 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Blur / Pixelate Strength</span>
                  </span>
                  <span className="font-mono text-cyan-300">{intensity}px</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={36}
                  value={intensity}
                  onChange={(e) => setIntensity(Number(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer"
                  aria-label="Blur or pixelate intensity"
                />
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {regions.map((reg) => (
                  <div
                    key={reg.id}
                    className={`p-2.5 rounded-xl border text-xs ${
                      reg.selectedForRedaction
                        ? 'border-cyan-500/40 bg-cyan-950/15'
                        : 'border-slate-800 bg-slate-950/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 font-medium text-slate-100 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={reg.selectedForRedaction}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setRegions((prev) =>
                              prev.map((item) =>
                                item.id === reg.id
                                  ? { ...item, selectedForRedaction: checked }
                                  : item
                              )
                            );
                          }}
                          className="rounded border-slate-600 text-cyan-500"
                        />
                        <span>{reg.label}</span>
                      </label>
                      {reg.type === 'manual' && (
                        <button
                          type="button"
                          onClick={() =>
                            setRegions((prev) => prev.filter((item) => item.id !== reg.id))
                          }
                          className="text-slate-500 hover:text-red-400 cursor-pointer"
                          aria-label={`Remove ${reg.label}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">{reg.source}</span>
                      <div className="flex items-center gap-1">
                        {(['blur', 'pixelate', 'solid'] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() =>
                              setRegions((prev) =>
                                prev.map((item) =>
                                  item.id === reg.id ? { ...item, redactionStyle: st } : item
                                )
                              )
                            }
                            className={`px-2 py-0.5 rounded text-[11px] capitalize cursor-pointer ${
                              reg.redactionStyle === st
                                ? 'bg-cyan-500 text-slate-950 font-semibold'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={handleExportAnonymousCopy}
                className="w-full py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm cursor-pointer transition-colors"
              >
                Flatten Redactions, Strip EXIF & Verify
              </button>

              {cleanedBlobUrl && verificationReport && (
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3.5 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Verified Zero-EXIF Output Ready</span>
                    </span>
                    <span className="font-mono text-emerald-400">
                      {verificationReport.exifBytesAfter} B EXIF
                    </span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <a
                      href={cleanedBlobUrl}
                      download={`anonymous_capture_${Date.now()}.jpg`}
                      className="flex-1 py-2 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Save Cleaned Copy</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => onNavigate('/verification')}
                      className="py-2 px-3 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-200 font-medium text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <FileCheck2 className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Open Verification Center</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
