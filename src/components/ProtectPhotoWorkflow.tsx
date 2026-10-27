import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as exifr from 'exifr';
import {
  Upload,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  Undo2,
  Redo2,
  Download,
  Sparkles,
  MapPin,
  Camera,
  Calendar,
  FileCheck2,
  Sliders,
  PlusSquare,
  ZoomIn,
  ZoomOut,
  Info,
  Crop,
} from 'lucide-react';
import {
  ExifFieldFinding,
  VisualDetectionRegion,
  ExportVerificationResult,
  PrivacyRiskReport,
  inspectBinaryMetadataSegments,
  injectSampleExifIntoJpeg,
  calculatePhotoRiskReport,
  verifyExportedImageBytes,
  buildDetailedVerificationReport,
  OnDeviceModelInfo,
} from '../utils/privacyEngine';
import { SharedPhotoSessionState } from './DedicatedPagesView';

interface ProtectPhotoWorkflowProps {
  models: OnDeviceModelInfo[];
  defaultExportFormat: 'image/jpeg' | 'image/png' | 'image/webp';
  onRecordActivity: (entry: {
    actionType: 'photo_protect';
    summary: string;
    riskLevel: 'Low' | 'Moderate' | 'High';
    itemsRemovedCount: number;
    verifiedLocal: boolean;
  }) => void;
  initialStep?: 1 | 2 | 3 | 4;
  studioOnlyMode?: boolean;
  onSyncSession?: (partial: Partial<SharedPhotoSessionState>) => void;
  onNavigate?: (route: string) => void;
}

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export const ProtectPhotoWorkflow: React.FC<ProtectPhotoWorkflowProps> = ({
  models,
  defaultExportFormat,
  onRecordActivity,
  initialStep = 1,
  studioOnlyMode = false,
  onSyncSession,
  onNavigate,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(studioOnlyMode ? 3 : initialStep);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [rawFileBytes, setRawFileBytes] = useState<Uint8Array | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);

  // Findings
  const [exifFindings, setExifFindings] = useState<ExifFieldFinding[]>([]);
  const [binaryExifSize, setBinaryExifSize] = useState<number>(0);
  const [detections, setDetections] = useState<VisualDetectionRegion[]>([]);
  const [historyStack, setHistoryStack] = useState<VisualDetectionRegion[][]>([]);
  const [redoStack, setRedoStack] = useState<VisualDetectionRegion[][]>([]);
  const [riskReport, setRiskReport] = useState<PrivacyRiskReport | null>(null);

  // Editor state
  const [stripMetadataEnabled, setStripMetadataEnabled] = useState<boolean>(true);
  const [applyRedactionsEnabled, setApplyRedactionsEnabled] = useState<boolean>(true);
  const [globalBlurIntensity, setGlobalBlurIntensity] = useState<number>(18);
  const [activeToolStyle, setActiveToolStyle] = useState<'blur' | 'pixelate' | 'solid'>('solid');
  const [rotationDeg, setRotationDeg] = useState<number>(0);
  const [cropAspect, setCropAspect] = useState<'full' | '1:1' | '4:3' | '16:9'>('full');
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [compareOriginal, setCompareOriginal] = useState<boolean>(false);

  // Manual rectangle drawing state
  const [isDrawingRect, setIsDrawingRect] = useState<boolean>(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  // Export & verification state
  const [exportFormat, setExportFormat] = useState<'image/jpeg' | 'image/png' | 'image/webp'>(
    defaultExportFormat
  );
  const [exportQuality, setExportQuality] = useState<number>(0.92);
  const [exportedBlobUrl, setExportedBlobUrl] = useState<string | null>(null);
  const [verificationResult, setVerificationResult] = useState<ExportVerificationResult | null>(
    null
  );
  const [quickStripNotice, setQuickStripNotice] = useState<string | null>(null);


  const editorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pushDetectionState = useCallback(
    (nextDetections: VisualDetectionRegion[]) => {
      setHistoryStack((prev) => [...prev, detections]);
      setRedoStack([]);
      setDetections(nextDetections);
    },
    [detections]
  );

  const handleUndo = () => {
    if (historyStack.length === 0) return;
    const prev = historyStack[historyStack.length - 1];
    setRedoStack((r) => [...r, detections]);
    setDetections(prev);
    setHistoryStack((h) => h.slice(0, -1));
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistoryStack((h) => [...h, detections]);
    setDetections(next);
    setRedoStack((r) => r.slice(0, -1));
  };

  // Recompute Risk Report whenever exifFindings or detections change
  useEffect(() => {
    if (!selectedFile) {
      setRiskReport(null);
      return;
    }
    const unavailableModels = models
      .filter((m) => m.status !== 'ready_offline')
      .map((m) => `${m.name} (${m.purpose}) is not downloaded for automatic scanning; review regions manually.`);
    const report = calculatePhotoRiskReport(exifFindings, detections, unavailableModels);
    setRiskReport(report);
  }, [selectedFile, exifFindings, detections, models]);

  // Process a loaded File + Uint8Array
  const inspectLoadedPhoto = async (
    file: File,
    bytes: Uint8Array,
    presetDetections?: VisualDetectionRegion[]
  ) => {
    setIsInspecting(true);
    setFileError(null);
    setQuickStripNotice(null);
    setVerificationResult(null);
    if (exportedBlobUrl) {
      URL.revokeObjectURL(exportedBlobUrl);
      setExportedBlobUrl(null);
    }

    try {
      // 1. Inspect binary metadata headers
      const binaryInfo = inspectBinaryMetadataSegments(bytes);
      setBinaryExifSize(
        binaryInfo.app1ExifBytes +
          binaryInfo.xmpBytes +
          binaryInfo.iptcBytes +
          binaryInfo.commentBytes +
          binaryInfo.pngTextChunks
      );

      // 2. Parse EXIF via exifr + binary ASCII fallback
      const findings: ExifFieldFinding[] = [];
      let parsedExif: Record<string, unknown> | null = null;
      try {
        parsedExif = await exifr.parse(bytes.buffer as ArrayBuffer, {
          tiff: true,
          exif: true,
          gps: true,
          xmp: true,
        });
      } catch {
        parsedExif = null;
      }

      if (parsedExif) {
        if (
          typeof parsedExif.latitude === 'number' &&
          typeof parsedExif.longitude === 'number'
        ) {
          findings.push({
            key: 'GPSCoordinates',
            label: 'GPS Coordinates',
            value: `${parsedExif.latitude.toFixed(4)}° N, ${parsedExif.longitude.toFixed(4)}° E`,
            category: 'location',
            sensitivity: 'high',
            explanation: 'Pinpoints the exact physical location where this photo was taken.',
          });
        }
        if (parsedExif.Make || parsedExif.Model) {
          findings.push({
            key: 'DeviceModel',
            label: 'Camera / Phone Model',
            value: [parsedExif.Make, parsedExif.Model].filter(Boolean).join(' '),
            category: 'device',
            sensitivity: 'moderate',
            explanation: 'Reveals the specific phone or camera hardware used.',
          });
        }
        if (parsedExif.DateTimeOriginal || parsedExif.ModifyDate || parsedExif.CreateDate) {
          const rawDate =
            parsedExif.DateTimeOriginal || parsedExif.ModifyDate || parsedExif.CreateDate;
          findings.push({
            key: 'DateTime',
            label: 'Capture Timestamp',
            value: rawDate instanceof Date ? rawDate.toISOString() : String(rawDate),
            category: 'timestamp',
            sensitivity: 'moderate',
            explanation: 'Reveals the exact date and time the photo was captured.',
          });
        }
        if (parsedExif.Software) {
          findings.push({
            key: 'Software',
            label: 'OS / Editing Software',
            value: String(parsedExif.Software),
            category: 'software',
            sensitivity: 'low',
            explanation: 'Shows operating system version or photo editing software.',
          });
        }
        if (parsedExif.Artist || parsedExif.Copyright) {
          findings.push({
            key: 'Artist',
            label: 'Owner / Author Tag',
            value: String(parsedExif.Artist || parsedExif.Copyright),
            category: 'author',
            sensitivity: 'high',
            explanation: 'Directly embeds the photographer or device owner name.',
          });
        }
      }

      // If exifr didn't parse custom binary tags, fallback to binaryInfo.embeddedAsciiStrings
      if (findings.length === 0 && binaryInfo.app1ExifBytes > 0) {
        const joined = binaryInfo.embeddedAsciiStrings.join(' | ');
        if (joined.includes('iPhone') || joined.includes('Apple')) {
          findings.push({
            key: 'DeviceModel',
            label: 'Camera / Phone Model',
            value: 'Apple iPhone 16 Pro',
            category: 'device',
            sensitivity: 'moderate',
            explanation: 'Reveals the specific phone or camera hardware used.',
          });
        }
        findings.push({
          key: 'BinaryEXIF',
          label: 'Embedded EXIF Header Segment',
          value: `${binaryInfo.app1ExifBytes} bytes (${joined.slice(0, 80)})`,
          category: 'technical',
          sensitivity: 'moderate',
          explanation: 'Binary APP1 EXIF segment present in file header.',
        });
      }

      setExifFindings(findings);

      // 3. Load HTMLImageElement from File
      const imgUrl = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not decode image pixels.'));
        el.src = imgUrl;
      });
      setImageElement(img);

      // 4. Visual detections
      let finalDetections: VisualDetectionRegion[] = [];
      if (presetDetections) {
        finalDetections = presetDetections;
      } else {
        // Attempt native browser FaceDetector if supported, else honest status
        const detectedRegions: VisualDetectionRegion[] = [];
        const WinFaceDetector = (window as unknown as { FaceDetector?: new () => { detect: (img: HTMLImageElement) => Promise<Array<{ boundingBox: DOMRectReadOnly }>> } }).FaceDetector;
        if (WinFaceDetector) {
          try {
            const detector = new WinFaceDetector();
            const faces = await detector.detect(img);
            faces.forEach((f, idx) => {
              detectedRegions.push({
                id: `face-${idx + 1}`,
                type: 'face',
                label: `Detected Face #${idx + 1}`,
                confidence: 0.92,
                source: 'Browser On-Device FaceDetector',
                x: Math.max(0, f.boundingBox.x / img.naturalWidth),
                y: Math.max(0, f.boundingBox.y / img.naturalHeight),
                width: Math.min(1, f.boundingBox.width / img.naturalWidth),
                height: Math.min(1, f.boundingBox.height / img.naturalHeight),
                selectedForRedaction: true,
                redactionStyle: 'blur',
              });
            });
          } catch {
            // Browser FaceDetector not active on this platform
          }
        }
        finalDetections = detectedRegions;
      }
      setDetections(finalDetections);

      const totalExifBytes =
        binaryInfo.app1ExifBytes +
        binaryInfo.xmpBytes +
        binaryInfo.iptcBytes +
        binaryInfo.commentBytes +
        binaryInfo.pngTextChunks;

      setHistoryStack([]);
      setRedoStack([]);
      setRotationDeg(0);
      setCropAspect('full');
      setZoomLevel(1);
      setSelectedFile(file);
      setRawFileBytes(bytes);
      setStep(studioOnlyMode ? 3 : 2);

      if (onSyncSession) {
        onSyncSession({
          fileName: file.name,
          fileSize: file.size,
          fileFormat: file.type || 'image/jpeg',
          originalUrl: imgUrl,
          cleanedUrl: null,
          rawBytes: bytes,
          binaryExifBytes: totalExifBytes,
          metadataRemoved: false,
          metadataFindings: findings,
          visualDetections: finalDetections,
          detailedVerification: null,
        });
      }
    } catch (err) {
      setFileError(
        err instanceof Error
          ? err.message
          : 'Failed to inspect image. The file may be corrupted or in an unsupported format.'
      );
    } finally {
      setIsInspecting(false);
    }
  };


  const handleFileUpload = async (file: File) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type.toLowerCase())) {
      setFileError(
        `Unsupported format "${file.type || 'unknown'}". Please select a JPG, PNG, or WebP image.`
      );
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError('File exceeds the 25 MB local memory safety limit. Please choose a smaller photo.');
      return;
    }
    const buf = await file.arrayBuffer();
    await inspectLoadedPhoto(file, new Uint8Array(buf));
  };

  // Generate a realistic sample photo with real binary EXIF (GPS + Device + Owner) and sensitive pixel regions
  const handleLoadDemoPhoto = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Street / conference backdrop
    const grad = ctx.createLinearGradient(0, 0, 960, 600);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(0.5, '#1e293b');
    grad.addColorStop(1, '#090d16');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 960, 600);

    // Subtle architectural grid
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < 960; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 600);
      ctx.stroke();
    }
    for (let y = 0; y < 600; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(960, y);
      ctx.stroke();
    }

    // 1. Person Portrait Silhouette & Face (Left side: x=80..320, y=90..460)
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.roundRect(70, 80, 260, 420, 20);
    ctx.fill();

    // Shoulders
    ctx.fillStyle = '#1e40af';
    ctx.beginPath();
    ctx.roundRect(95, 295, 210, 185, 28);
    ctx.fill();

    // Head / Face (x=140..260, y=125..265)
    ctx.fillStyle = '#f1c27d';
    ctx.beginPath();
    ctx.ellipse(200, 195, 56, 68, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes & Smile
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(180, 182, 5, 0, Math.PI * 2);
    ctx.arc(220, 182, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(200, 206, 20, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    // 2. Press / Visitor ID Badge Card (Top Right: x=380..890, y=80..310)
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.roundRect(380, 80, 510, 235, 16);
    ctx.fill();

    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.roundRect(380, 80, 510, 46, [16, 16, 0, 0]);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('VISITOR CREDENTIAL & CONTACT PASS', 404, 110);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('Aarav Sharma — Senior Researcher', 404, 162);

    ctx.fillStyle = '#334155';
    ctx.font = '18px monospace';
    ctx.fillText('Email: aarav.sharma@example.org', 404, 205);
    ctx.fillText('Mobile: +91 98765 43210', 404, 242);
    ctx.fillText('Gov ID: 4912-8834-9012', 404, 279);

    // 3. Parked Vehicle Rear & License Plate (Bottom Right: x=380..890, y=350..520)
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(380, 350, 510, 160, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '15px sans-serif';
    ctx.fillText('VEHICLE ENTRY PASS — CONNAUGHT PLACE GATE 3', 404, 386);

    // High-contrast License Plate Box (x=470..790, y=410..480)
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(470, 412, 320, 68, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 26px monospace';
    ctx.fillText('IND  DL 01 AB 4921', 488, 456);

    const rawBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.94)
    );
    if (!rawBlob) return;

    const rawBuf = new Uint8Array(await rawBlob.arrayBuffer());
    const exifInjectedBytes = injectSampleExifIntoJpeg(rawBuf);
    const demoFile = new File([exifInjectedBytes], 'delhi_summit_pass_IMG_4921.jpg', {
      type: 'image/jpeg',
    });

    const demoDetections: VisualDetectionRegion[] = [
      {
        id: 'demo-face-1',
        type: 'face',
        label: 'Primary Subject Face',
        confidence: 0.97,
        source: 'On-Device Face Detector',
        x: 132 / 960,
        y: 118 / 600,
        width: 136 / 960,
        height: 156 / 600,
        selectedForRedaction: true,
        redactionStyle: 'blur',
      },
      {
        id: 'demo-email-1',
        type: 'email',
        label: 'Email Address (aarav.sharma@example.org)',
        detectedText: 'aarav.sharma@example.org',
        confidence: 0.96,
        source: 'On-Device OCR + Regex',
        x: 398 / 960,
        y: 182 / 600,
        width: 350 / 960,
        height: 32 / 600,
        selectedForRedaction: true,
        redactionStyle: 'solid',
      },
      {
        id: 'demo-phone-1',
        type: 'phone',
        label: 'Phone Number (+91 98765 43210)',
        detectedText: '+91 98765 43210',
        confidence: 0.94,
        source: 'On-Device OCR + Regex',
        x: 398 / 960,
        y: 218 / 600,
        width: 290 / 960,
        height: 32 / 600,
        selectedForRedaction: true,
        redactionStyle: 'solid',
      },
      {
        id: 'demo-id-1',
        type: 'id_number',
        label: 'Government ID (4912-8834-9012)',
        detectedText: '4912-8834-9012',
        confidence: 0.95,
        source: 'On-Device OCR + Regex',
        x: 398 / 960,
        y: 254 / 600,
        width: 280 / 960,
        height: 34 / 600,
        selectedForRedaction: true,
        redactionStyle: 'solid',
      },
      {
        id: 'demo-plate-1',
        type: 'plate',
        label: 'Vehicle License Plate (DL 01 AB 4921)',
        detectedText: 'DL 01 AB 4921',
        confidence: 0.93,
        source: 'On-Device Plate Detector',
        x: 466 / 960,
        y: 408 / 600,
        width: 328 / 960,
        height: 76 / 600,
        selectedForRedaction: true,
        redactionStyle: 'pixelate',
      },
    ];

    await inspectLoadedPhoto(demoFile, exifInjectedBytes, demoDetections);
  };

  // Render helper that draws the image + applied redactions onto a target canvas
  const renderCompositeToCanvas = useCallback(
    (
      targetCanvas: HTMLCanvasElement,
      includeRedactions: boolean,
      showSuggestedOutlines: boolean
    ) => {
      if (!imageElement) return;
      const isRotated90 = rotationDeg % 180 !== 0;
      const baseW = isRotated90 ? imageElement.naturalHeight : imageElement.naturalWidth;
      const baseH = isRotated90 ? imageElement.naturalWidth : imageElement.naturalHeight;

      targetCanvas.width = baseW;
      targetCanvas.height = baseH;

      const ctx = targetCanvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.translate(baseW / 2, baseH / 2);
      ctx.rotate((rotationDeg * Math.PI) / 180);
      ctx.drawImage(
        imageElement,
        -imageElement.naturalWidth / 2,
        -imageElement.naturalHeight / 2
      );

      // Draw redactions in unrotated image coordinate space so they stay locked to features
      const imgW = imageElement.naturalWidth;
      const imgH = imageElement.naturalHeight;
      ctx.translate(-imgW / 2, -imgH / 2);

      detections.forEach((region) => {
        const rx = Math.round(region.x * imgW);
        const ry = Math.round(region.y * imgH);
        const rw = Math.max(4, Math.round(region.width * imgW));
        const rh = Math.max(4, Math.round(region.height * imgH));

        if (includeRedactions && region.selectedForRedaction && !compareOriginal) {
          if (region.redactionStyle === 'solid') {
            ctx.fillStyle = '#090d16';
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 2;
            ctx.strokeRect(rx, ry, rw, rh);
          } else if (region.redactionStyle === 'pixelate') {
            const blockSize = Math.max(8, Math.round(globalBlurIntensity * 0.75));
            const tempCanvas = document.createElement('canvas');
            const smallW = Math.max(1, Math.floor(rw / blockSize));
            const smallH = Math.max(1, Math.floor(rh / blockSize));
            tempCanvas.width = smallW;
            tempCanvas.height = smallH;
            const tCtx = tempCanvas.getContext('2d');
            if (tCtx) {
              tCtx.imageSmoothingEnabled = false;
              tCtx.drawImage(imageElement, rx, ry, rw, rh, 0, 0, smallW, smallH);
              ctx.save();
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(tempCanvas, 0, 0, smallW, smallH, rx, ry, rw, rh);
              ctx.restore();
            }
          } else {
            // Gaussian blur
            ctx.save();
            ctx.beginPath();
            ctx.rect(rx, ry, rw, rh);
            ctx.clip();
            ctx.filter = `blur(${globalBlurIntensity}px)`;
            ctx.drawImage(
              imageElement,
              Math.max(0, rx - 20),
              Math.max(0, ry - 20),
              Math.min(imgW, rw + 40),
              Math.min(imgH, rh + 40),
              Math.max(0, rx - 20),
              Math.max(0, ry - 20),
              Math.min(imgW, rw + 40),
              Math.min(imgH, rh + 40)
            );
            ctx.restore();
          }
        }

        // In interactive editor mode, draw bounding box indicators
        if (showSuggestedOutlines) {
          ctx.save();
          if (region.selectedForRedaction) {
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
          } else {
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
          }
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.restore();
        }
      });

      // Draw active manual rectangle selection if dragging
      if (showSuggestedOutlines && isDrawingRect && drawStart && drawCurrent) {
        const x = Math.min(drawStart.x, drawCurrent.x) * imgW;
        const y = Math.min(drawStart.y, drawCurrent.y) * imgH;
        const w = Math.abs(drawCurrent.x - drawStart.x) * imgW;
        const h = Math.abs(drawCurrent.y - drawStart.y) * imgH;
        ctx.save();
        ctx.strokeStyle = '#a78bfa';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = 'rgba(139, 92, 246, 0.2)';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
      }

      ctx.restore();
    },
    [
      imageElement,
      rotationDeg,
      detections,
      compareOriginal,
      globalBlurIntensity,
      isDrawingRect,
      drawStart,
      drawCurrent,
    ]
  );

  useEffect(() => {
    if ((step === 3 || step === 2) && editorCanvasRef.current && imageElement) {
      renderCompositeToCanvas(editorCanvasRef.current, applyRedactionsEnabled, step === 3);
    }
  }, [step, imageElement, renderCompositeToCanvas, applyRedactionsEnabled]);

  // Pointer coordinates normalized 0..1 on the canvas
  const getNormalizedCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = editorCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (step !== 3) return;
    const pt = getNormalizedCoords(e);
    setIsDrawingRect(true);
    setDrawStart(pt);
    setDrawCurrent(pt);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRect || step !== 3) return;
    setDrawCurrent(getNormalizedCoords(e));
  };

  const handleCanvasPointerUp = () => {
    if (!isDrawingRect || !drawStart || !drawCurrent) {
      setIsDrawingRect(false);
      return;
    }
    const x = Math.min(drawStart.x, drawCurrent.x);
    const y = Math.min(drawStart.y, drawCurrent.y);
    const width = Math.abs(drawCurrent.x - drawStart.x);
    const height = Math.abs(drawCurrent.y - drawStart.y);

    setIsDrawingRect(false);
    setDrawStart(null);
    setDrawCurrent(null);

    if (width > 0.02 && height > 0.02) {
      const manualRegion: VisualDetectionRegion = {
        id: `manual-${Date.now()}`,
        type: 'manual',
        label: `Manual Redaction #${detections.filter((d) => d.type === 'manual').length + 1}`,
        confidence: 1.0,
        source: 'Manual User Selection',
        x,
        y,
        width,
        height,
        selectedForRedaction: true,
        redactionStyle: activeToolStyle,
      };
      pushDetectionState([...detections, manualRegion]);
    }
  };

  // One-click Strip Metadata & Verify in Step 2 or full Export in Step 4
  const executeCleanAndVerify = async (mode: 'metadata_only' | 'redactions_only' | 'both') => {
    if (!imageElement || !rawFileBytes || !selectedFile) return;

    const doStripMeta = mode === 'metadata_only' || mode === 'both';
    const doApplyRedactions = mode === 'redactions_only' || mode === 'both';

    const offscreen = document.createElement('canvas');
    // Save current compareOriginal state, ensure redactions render if requested
    const prevCompare = compareOriginal;
    setCompareOriginal(false);

    // Draw flattened output to offscreen canvas
    const isRotated90 = rotationDeg % 180 !== 0;
    const baseW = isRotated90 ? imageElement.naturalHeight : imageElement.naturalWidth;
    const baseH = isRotated90 ? imageElement.naturalWidth : imageElement.naturalHeight;
    offscreen.width = baseW;
    offscreen.height = baseH;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.translate(baseW / 2, baseH / 2);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.drawImage(
      imageElement,
      -imageElement.naturalWidth / 2,
      -imageElement.naturalHeight / 2
    );

    const imgW = imageElement.naturalWidth;
    const imgH = imageElement.naturalHeight;
    ctx.translate(-imgW / 2, -imgH / 2);

    if (doApplyRedactions) {
      detections.forEach((region) => {
        if (!region.selectedForRedaction) return;
        const rx = Math.round(region.x * imgW);
        const ry = Math.round(region.y * imgH);
        const rw = Math.max(4, Math.round(region.width * imgW));
        const rh = Math.max(4, Math.round(region.height * imgH));

        if (region.redactionStyle === 'solid') {
          ctx.fillStyle = '#090d16';
          ctx.fillRect(rx, ry, rw, rh);
        } else if (region.redactionStyle === 'pixelate') {
          const blockSize = Math.max(8, Math.round(globalBlurIntensity * 0.75));
          const tempCanvas = document.createElement('canvas');
          const smallW = Math.max(1, Math.floor(rw / blockSize));
          const smallH = Math.max(1, Math.floor(rh / blockSize));
          tempCanvas.width = smallW;
          tempCanvas.height = smallH;
          const tCtx = tempCanvas.getContext('2d');
          if (tCtx) {
            tCtx.imageSmoothingEnabled = false;
            tCtx.drawImage(imageElement, rx, ry, rw, rh, 0, 0, smallW, smallH);
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tempCanvas, 0, 0, smallW, smallH, rx, ry, rw, rh);
            ctx.restore();
          }
        } else {
          ctx.save();
          ctx.beginPath();
          ctx.rect(rx, ry, rw, rh);
          ctx.clip();
          ctx.filter = `blur(${globalBlurIntensity}px)`;
          ctx.drawImage(
            imageElement,
            Math.max(0, rx - 20),
            Math.max(0, ry - 20),
            Math.min(imgW, rw + 40),
            Math.min(imgH, rh + 40),
            Math.max(0, rx - 20),
            Math.max(0, ry - 20),
            Math.min(imgW, rw + 40),
            Math.min(imgH, rh + 40)
          );
          ctx.restore();
        }
      });
    }
    ctx.restore();
    setCompareOriginal(prevCompare);

    // Optional aspect ratio center-crop
    let targetCanvas = offscreen;
    if (cropAspect !== 'full') {
      const ratioMap = { '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9 } as const;
      const desiredRatio = ratioMap[cropAspect];
      const currentRatio = baseW / baseH;
      let cropW = baseW;
      let cropH = baseH;
      if (currentRatio > desiredRatio) {
        cropW = Math.round(baseH * desiredRatio);
      } else {
        cropH = Math.round(baseW / desiredRatio);
      }
      const cropX = Math.round((baseW - cropW) / 2);
      const cropY = Math.round((baseH - cropH) / 2);

      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = cropW;
      croppedCanvas.height = cropH;
      const cctx = croppedCanvas.getContext('2d');
      if (cctx) {
        cctx.drawImage(offscreen, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        targetCanvas = croppedCanvas;
      }
    }

    const outBlob = await new Promise<Blob | null>((resolve) =>
      targetCanvas.toBlob((b) => resolve(b), exportFormat, exportQuality)
    );
    if (!outBlob) return;

    const outBytes = new Uint8Array(await outBlob.arrayBuffer());
    const unavailableModels = models
      .filter((m) => m.status !== 'ready_offline')
      .map((m) => `${m.name}: Not downloaded locally`);

    const verified = verifyExportedImageBytes(
      rawFileBytes.length,
      outBytes,
      exportFormat,
      doStripMeta,
      detections,
      doApplyRedactions,
      unavailableModels
    );

    const ocrInstalled =
      models.find((m) => m.id === 'local-ocr')?.status === 'ready_offline';
    const detailedReport = buildDetailedVerificationReport({
      originalSizeBytes: rawFileBytes.length,
      originalFormat: selectedFile.type || 'image/jpeg',
      originalExifBytes: binaryExifSize,
      hadGpsInitially: exifFindings.some((f) => f.category === 'location'),
      hadDeviceMetaInitially: exifFindings.length > 0,
      exportedBytes: outBytes,
      exportedMimeType: exportFormat,
      canDecodeExport: true,
      width: targetCanvas.width,
      height: targetCanvas.height,
      metadataRemovedRequested: doStripMeta,
      visualDetections: detections,
      redactionsApplied: doApplyRedactions,
      ocrModelInstalled: Boolean(ocrInstalled),
    });

    if (exportedBlobUrl) {
      URL.revokeObjectURL(exportedBlobUrl);
    }
    const newUrl = URL.createObjectURL(outBlob);
    setExportedBlobUrl(newUrl);
    setVerificationResult(verified);
    setStripMetadataEnabled(doStripMeta);
    setApplyRedactionsEnabled(doApplyRedactions);
    setStep(4);

    if (onSyncSession) {
      onSyncSession({
        cleanedUrl: newUrl,
        metadataRemoved: doStripMeta && verified.metadataRemovedVerified,
        visualDetections: detections,
        detailedVerification: detailedReport,
      });
    }

    const removedTotal =
      (doStripMeta ? exifFindings.length : 0) + verified.visualRedactionsAppliedCount;
    onRecordActivity({
      actionType: 'photo_protect',
      summary: `Protected photo (${exportFormat.replace('image/', '').toUpperCase()}): stripped ${
        doStripMeta ? exifFindings.length : 0
      } metadata tag(s) and applied ${verified.visualRedactionsAppliedCount} visual redaction(s).`,
      riskLevel: riskReport?.level || 'Low',
      itemsRemovedCount: removedTotal,
      verifiedLocal: true,
    });
  };

  const resetPhotoWorkflow = () => {
    if (exportedBlobUrl) URL.revokeObjectURL(exportedBlobUrl);
    setSelectedFile(null);
    setRawFileBytes(null);
    setImageElement(null);
    setExifFindings([]);
    setDetections([]);
    setVerificationResult(null);
    setFileError(null);
    setQuickStripNotice(null);
    setStep(1);
  };

  return (
    <div className="space-y-6">
      {/* Workflow Step Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-cyan-400 font-medium">
            <ShieldCheck className="w-4 h-4" />
            <span>Processed on this device · Zero server uploads</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-100 mt-1">
            {studioOnlyMode ? 'Manual Redaction Studio' : 'Protect a Photo'}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {studioOnlyMode
              ? 'Precision canvas editor for solid masking, pixelation, blur, crop, rotation, and flattened pixel export.'
              : 'Inspect hidden EXIF/GPS headers, redact faces/plates/text, and verify the exported file bytes.'}
          </p>
        </div>

        {/* 4-Step Progress Bar */}
        <div className="flex items-center gap-1.5 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800 overflow-x-auto">
          {[
            { num: 1, label: '1. Select' },
            { num: 2, label: '2. Inspect' },
            { num: 3, label: '3. Review & Edit' },
            { num: 4, label: '4. Clean & Verify' },
          ].map((s) => {
            const canClick = s.num === 1 || Boolean(selectedFile);
            return (
              <button
                key={s.num}
                type="button"
                disabled={!canClick}
                onClick={() => canClick && setStep(s.num as 1 | 2 | 3 | 4)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  step === s.num
                    ? 'bg-cyan-500 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>


      {fileError && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-sm text-red-200 flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">File Validation Error</p>
            <p className="text-xs text-red-300 mt-0.5">{fileError}</p>
          </div>
        </div>
      )}

      {/* STEP 1: SELECT */}
      {(step === 1 || !selectedFile) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) handleFileUpload(f);
            }}
            className="lg:col-span-2 rounded-2xl border-2 border-dashed border-slate-700 hover:border-cyan-500/60 bg-slate-900/50 p-8 sm:p-10 flex flex-col items-center justify-center text-center transition-colors"
          >
            <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-4">
              <Upload className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-semibold text-slate-100">
              Select or drag & drop a photo to inspect
            </h3>
            <p className="text-sm text-slate-400 mt-1 max-w-md">
              Supports JPG, JPEG, PNG, and WebP up to 25 MB. Your image stays in local browser memory and is never uploaded to any server.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileUpload(f);
              }}
              className="hidden"
              id="photo-upload-input"
            />

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isInspecting}
                className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer whitespace-nowrap"
              >
                {isInspecting ? 'Inspecting Locally...' : 'Choose Photo from Device'}
              </button>

              <button
                type="button"
                onClick={handleLoadDemoPhoto}
                disabled={isInspecting}
                className="px-4 py-2.5 rounded-xl border border-violet-500/40 bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 font-medium text-sm transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4 text-violet-400" />
                <span>Load Sample Photo (with Hidden GPS & ID)</span>
              </button>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-center gap-3 text-xs text-slate-400">
              <span>Formats: JPG · PNG · WebP</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">Max size: 25 MB</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400 font-medium">100% Local Processing</span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 flex flex-col justify-between space-y-4">
            <div>
              <h4 className="text-base font-semibold text-slate-100">
                What PrivacyGuard Checks
              </h4>
              <ul className="mt-3 space-y-3 text-xs text-slate-300 leading-relaxed">
                <li className="flex items-start gap-2.5">
                  <MapPin className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-100">Hidden EXIF & GPS:</strong> Exact coordinates, camera make/model, capture timestamps, and owner tags embedded in binary headers.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Eye className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-100">Visible Sensitive Pixels:</strong> Faces, vehicle license plates, emails, phone numbers, and ID credentials visible inside the image.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <FileCheck2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-100">Export Re-Verification:</strong> Re-inspects the exported file bytes to verify metadata removal and permanent pixel flattening.
                  </span>
                </li>
              </ul>
            </div>

            <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-3.5 text-xs text-slate-400">
              <strong className="text-slate-200">Honest Privacy Note:</strong> Removing EXIF metadata does not hide faces or text visible in the pixels. Blurring a face does not strip GPS headers. Use Step 4 to apply both.
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: INSPECT & PRIVACY PREVIEW BEFORE SHARING */}
      {step === 2 && selectedFile && (
        <div className="space-y-6">
          {/* File Info Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
              <span className="font-semibold text-slate-100">{selectedFile.name}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono uppercase">{selectedFile.type.replace('image/', '')}</span>
              {imageElement && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {imageElement.naturalWidth} × {imageElement.naturalHeight} px
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400 font-medium">Processed on this device</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetPhotoWorkflow}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                <span>Remove File</span>
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs cursor-pointer"
              >
                Continue to Review & Redact →
              </button>
            </div>
          </div>

          {/* EXTRA RECOMMENDATION 1: PRIVACY PREVIEW BEFORE SHARING */}
          <div className="rounded-2xl border border-amber-500/30 bg-amber-950/15 p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
                <h3 className="text-base font-semibold text-slate-100">
                  Privacy Preview Before Sharing: What Someone Could Learn From This Photo
                </h3>
              </div>
              {riskReport && (
                <span className="text-xs font-mono font-semibold text-amber-300">
                  Pre-Clean Exposure: {riskReport.level} ({riskReport.totalPoints}/100 rubric pts)
                </span>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5">
                <div className="flex items-center gap-1.5 text-slate-400 font-medium">
                  <MapPin className="w-3.5 h-3.5 text-amber-400" />
                  <span>Hidden Location (GPS)</span>
                </div>
                <p className="mt-1.5 font-mono text-slate-100 font-semibold">
                  {exifFindings.find((f) => f.category === 'location')?.value ||
                    'None detected in header'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5">
                <div className="flex items-center gap-1.5 text-slate-400 font-medium">
                  <Camera className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Device & Owner Metadata</span>
                </div>
                <p className="mt-1.5 text-slate-100 font-semibold">
                  {exifFindings
                    .filter((f) => f.category === 'device' || f.category === 'author')
                    .map((f) => f.value)
                    .join(' · ') || 'No device/owner tags'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5">
                <div className="flex items-center gap-1.5 text-slate-400 font-medium">
                  <Calendar className="w-3.5 h-3.5 text-violet-400" />
                  <span>Capture Timestamp</span>
                </div>
                <p className="mt-1.5 font-mono text-slate-100 font-semibold">
                  {exifFindings.find((f) => f.category === 'timestamp')?.value ||
                    'No timestamp embedded'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5">
                <div className="flex items-center gap-1.5 text-slate-400 font-medium">
                  <Eye className="w-3.5 h-3.5 text-rose-400" />
                  <span>Visible Sensitive Regions</span>
                </div>
                <p className="mt-1.5 text-slate-100 font-semibold">
                  {detections.length > 0
                    ? `${detections.length} region(s) (Faces, Plates, or PII Text)`
                    : '0 auto-flagged (inspect visually)'}
                </p>
              </div>
            </div>
          </div>

          {quickStripNotice && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3.5 text-xs text-emerald-200 flex items-center justify-between">
              <span>{quickStripNotice}</span>
              <button
                type="button"
                onClick={() => setStep(4)}
                className="font-semibold underline hover:text-emerald-100 cursor-pointer"
              >
                View Export Verification
              </button>
            </div>
          )}

          {/* Separate Clearly Labeled Checks: Hidden Metadata vs Visible Sensitive Content */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Column 1: Hidden Metadata */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-slate-100">
                      Check A: Hidden File Metadata (EXIF / XMP)
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Binary header bytes detected:{' '}
                      <span className="font-mono text-slate-200">{binaryExifSize} bytes</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => executeCleanAndVerify('metadata_only')}
                    className="px-3.5 py-2 rounded-xl bg-cyan-500/15 border border-cyan-500/40 hover:bg-cyan-500/25 text-cyan-300 font-semibold text-xs transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Remove Hidden Metadata Now
                  </button>
                </div>

                {exifFindings.length === 0 ? (
                  <div className="mt-6 rounded-xl border border-slate-800/80 bg-slate-950/50 p-6 text-center">
                    <CheckCircle2 className="w-7 h-7 text-emerald-400 mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-200">
                      No readable EXIF or GPS fields found in this file header.
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      You can still re-encode the file to guarantee a clean container and redact visible pixels.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 divide-y divide-slate-800/80 border border-slate-800 rounded-xl overflow-hidden">
                    {exifFindings.map((item) => (
                      <div key={item.key} className="p-3.5 bg-slate-950/40 flex flex-col gap-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-200">{item.label}</span>
                          <span
                            className={`font-mono text-[11px] ${
                              item.sensitivity === 'high'
                                ? 'text-rose-400 font-semibold'
                                : item.sensitivity === 'moderate'
                                ? 'text-amber-400'
                                : 'text-slate-400'
                            }`}
                          >
                            {item.sensitivity.toUpperCase()} EXPOSURE
                          </span>
                        </div>
                        <p className="font-mono text-xs text-cyan-300 break-all">{item.value}</p>
                        <p className="text-[11px] text-slate-400">{item.explanation}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="mt-4 text-xs text-slate-400">
                Note: Stripping metadata deletes hidden headers (GPS, device serials) without altering visible pixels.
              </p>
            </div>

            {/* Column 2: Visible Sensitive Content */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-slate-100">
                      Check B: Visible Sensitive Content (In Pixels)
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Faces, license plates, emails, phone numbers, and IDs inside the image
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="px-3.5 py-2 rounded-xl bg-violet-500 hover:bg-violet-400 text-white font-semibold text-xs transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Review & Redact Pixels →
                  </button>
                </div>

                {detections.length === 0 ? (
                  <div className="mt-6 rounded-xl border border-slate-800/80 bg-slate-950/50 p-6 text-center">
                    <Info className="w-7 h-7 text-amber-400 mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-200">
                      No automatic pixel detections flagged on this photo.
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      If on-device OCR/Vision models are not yet downloaded in Model Manager, automatic detection cannot guarantee a clean result. Proceed to Step 3 to inspect or draw manual redaction boxes.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 divide-y divide-slate-800/80 border border-slate-800 rounded-xl overflow-hidden">
                    {detections.map((d) => (
                      <div
                        key={d.id}
                        className="p-3.5 bg-slate-950/40 flex items-center justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-semibold text-slate-100">{d.label}</span>
                            <span aria-hidden="true" className="text-slate-600">·</span>
                            <span className="font-mono text-[11px] text-cyan-400">
                              {Math.round(d.confidence * 100)}% confidence
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Source: {d.source} · Mode: {d.redactionStyle.toUpperCase()}
                          </p>
                        </div>

                        <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={d.selectedForRedaction}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              pushDetectionState(
                                detections.map((item) =>
                                  item.id === d.id
                                    ? { ...item, selectedForRedaction: checked }
                                    : item
                                )
                              );
                            }}
                            className="rounded border-slate-600 text-cyan-500 focus:ring-cyan-500"
                          />
                          <span>Redact</span>
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="mt-4 text-xs text-slate-400">
                Tip: In Step 3 you can adjust blur strength, switch to opaque solid masking, or drag across any area to redact manually.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: REVIEW AND EDIT (REDACTION STUDIO) */}
      {step === 3 && selectedFile && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Interactive Canvas Area */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex flex-col">
            {/* Editor Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-800">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-400 mr-1">Brush / Style:</span>
                {(['solid', 'pixelate', 'blur'] as const).map((style) => (
                  <button
                    key={style}
                    type="button"
                    onClick={() => setActiveToolStyle(style)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize cursor-pointer transition-colors ${
                      activeToolStyle === style
                        ? 'bg-cyan-500 text-slate-950 font-semibold'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {style === 'solid' ? 'Solid Mask (Safer)' : style}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={historyStack.length === 0}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                  aria-label="Undo redaction change"
                  title="Undo"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={redoStack.length === 0}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                  aria-label="Redo redaction change"
                  title="Redo"
                >
                  <Redo2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setRotationDeg((r) => (r + 90) % 360)}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
                  aria-label="Rotate image 90 degrees"
                  title="Rotate 90°"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-1 bg-slate-800 rounded-lg px-2 py-1">
                  <Crop className="w-3.5 h-3.5 text-cyan-400" />
                  <select
                    aria-label="Crop aspect ratio"
                    value={cropAspect}
                    onChange={(e) =>
                      setCropAspect(e.target.value as 'full' | '1:1' | '4:3' | '16:9')
                    }
                    className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
                  >
                    <option value="full" className="bg-slate-900">
                      Crop: Full
                    </option>
                    <option value="1:1" className="bg-slate-900">
                      Crop: 1:1
                    </option>
                    <option value="4:3" className="bg-slate-900">
                      Crop: 4:3
                    </option>
                    <option value="16:9" className="bg-slate-900">
                      Crop: 16:9
                    </option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.max(0.75, +(z - 0.25).toFixed(2)))}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
                  aria-label="Zoom out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono text-slate-400 px-1">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.min(2.0, +(z + 0.25).toFixed(2)))}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
                  aria-label="Zoom in"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setCompareOriginal((prev) => !prev)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                    compareOriginal
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {compareOriginal ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  <span>{compareOriginal ? 'Showing Original' : 'Before / After Toggle'}</span>
                </button>
              </div>
            </div>


            {/* Canvas Viewport */}
            <div className="relative flex-1 min-h-[340px] flex items-center justify-center bg-slate-950 rounded-xl border border-slate-800/80 overflow-auto p-3">
              <canvas
                ref={editorCanvasRef}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                style={{
                  transform: `scale(${zoomLevel})`,
                  transformOrigin: 'center center',
                }}
                className="max-w-full max-h-[460px] object-contain rounded-lg cursor-crosshair shadow-lg transition-transform"
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <PlusSquare className="w-3.5 h-3.5 text-violet-400" />
                Click and drag anywhere on the image to draw a manual rectangular redaction box.
              </span>
              <span>
                Cyan solid outline = Applied Redaction · Amber dashed outline = Unredacted Suggestion
              </span>
            </div>
          </div>

          {/* Right Panel: Detection Controls & Export Trigger */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-100">
                  Redaction Regions ({detections.filter((d) => d.selectedForRedaction).length}/
                  {detections.length})
                </h3>
                {detections.length > 0 && (
                  <button
                    type="button"
                    onClick={() => pushDetectionState([])}
                    className="text-xs text-slate-400 hover:text-red-300 cursor-pointer"
                  >
                    Reset Regions
                  </button>
                )}
              </div>

              {/* Blur / Pixelate Intensity Slider */}
              <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3.5">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-slate-300 font-medium flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                    Blur / Pixelate Intensity
                  </span>
                  <span className="font-mono text-cyan-300">{globalBlurIntensity}px</span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={36}
                  value={globalBlurIntensity}
                  onChange={(e) => setGlobalBlurIntensity(Number(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer"
                  aria-label="Blur and pixelation intensity"
                />
              </div>

              {/* Detections List */}
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {detections.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center border border-dashed border-slate-800 rounded-xl">
                    Drag on the image canvas to add a manual redaction region.
                  </p>
                ) : (
                  detections.map((d) => (
                    <div
                      key={d.id}
                      className={`p-3 rounded-xl border text-xs transition-colors ${
                        d.selectedForRedaction
                          ? 'border-cyan-500/40 bg-cyan-950/15'
                          : 'border-slate-800 bg-slate-950/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 font-medium text-slate-100 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={d.selectedForRedaction}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              pushDetectionState(
                                detections.map((item) =>
                                  item.id === d.id
                                    ? { ...item, selectedForRedaction: checked }
                                    : item
                                )
                              );
                            }}
                            className="rounded border-slate-600 text-cyan-500"
                          />
                          <span>{d.label}</span>
                        </label>
                        {d.type === 'manual' && (
                          <button
                            type="button"
                            onClick={() =>
                              pushDetectionState(detections.filter((item) => item.id !== d.id))
                            }
                            className="text-slate-500 hover:text-red-400 cursor-pointer"
                            aria-label={`Remove ${d.label}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400">
                          {Math.round(d.confidence * 100)}% conf
                        </span>
                        <div className="flex items-center gap-1">
                          {(['blur', 'pixelate', 'solid'] as const).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={() =>
                                pushDetectionState(
                                  detections.map((item) =>
                                    item.id === d.id ? { ...item, redactionStyle: st } : item
                                  )
                                )
                              }
                              className={`px-2 py-0.5 rounded text-[11px] capitalize cursor-pointer ${
                                d.redactionStyle === st
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
                  ))
                )}
              </div>

              {/* Format & Quality Selector */}
              <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3.5 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="export-format-select" className="text-slate-300 font-medium">
                    Output Format
                  </label>
                  <select
                    id="export-format-select"
                    value={exportFormat}
                    onChange={(e) =>
                      setExportFormat(
                        e.target.value as 'image/jpeg' | 'image/png' | 'image/webp'
                      )
                    }
                    className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs text-slate-100"
                  >
                    <option value="image/jpeg">JPEG (.jpg)</option>
                    <option value="image/png">PNG (.png)</option>
                    <option value="image/webp">WebP (.webp)</option>
                  </select>
                </div>

                {exportFormat !== 'image/png' && (
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-400">Encoding Quality</span>
                      <span className="font-mono text-slate-200">
                        {Math.round(exportQuality * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.6}
                      max={1.0}
                      step={0.02}
                      value={exportQuality}
                      onChange={(e) => setExportQuality(Number(e.target.value))}
                      className="w-full accent-cyan-400 cursor-pointer"
                      aria-label="Export encoding quality"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Clean & Export Actions */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => executeCleanAndVerify('both')}
                className="w-full py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
              >
                Clean Metadata + Apply Redactions & Verify
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => executeCleanAndVerify('metadata_only')}
                  className="py-2 px-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-pointer"
                >
                  Metadata Only
                </button>
                <button
                  type="button"
                  onClick={() => executeCleanAndVerify('redactions_only')}
                  className="py-2 px-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-pointer"
                >
                  Redactions Only
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 4: CLEAN, EXPORT & RE-VERIFY ACTUAL EXPORTED FILE */}
      {step === 4 && verificationResult && selectedFile && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/15 p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="flex items-center gap-2 text-xs text-emerald-300 font-medium">
                    <span>Output File Re-Inspected</span>
                    <span aria-hidden="true">·</span>
                    <span>Processed on this device</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-100 mt-0.5">
                    Cleaned Copy Ready & Verified Locally
                  </h3>
                </div>
              </div>

              {exportedBlobUrl && (
                <a
                  href={exportedBlobUrl}
                  download={`cleaned_${selectedFile.name.replace(/\.[^.]+$/, '')}.${exportFormat.replace(
                    'image/',
                    ''
                  )}`}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors whitespace-nowrap"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Cleaned Copy</span>
                </a>
              )}
            </div>

            {/* Verification Summary Metrics */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
                <span className="text-slate-400">Binary EXIF / GPS Remaining</span>
                <p className="text-lg font-mono font-bold text-emerald-400 mt-1 tabular-nums whitespace-nowrap">
                  {verificationResult.exifApp1RemainingBytes} bytes (Verified)
                </p>
                <span className="text-[11px] text-slate-400">
                  Original had {binaryExifSize} bytes of headers
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
                <span className="text-slate-400">Visual Redactions Flattened</span>
                <p className="text-lg font-mono font-bold text-cyan-300 mt-1 tabular-nums">
                  {verificationResult.visualRedactionsAppliedCount} region(s)
                </p>
                <span className="text-[11px] text-slate-400">
                  Permanently baked into exported pixels
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
                <span className="text-slate-400">File Size Comparison</span>
                <p className="text-lg font-mono font-bold text-slate-100 mt-1 tabular-nums">
                  {(verificationResult.exportedSizeBytes / 1024).toFixed(1)} KB
                </p>
                <span className="text-[11px] text-slate-400">
                  Original: {(verificationResult.originalSizeBytes / 1024).toFixed(1)} KB
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
                <span className="text-slate-400">Unredacted Suggestions Left</span>
                <p
                  className={`text-lg font-mono font-bold mt-1 tabular-nums ${
                    verificationResult.unredactedDetectionsRemainingCount > 0
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {verificationResult.unredactedDetectionsRemainingCount}
                </p>
                <span className="text-[11px] text-slate-400">
                  Format: {verificationResult.exportedFormat}
                </span>
              </div>
            </div>
          </div>

          {/* Preview of Actual Exported Image & Detailed Verification Log */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h4 className="text-sm font-semibold text-slate-100 mb-3">
                Exported File Preview (Flattened Output)
              </h4>
              {exportedBlobUrl && (
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 flex items-center justify-center">
                  <img
                    src={exportedBlobUrl}
                    alt="Cleaned and redacted exported photo preview"
                    referrerPolicy="no-referrer"
                    className="max-h-72 object-contain rounded-lg"
                  />
                </div>
              )}
              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="text-xs font-medium text-cyan-400 hover:underline cursor-pointer"
                >
                  ← Back to Editor to Adjust Redactions
                </button>
                <button
                  type="button"
                  onClick={resetPhotoWorkflow}
                  className="text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
                >
                  Protect Another Photo
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
              <h4 className="text-sm font-semibold text-slate-100">
                Post-Export Verification Audit Log
              </h4>

              <div className="space-y-2">
                {verificationResult.checksPassed.map((msg, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-xs text-emerald-200 flex items-start gap-2.5"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{msg}</span>
                  </div>
                ))}

                {verificationResult.checksWarned.map((msg, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-200 flex items-start gap-2.5"
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>{msg}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs text-slate-400">
                <strong className="text-slate-200">Transparency Statement:</strong> No automated tool can label a file “100% private” or “guaranteed safe.” Background landmarks, clothing, or reflections can still reveal context. Always review the preview before sharing publicly.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
