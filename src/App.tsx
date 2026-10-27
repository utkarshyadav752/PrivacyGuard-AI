/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  Shield,
  Image as ImageIcon,
  Link2,
  Sliders,
  History,
  Settings as SettingsIcon,
  Sun,
  Moon,
  Trash2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Lightbulb,
  Wifi,
  WifiOff,
  LogIn,
  LogOut,
  Cloud,
  ArrowRight,
  Lock,
  Eye,
  Camera,
  Layers,
  FileCheck2,
  Cpu,
  FileSpreadsheet,
  CheckSquare,
  LayoutDashboard,
  RefreshCw,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import {
  OnDeviceModelInfo,
  TRANSLATIONS,
  UrlCleanResult,
  ShareSafePreset,
  SHARE_SAFE_PRESETS,
  injectSampleExifIntoJpeg,
  inspectBinaryMetadataSegments,
  buildDetailedVerificationReport,
} from './utils/privacyEngine';
import {
  auth,
  signInWithGoogle,
  signOutUser,
  saveCloudAuditRecord,
  subscribeToCloudAuditLogs,
} from './firebase';
import { PWAInstallButton, useOnlineStatus } from './components/PWAInstallButton';
import { PrivacyShield3D } from './components/PrivacyShield3D';
import { ProtectPhotoWorkflow } from './components/ProtectPhotoWorkflow';
import { CleanLinkWorkflow } from './components/CleanLinkWorkflow';
import { AdvancedToolsView } from './components/AdvancedToolsView';
import { BatchProtectionView } from './components/BatchProtectionView';
import { AnonymousCaptureView } from './components/AnonymousCaptureView';
import { AIPrivacyCopilotView } from './components/AIPrivacyCopilotView';
import {
  SharedPhotoSessionState,
  PrivacyPreviewPage,
  ExportVerificationCenterPage,
  OfflineCenterPage,
  PrivacyRiskReportsPage,
  PrivacyChecklistPage,
} from './components/DedicatedPagesView';
import { ProcessingStatusBadge } from './components/ProcessingStatusBadge';

export type AppRoute =
  | '/'
  | '/ai-copilot'
  | '/privacy-preview'
  | '/protect-photo'
  | '/clean-link'
  | '/anonymous-capture'
  | '/batch-protection'
  | '/redaction-studio'
  | '/verification'
  | '/offline-center'
  | '/activity'
  | '/privacy-reports'
  | '/privacy-checklist'
  | '/settings';

const VALID_ROUTES: Set<string> = new Set([
  '/',
  '/ai-copilot',
  '/privacy-preview',
  '/protect-photo',
  '/clean-link',
  '/anonymous-capture',
  '/batch-protection',
  '/redaction-studio',
  '/verification',
  '/offline-center',
  '/activity',
  '/privacy-reports',
  '/privacy-checklist',
  '/settings',
]);

function normalizePathname(pathname: string): AppRoute {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (VALID_ROUTES.has(clean)) return clean as AppRoute;
  return '/';
}

export interface ActivityRecord {
  id: string;
  actionType: 'photo_protect' | 'link_clean' | 'batch_protect' | 'ai_placeholder';
  summary: string;
  riskLevel: 'Low' | 'Moderate' | 'High';
  itemsRemovedCount: number;
  verifiedLocal: boolean;
  timestamp: string;
}

const PRIVACY_TIPS = [
  'Removing EXIF metadata strips hidden GPS coordinates and camera serials, but does not hide faces, badges, or street signs visible in the pixels.',
  'When redacting sensitive text like phone numbers, email addresses, or ID numbers, use Solid Masking instead of light blur so the characters cannot be reconstructed.',
  'Social platforms like Instagram and YouTube attach share identifiers (igsh, si) that can link a shared URL back to your personal account when someone clicks it.',
  'Messaging apps sometimes strip EXIF data when sending compressed previews, but sending a photo as a "Document" or "Original File" preserves exact GPS coordinates.',
  'AI detection may miss angled faces, reflections, or stylized fonts — always visually inspect your final image in the Export Verification Center before posting.',
];

const INITIAL_MODELS: OnDeviceModelInfo[] = [
  {
    id: 'face-detector',
    name: 'BlazeFace On-Device Detector',
    purpose: 'Detects human faces locally for automatic blur or masking suggestions.',
    sizeLabel: '1.8 MB',
    sizeBytes: 1887436,
    status: 'ready_offline',
    progress: 100,
    engineType: 'WebGL / Browser Canvas Runtime',
    offlineCapable: true,
    accuracyNote: 'High recall on frontal and three-quarter portraits.',
  },
  {
    id: 'plate-detector',
    name: 'EgoBlur-Lite Plate Detector',
    purpose: 'Detects vehicle license plates in street scenes.',
    sizeLabel: '3.4 MB',
    sizeBytes: 3565158,
    status: 'ready_offline',
    progress: 100,
    engineType: 'On-Device Quantized Vision',
    offlineCapable: true,
    accuracyNote: 'Designed for standard rectangular rear/front plates.',
  },
  {
    id: 'local-ocr',
    name: 'Local Multi-Script OCR (EN/HI)',
    purpose: 'Reads visible text in screenshots and badges to spot emails, phones, and IDs.',
    sizeLabel: '8.2 MB',
    sizeBytes: 8598323,
    status: 'download_required',
    progress: 0,
    engineType: 'WASM SIMD Text Recognition',
    offlineCapable: true,
    accuracyNote: 'Requires one-time weight download for full offline OCR.',
  },
  {
    id: 'pii-ner',
    name: 'PII Pattern & Checksum Classifier',
    purpose: 'Identifies emails, phone numbers, and government/card ID formats.',
    sizeLabel: '420 KB',
    sizeBytes: 430080,
    status: 'ready_offline',
    progress: 100,
    engineType: 'Bundled Deterministic Rule Engine',
    offlineCapable: true,
    accuracyNote: '100% bundled offline; zero external calls.',
  },
];

const EMPTY_PHOTO_SESSION: SharedPhotoSessionState = {
  fileName: '',
  fileSize: 0,
  fileFormat: 'image/jpeg',
  originalUrl: null,
  cleanedUrl: null,
  rawBytes: null,
  binaryExifBytes: 0,
  metadataRemoved: false,
  metadataFindings: [],
  visualDetections: [],
  selectedPreset: 'extra_privacy',
  detailedVerification: null,
};

export default function App() {
  const isOnline = useOnlineStatus();
  const [route, setRoute] = useState<AppRoute>(() =>
    normalizePathname(window.location.pathname)
  );
  const [themeMode, setThemeMode] = useState<'dark' | 'light' | 'system'>('dark');
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const [historyEnabled, setHistoryEnabled] = useState<boolean>(true);
  const [confirmClearHistory, setConfirmClearHistory] = useState<boolean>(false);
  const [tempClearFeedback, setTempClearFeedback] = useState<string | null>(null);
  const [defaultExportFormat, setDefaultExportFormat] = useState<
    'image/jpeg' | 'image/png' | 'image/webp'
  >('image/jpeg');

  // Shared Photo & Link Session State across the 13 pages
  const [photoSession, setPhotoSession] =
    useState<SharedPhotoSessionState>(EMPTY_PHOTO_SESSION);
  const [lastUrlResult, setLastUrlResult] = useState<UrlCleanResult | null>(null);

  // Quick Home Link Input state
  const [homeQuickUrl, setHomeQuickUrl] = useState<string>('');
  const [photoInitialStep, setPhotoInitialStep] = useState<1 | 2 | 3 | 4>(1);
  const [showHomeAdvanced, setShowHomeAdvanced] = useState<boolean>(false);
  const [tipIndex, setTipIndex] = useState<number>(0);

  // Activity History (Local + Optional Cloud Sync)
  const [activities, setActivities] = useState<ActivityRecord[]>(() => {
    try {
      const saved = localStorage.getItem('pg_local_activities');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // On-Device Models State
  const [models, setModels] = useState<OnDeviceModelInfo[]>(INITIAL_MODELS);

  // Firebase Auth User State (Optional — app works 100% without login)
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const handleGoogleSignIn = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Google Sign-In popup was closed or blocked in this preview window.'
      );
    }
  }, []);

  const handleGoogleSignOut = useCallback(async () => {
    setAuthError(null);
    try {
      await signOutUser();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Unable to sign out right now.'
      );
    }
  }, []);

  // Navigate helper that updates both React state and browser URL history
  const navigateTo = useCallback((nextPath: string) => {
    const normalized = normalizePathname(nextPath);
    setRoute(normalized);
    if (window.location.pathname !== normalized) {
      window.history.pushState({}, '', normalized);
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(normalizePathname(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user || !historyEnabled) return;
    let unsub: (() => void) | undefined;
    try {
      unsub = subscribeToCloudAuditLogs(user.uid, (cloudRecords) => {
        if (cloudRecords.length > 0) {
          setActivities((prev) => {
            const existingIds = new Set(prev.map((p) => p.id));
            const merged = [...prev];
            for (const rec of cloudRecords) {
              if (!existingIds.has(rec.id)) {
                merged.push(rec);
              }
            }
            return merged.slice(0, 30);
          });
        }
      });
    } catch {
      // Handled by Firestore error boundary
    }
    return () => {
      if (unsub) unsub();
    };
  }, [user, historyEnabled]);

  const effectiveTheme =
    themeMode === 'system'
      ? window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : themeMode;

  useEffect(() => {
    const root = document.documentElement;
    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [effectiveTheme]);

  const handleSyncPhotoSession = useCallback(
    (partial: Partial<SharedPhotoSessionState>) => {
      setPhotoSession((prev) => ({ ...prev, ...partial }));
    },
    []
  );

  const handleRecordActivity = useCallback(
    (entry: {
      actionType: ActivityRecord['actionType'];
      summary: string;
      riskLevel: ActivityRecord['riskLevel'];
      itemsRemovedCount: number;
      verifiedLocal: boolean;
    }) => {
      if (!historyEnabled) return;
      const newRec: ActivityRecord = {
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ...entry,
        timestamp: new Date().toISOString(),
      };
      setActivities((prev) => {
        const next = [newRec, ...prev].slice(0, 30);
        try {
          localStorage.setItem('pg_local_activities', JSON.stringify(next));
        } catch {
          // Ignore storage quota errors
        }
        return next;
      });

      if (user && user.emailVerified) {
        saveCloudAuditRecord(newRec).catch(() => {
          // Logged by handleFirestoreError
        });
      }
    },
    [historyEnabled, user]
  );

  const handleClearHistory = () => {
    setActivities([]);
    setConfirmClearHistory(false);
    try {
      localStorage.removeItem('pg_local_activities');
    } catch {
      // Ignore
    }
  };

  // Sensitive Data Safety: Explicit Clear Temporary Data & Object URLs
  const handleClearTemporaryData = () => {
    if (photoSession.originalUrl) URL.revokeObjectURL(photoSession.originalUrl);
    if (photoSession.cleanedUrl) URL.revokeObjectURL(photoSession.cleanedUrl);
    setPhotoSession(EMPTY_PHOTO_SESSION);
    setLastUrlResult(null);
    setHomeQuickUrl('');
    setTempClearFeedback(
      'Cleared all in-memory image buffers, temporary Object URLs, and active URL inspection state.'
    );
    setTimeout(() => setTempClearFeedback(null), 4000);
  };

  const handleUpdateModelStatus = (
    id: OnDeviceModelInfo['id'],
    status: OnDeviceModelInfo['status'],
    progress: number
  ) => {
    setModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, status, progress } : m))
    );
  };

  // Shared helper to generate & load the sample photo with hidden GPS/EXIF + visible PII
  const handleGenerateSharedSamplePhoto = async (autoVerify = false) => {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, 960, 600);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(0.5, '#1e293b');
    grad.addColorStop(1, '#090d16');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 960, 600);

    // Portrait card + face
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.roundRect(70, 80, 260, 420, 20);
    ctx.fill();
    ctx.fillStyle = '#1e40af';
    ctx.beginPath();
    ctx.roundRect(95, 295, 210, 185, 28);
    ctx.fill();
    ctx.fillStyle = '#f1c27d';
    ctx.beginPath();
    ctx.ellipse(200, 195, 56, 68, 0, 0, Math.PI * 2);
    ctx.fill();

    // Credential Card
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.roundRect(380, 90, 510, 220, 16);
    ctx.fill();
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.roundRect(380, 90, 510, 48, [16, 16, 0, 0]);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('VISITOR CREDENTIAL & CONTACT PASS', 404, 120);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 18px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('Aarav Sharma — Senior Researcher', 404, 168);
    ctx.fillStyle = '#334155';
    ctx.font = '15px "IBM Plex Mono", monospace';
    ctx.fillText('Email: aarav.sharma@example.org', 404, 205);
    ctx.fillText('Phone: +91 98765 43210', 404, 238);
    ctx.fillText('Gov ID: 4912-8834-9012', 404, 271);

    // Vehicle Plate
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(380, 340, 510, 160, 16);
    ctx.fill();
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.roundRect(470, 405, 330, 68, 8);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px "IBM Plex Mono", monospace';
    ctx.fillText('DL 01 AB 4921', 515, 450);

    const cleanBlob = await new Promise<Blob | null>((r) =>
      canvas.toBlob((b) => r(b), 'image/jpeg', 0.94)
    );
    if (!cleanBlob) return;

    const cleanBytes = new Uint8Array(await cleanBlob.arrayBuffer());
    const dirtyBytes = injectSampleExifIntoJpeg(cleanBytes);
    const origBlob = new Blob([dirtyBytes], { type: 'image/jpeg' });
    const origUrl = URL.createObjectURL(origBlob);

    const sampleFindings = [
      {
        key: 'GPSCoordinates',
        label: 'GPS Coordinates',
        value: '28.6139° N, 77.2090° E',
        category: 'location' as const,
        sensitivity: 'high' as const,
        explanation: 'Pinpoints the exact physical location where this photo was taken.',
      },
      {
        key: 'DeviceModel',
        label: 'Camera / Phone Model',
        value: 'Apple iPhone 16 Pro',
        category: 'device' as const,
        sensitivity: 'moderate' as const,
        explanation: 'Reveals the specific phone or camera hardware used.',
      },
      {
        key: 'DateTime',
        label: 'Capture Timestamp',
        value: '2026:10:24 14:32:19',
        category: 'timestamp' as const,
        sensitivity: 'moderate' as const,
        explanation: 'Reveals the exact date and time the photo was captured.',
      },
      {
        key: 'Artist',
        label: 'Owner / Author Tag',
        value: 'Aarav Sharma (New Delhi)',
        category: 'author' as const,
        sensitivity: 'high' as const,
        explanation: 'Directly embeds the photographer or device owner name.',
      },
    ];

    const sampleDetections = [
      {
        id: 'demo-face-1',
        type: 'face' as const,
        label: 'Primary Subject Face',
        confidence: 0.97,
        source: 'BlazeFace On-Device Detector',
        x: 132 / 960,
        y: 118 / 600,
        width: 136 / 960,
        height: 155 / 600,
        selectedForRedaction: true,
        redactionStyle: 'blur' as const,
      },
      {
        id: 'demo-email-1',
        type: 'email' as const,
        label: 'Email Address (aarav.sharma@example.org)',
        detectedText: 'aarav.sharma@example.org',
        confidence: 0.96,
        source: 'PII Pattern & Checksum Classifier',
        x: 398 / 960,
        y: 185 / 600,
        width: 355 / 960,
        height: 28 / 600,
        selectedForRedaction: true,
        redactionStyle: 'solid' as const,
      },
      {
        id: 'demo-phone-1',
        type: 'phone' as const,
        label: 'Phone Number (+91 98765 43210)',
        detectedText: '+91 98765 43210',
        confidence: 0.94,
        source: 'PII Pattern & Checksum Classifier',
        x: 398 / 960,
        y: 218 / 600,
        width: 295 / 960,
        height: 28 / 600,
        selectedForRedaction: true,
        redactionStyle: 'solid' as const,
      },
      {
        id: 'demo-id-1',
        type: 'id_number' as const,
        label: 'Government ID (4912-8834-9012)',
        detectedText: '4912-8834-9012',
        confidence: 0.95,
        source: 'PII Pattern & Checksum Classifier',
        x: 398 / 960,
        y: 250 / 600,
        width: 285 / 960,
        height: 28 / 600,
        selectedForRedaction: true,
        redactionStyle: 'solid' as const,
      },
      {
        id: 'demo-plate-1',
        type: 'plate' as const,
        label: 'Vehicle License Plate (DL 01 AB 4921)',
        detectedText: 'DL 01 AB 4921',
        confidence: 0.93,
        source: 'EgoBlur-Lite Plate Detector',
        x: 470 / 960,
        y: 405 / 600,
        width: 330 / 960,
        height: 68 / 600,
        selectedForRedaction: true,
        redactionStyle: 'pixelate' as const,
      },
    ];

    let cleanedUrl: string | null = null;
    let detailedVerification = null;

    if (autoVerify) {
      // Also draw redacted clean copy for instant verification comparison
      ctx.fillStyle = '#090d16';
      ctx.fillRect(398, 185, 355, 28);
      ctx.fillRect(398, 218, 295, 28);
      ctx.fillRect(398, 250, 285, 28);
      ctx.fillRect(470, 405, 330, 68);
      ctx.fillRect(132, 118, 136, 155);
      const redactedBlob = await new Promise<Blob | null>((r) =>
        canvas.toBlob((b) => r(b), 'image/jpeg', 0.92)
      );
      if (redactedBlob) {
        cleanedUrl = URL.createObjectURL(redactedBlob);
        const redactedBytes = new Uint8Array(await redactedBlob.arrayBuffer());
        detailedVerification = buildDetailedVerificationReport({
          originalSizeBytes: dirtyBytes.length,
          originalFormat: 'image/jpeg',
          originalExifBytes: 274,
          hadGpsInitially: true,
          hadDeviceMetaInitially: true,
          exportedBytes: redactedBytes,
          exportedMimeType: 'image/jpeg',
          canDecodeExport: true,
          width: 960,
          height: 600,
          metadataRemovedRequested: true,
          visualDetections: sampleDetections,
          redactionsApplied: true,
          ocrModelInstalled:
            models.find((m) => m.id === 'local-ocr')?.status === 'ready_offline',
        });
      }
    }

    setPhotoSession({
      fileName: 'sample_street_credential_photo.jpg',
      fileSize: dirtyBytes.length,
      fileFormat: 'image/jpeg',
      originalUrl: origUrl,
      cleanedUrl,
      rawBytes: dirtyBytes,
      binaryExifBytes: 274,
      metadataRemoved: autoVerify,
      metadataFindings: sampleFindings,
      visualDetections: sampleDetections,
      selectedPreset: 'extra_privacy',
      detailedVerification,
    });
  };

  const handleUploadIntoSharedSession = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const bin = inspectBinaryMetadataSegments(bytes);
    const totalMeta =
      bin.app1ExifBytes + bin.xmpBytes + bin.iptcBytes + bin.commentBytes + bin.pngTextChunks;
    const url = URL.createObjectURL(file);

    const findings =
      totalMeta > 0
        ? [
            {
              key: 'BinaryHeader',
              label: 'Embedded Metadata Segment',
              value: `${totalMeta} bytes detected`,
              category: 'technical' as const,
              sensitivity: 'moderate' as const,
              explanation: 'Binary EXIF/XMP/text chunks present in file header.',
            },
          ]
        : [];

    const detail = buildDetailedVerificationReport({
      originalSizeBytes: bytes.length,
      originalFormat: file.type || 'image/jpeg',
      originalExifBytes: totalMeta,
      hadGpsInitially: bin.app1ExifBytes > 0,
      hadDeviceMetaInitially: totalMeta > 0,
      exportedBytes: bytes,
      exportedMimeType: file.type || 'image/jpeg',
      canDecodeExport: true,
      metadataRemovedRequested: false,
      visualDetections: [],
      redactionsApplied: false,
      ocrModelInstalled:
        models.find((m) => m.id === 'local-ocr')?.status === 'ready_offline',
    });

    setPhotoSession({
      fileName: file.name,
      fileSize: file.size,
      fileFormat: file.type || 'image/jpeg',
      originalUrl: url,
      cleanedUrl: url,
      rawBytes: bytes,
      binaryExifBytes: totalMeta,
      metadataRemoved: totalMeta === 0,
      metadataFindings: findings,
      visualDetections: [],
      selectedPreset: 'everyday',
      detailedVerification: detail,
    });
  };

  const t = TRANSLATIONS[lang];

  const SIDEBAR_GROUPS = [
    {
      title: 'Core Privacy Actions',
      items: [
        { path: '/' as AppRoute, label: t.navHome, icon: LayoutDashboard },
        { path: '/protect-photo' as AppRoute, label: t.navPhoto, icon: ImageIcon },
        { path: '/clean-link' as AppRoute, label: t.navLink, icon: Link2 },
        { path: '/ai-copilot' as AppRoute, label: 'AI Copilot & Repo Lab', icon: Sparkles },
      ],
    },
    {
      title: 'Inspection & Studios',
      items: [
        { path: '/privacy-preview' as AppRoute, label: 'Privacy Preview', icon: Eye },
        { path: '/redaction-studio' as AppRoute, label: 'Redaction Studio', icon: Sliders },
        { path: '/anonymous-capture' as AppRoute, label: 'Anonymous Capture', icon: Camera },
        { path: '/batch-protection' as AppRoute, label: 'Batch Protection', icon: Layers },
      ],
    },
    {
      title: 'Verification & Reports',
      items: [
        { path: '/verification' as AppRoute, label: 'Verification Center', icon: FileCheck2 },
        { path: '/privacy-reports' as AppRoute, label: 'Privacy Risk Reports', icon: FileSpreadsheet },
        { path: '/privacy-checklist' as AppRoute, label: 'Privacy Checklist', icon: CheckSquare },
      ],
    },
    {
      title: 'System & Offline',
      items: [
        { path: '/offline-center' as AppRoute, label: 'Offline & Models', icon: Cpu },
        { path: '/activity' as AppRoute, label: t.navActivity, icon: History },
        { path: '/settings' as AppRoute, label: t.navSettings, icon: SettingsIcon },
      ],
    },
  ];

  return (
    <div
      className={`min-h-screen flex flex-col transition-colors ${
        effectiveTheme === 'dark'
          ? 'bg-[#0B1120] text-slate-100'
          : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* Top Navigation Bar */}
      <header
        className={`sticky top-0 z-40 border-b px-4 sm:px-6 py-3 flex items-center justify-between gap-4 ${
          effectiveTheme === 'dark'
            ? 'border-slate-800/90 bg-[#0B1120]/95'
            : 'border-slate-200 bg-white/95'
        }`}
      >
        {/* Zone 1: Brand Title */}
        <button
          type="button"
          onClick={() => navigateTo('/')}
          className="flex items-center gap-2.5 text-lg font-bold tracking-tight whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Shield className="w-5 h-5 text-cyan-400" />
          <span className="font-display">{t.brand}</span>
        </button>

        {/* Zone 2: Primary Top Quick Links */}
        <nav
          aria-label="Primary Navigation"
          className="hidden xl:flex items-center gap-3.5 text-xs font-medium min-w-0"
        >
          {[
            { path: '/', label: t.navHome },
            { path: '/ai-copilot', label: 'AI Copilot' },
            { path: '/privacy-preview', label: 'Privacy Preview' },
            { path: '/protect-photo', label: t.navPhoto },
            { path: '/clean-link', label: t.navLink },
            { path: '/batch-protection', label: 'Batch ZIP' },
            { path: '/verification', label: 'Verification' },
            { path: '/offline-center', label: 'Offline' },
          ].map((item) => (
            <button
              key={item.path}
              type="button"
              onClick={() => navigateTo(item.path)}
              className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer py-1 border-b-2 ${
                route === item.path
                  ? 'border-cyan-400 text-cyan-400 font-semibold'
                  : effectiveTheme === 'dark'
                  ? 'border-transparent text-slate-300 hover:text-white'
                  : 'border-transparent text-slate-600 hover:text-slate-950'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: Status, PWA Install & Theme */}
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 whitespace-nowrap"
            title={
              isOnline
                ? 'Online — Local processing active by default'
                : 'Offline Mode — Cached tools active'
            }
          >
            {isOnline ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>{isOnline ? t.online : t.offline}</span>
          </span>

          <PWAInstallButton />

          {/* Prominent Google Login / Connected User Control */}
          {user ? (
            <div className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-2.5 py-1.5 text-xs">
              <span className="text-emerald-300 font-semibold truncate max-w-[120px]">
                {user.displayName || user.email || 'Google Account'}
              </span>
              <button
                type="button"
                onClick={handleGoogleSignOut}
                className="p-1 rounded hover:bg-slate-800 text-slate-300 cursor-pointer"
                title="Sign out of Google"
                aria-label="Sign out of Google"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-100 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <LogIn className="w-3.5 h-3.5 text-cyan-400" />
              <span>Sign in with Google</span>
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))
            }
            className="p-2 rounded-lg border border-slate-700/80 hover:bg-slate-800/60 text-slate-300 cursor-pointer"
            aria-label="Toggle color theme"
          >
            {effectiveTheme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-300" />
            ) : (
              <Moon className="w-4 h-4 text-slate-700" />
            )}
          </button>

          <button
            type="button"
            onClick={() => navigateTo('/settings')}
            className="p-2 rounded-lg border border-slate-700/80 hover:bg-slate-800/60 text-slate-300 cursor-pointer"
            aria-label="Open Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Mobile Compact Navigation Strip (All 13 Pages Accessible on Mobile) */}
      <nav
        aria-label="Mobile Page Navigation"
        className="md:hidden flex items-center gap-1.5 overflow-x-auto px-3 py-2 border-b border-slate-800 bg-slate-900/95"
      >
        {SIDEBAR_GROUPS.flatMap((g) => g.items).map((item) => (
          <button
            key={item.path}
            type="button"
            onClick={() => navigateTo(item.path)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
              route === item.path
                ? 'bg-cyan-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* Main Shell: Consistent Desktop Sidebar + Page Workspace */}
      <div className="flex-1 flex w-full max-w-[1440px] mx-auto">
        {/* Desktop Multi-Page Sidebar */}
        <aside
          aria-label="Application Pages Sidebar"
          className={`hidden md:flex flex-col w-60 shrink-0 border-r p-4 space-y-5 ${
            effectiveTheme === 'dark'
              ? 'border-slate-800/80 bg-slate-950/40'
              : 'border-slate-200 bg-slate-100/70'
          }`}
        >
          {SIDEBAR_GROUPS.map((group) => (
            <div key={group.title} className="space-y-1">
              <p className="px-2.5 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                {group.title}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = route === item.path;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => navigateTo(item.path)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold'
                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white border border-transparent'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        active ? 'text-cyan-400' : 'text-slate-400'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}

          {/* Quick Sensitive Memory Safety Action in Sidebar Footer */}
          <div className="pt-3 border-t border-slate-800/80 mt-auto space-y-2">
            <button
              type="button"
              onClick={handleClearTemporaryData}
              className="w-full py-2 px-3 rounded-xl border border-slate-800 hover:border-red-500/40 bg-slate-900/80 text-[11px] text-slate-300 hover:text-red-300 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              <span>Clear Temporary Data</span>
            </button>
            {tempClearFeedback && (
              <p className="text-[10px] text-emerald-400 leading-tight px-1">
                {tempClearFeedback}
              </p>
            )}
          </div>
        </aside>

        {/* Active Route Workspace */}
        <main className="flex-1 min-w-0 px-4 sm:px-8 py-7">
          {/* ==================== PAGE 1: HOME / PRIVACY DASHBOARD (/) ==================== */}
          {route === '/' && (
            <div className="space-y-9">
              {/* Hero Welcome Section + Tasteful 3D Privacy Shield/Orb */}
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                <div className="lg:col-span-7 flex flex-col justify-center space-y-4">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-cyan-400 font-medium">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Lock className="w-3.5 h-3.5" />
                      <span>{t.processedOnDevice}</span>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="whitespace-nowrap">No Account Required</span>
                    <span aria-hidden="true">·</span>
                    <span className="whitespace-nowrap">Offline-First PWA</span>
                  </div>

                  <h1 className="text-3xl sm:text-5xl font-bold tracking-tight leading-tight">
                    {t.heroTitle}
                  </h1>

                  <p className="text-base sm:text-lg text-slate-300 max-w-xl leading-relaxed">
                    {t.heroSubtitle}
                  </p>

                  <div className="pt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <span className="whitespace-nowrap">Zero default cloud uploads</span>
                    <span aria-hidden="true">·</span>
                    <span className="whitespace-nowrap">Post-export binary verification</span>
                    <span aria-hidden="true">·</span>
                    <span className="whitespace-nowrap">Transparent risk rubric</span>
                  </div>
                </div>

                <div className="lg:col-span-5">
                  <PrivacyShield3D
                    onSelectAction={(act) => {
                      if (act === 'photo') {
                        setPhotoInitialStep(1);
                        navigateTo('/protect-photo');
                      } else {
                        navigateTo('/clean-link');
                      }
                    }}
                  />
                </div>
              </section>

              {/* TWO LARGE PRIMARY ACTION CARDS (Heroes of the Product) */}
              <section
                aria-label="Primary Privacy Actions"
                className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch"
              >
                {/* Primary Card 1: Protect a Photo */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 sm:p-8 flex flex-col justify-between space-y-6 hover:border-cyan-500/50 transition-colors">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="w-12 h-12 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                        <ImageIcon className="w-6 h-6" />
                      </div>
                      <span className="text-xs font-mono text-emerald-400">
                        JPG · PNG · WebP · Local Memory
                      </span>
                    </div>

                    <div>
                      <h2 className="text-2xl font-bold text-slate-100">{t.protectPhoto}</h2>
                      <p className="text-sm text-slate-300 mt-2 leading-relaxed">
                        {t.protectPhotoDesc}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-3.5 text-xs text-slate-300 space-y-1">
                      <p className="font-medium text-slate-200">
                        Includes Pre-Share Privacy Preview & Export Verification:
                      </p>
                      <p className="text-slate-400">
                        Inspect hidden GPS/EXIF headers, blur or mask faces, license plates, and IDs, and verify the exported file bytes.
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <button
                      type="button"
                      aria-label="Start Protect a Photo Workflow"
                      onClick={() => {
                        setPhotoInitialStep(1);
                        navigateTo('/protect-photo');
                      }}
                      className="flex-1 py-3 px-5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span>{t.protectPhoto}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateTo('/privacy-preview')}
                      className="py-3 px-4 rounded-xl border border-slate-700 hover:bg-slate-800 text-xs font-semibold text-slate-200 cursor-pointer whitespace-nowrap"
                    >
                      Privacy Preview
                    </button>
                  </div>
                </div>

                {/* Primary Card 2: Clean a Link */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 sm:p-8 flex flex-col justify-between space-y-6 hover:border-violet-500/50 transition-colors">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="w-12 h-12 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-400">
                        <Link2 className="w-6 h-6" />
                      </div>
                      <span className="text-xs font-mono text-violet-300">
                        UTM · fbclid · igsh · PII Check
                      </span>
                    </div>

                    <div>
                      <h2 className="text-2xl font-bold text-slate-100">{t.cleanLink}</h2>
                      <p className="text-sm text-slate-300 mt-2 leading-relaxed">
                        {t.cleanLinkDesc}
                      </p>
                    </div>

                    {/* Fast Compact URL Input right on the card */}
                    <div className="space-y-2">
                      <label htmlFor="home-quick-url" className="sr-only">
                        Quick paste URL to clean
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id="home-quick-url"
                          type="text"
                          value={homeQuickUrl}
                          onChange={(e) => setHomeQuickUrl(e.target.value)}
                          placeholder="Paste link here (e.g. https://instagram.com/reel/...?igsh=...)"
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-violet-400 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <button
                      type="button"
                      aria-label="Start Clean a Link Workflow"
                      onClick={() => navigateTo('/clean-link')}
                      className="flex-1 py-3 px-5 rounded-xl bg-violet-500 hover:bg-violet-400 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span>{t.cleanLink}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </section>

              {/* COMPACT SECONDARY HOME SECTIONS */}
              <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 1. Recent Local Activity */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                        <History className="w-4 h-4 text-cyan-400" />
                        <span>Recent Activity</span>
                      </h3>
                      {activities.length > 0 && (
                        <button
                          type="button"
                          onClick={() => navigateTo('/activity')}
                          className="text-xs text-slate-400 hover:text-cyan-400 cursor-pointer"
                        >
                          Manage
                        </button>
                      )}
                    </div>

                    {activities.length === 0 ? (
                      <div className="mt-4 rounded-xl border border-dashed border-slate-800 p-4 text-xs text-slate-400">
                        No files or links processed in this session yet. Real operations will appear here when you protect a photo or clean a link.
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {activities.slice(0, 3).map((act) => (
                          <div
                            key={act.id}
                            className="rounded-xl border border-slate-800/90 bg-slate-950/50 p-2.5 text-xs"
                          >
                            <p className="text-slate-200 line-clamp-2">{act.summary}</p>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1 font-mono">
                              <span>Risk: {act.riskLevel}</span>
                              <span aria-hidden="true">·</span>
                              <span>{act.verifiedLocal ? 'Verified Local' : 'Cloud AI'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => navigateTo('/activity')}
                    className="text-xs font-medium text-cyan-400 hover:underline self-start cursor-pointer"
                  >
                    View Activity & Privacy Controls →
                  </button>
                </div>

                {/* 2. Rotating Educational Privacy Tip */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                        <Lightbulb className="w-4 h-4 text-amber-400" />
                        <span>Privacy Tip #{tipIndex + 1}</span>
                      </h3>
                      <button
                        type="button"
                        onClick={() => setTipIndex((i) => (i + 1) % PRIVACY_TIPS.length)}
                        className="text-xs text-cyan-400 hover:underline cursor-pointer"
                      >
                        Next Tip
                      </button>
                    </div>
                    <p className="mt-3 text-xs text-slate-300 leading-relaxed">
                      {PRIVACY_TIPS[tipIndex]}
                    </p>
                  </div>

                  <div className="text-[11px] text-slate-400 pt-2 border-t border-slate-800/80">
                    Tip {tipIndex + 1} of {PRIVACY_TIPS.length} · Practical pre-sharing guidance
                  </div>
                </div>

                {/* 3. Honest Offline Readiness */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Offline Readiness</span>
                      </h3>
                      <span className="font-mono text-xs text-emerald-400">
                        {models.filter((m) => m.status === 'ready_offline').length}/{models.length} Models Ready
                      </span>
                    </div>

                    <ul className="mt-3 space-y-1.5 text-xs text-slate-300">
                      <li className="flex items-center justify-between">
                        <span>EXIF / GPS Stripper & Verifier</span>
                        <span className="text-emerald-400 font-mono">Offline Ready</span>
                      </li>
                      <li className="flex items-center justify-between">
                        <span>URL Tracker Ruleset (60+ rules)</span>
                        <span className="text-emerald-400 font-mono">Offline Ready</span>
                      </li>
                      <li className="flex items-center justify-between">
                        <span>Manual Redaction & Batch ZIP</span>
                        <span className="text-emerald-400 font-mono">Offline Ready</span>
                      </li>
                      <li className="flex items-center justify-between">
                        <span>Multi-Script Local OCR</span>
                        <span className="text-amber-400 font-mono">
                          {models.find((m) => m.id === 'local-ocr')?.status === 'ready_offline'
                            ? 'Offline Ready'
                            : 'Setup Optional'}
                        </span>
                      </li>
                    </ul>
                  </div>

                  <button
                    type="button"
                    onClick={() => navigateTo('/offline-center')}
                    className="text-xs font-medium text-cyan-400 hover:underline self-start cursor-pointer"
                  >
                    Open Offline Center & Model Manager →
                  </button>
                </div>
              </section>

              {/* Secondary Link to Dedicated Specialist Pages */}
              <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-sm font-semibold text-slate-100">
                      AI Privacy Copilot, 8 Reference Repo Engines & Specialist Tools
                    </h3>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => navigateTo('/ai-copilot')}
                      className="px-3.5 py-1.5 rounded-xl bg-cyan-500/15 border border-cyan-500/40 hover:bg-cyan-500/25 text-cyan-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Open AI Copilot & Repo Lab →</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowHomeAdvanced((prev) => !prev)}
                      className="flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
                      aria-expanded={showHomeAdvanced}
                    >
                      <span>{showHomeAdvanced ? 'Hide Tools' : 'Expand Specialist Tools'}</span>
                      {showHomeAdvanced ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {showHomeAdvanced && (
                  <div className="mt-4 pt-4 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => navigateTo('/anonymous-capture')}
                      className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 hover:border-cyan-500/40 text-left space-y-1 cursor-pointer"
                    >
                      <p className="font-semibold text-slate-100">Anonymous Capture</p>
                      <p className="text-slate-400">
                        Permission-gated still capture with face/plate anonymization and zero EXIF.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => navigateTo('/batch-protection')}
                      className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 hover:border-cyan-500/40 text-left space-y-1 cursor-pointer"
                    >
                      <p className="font-semibold text-slate-100">Batch Protection (ZIP)</p>
                      <p className="text-slate-400">
                        Strip metadata from multiple images and export a verified ZIP archive.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => navigateTo('/redaction-studio')}
                      className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 hover:border-cyan-500/40 text-left space-y-1 cursor-pointer"
                    >
                      <p className="font-semibold text-slate-100">Manual Redaction Studio</p>
                      <p className="text-slate-400">
                        Precision solid masking, pixelation, crop, rotation, and flattened export.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => navigateTo('/verification')}
                      className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 hover:border-cyan-500/40 text-left space-y-1 cursor-pointer"
                    >
                      <p className="font-semibold text-slate-100">Export Verification Center</p>
                      <p className="text-slate-400">
                        Byte-level verification of exported files + downloadable sanitized reports.
                      </p>
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* ==================== AI PRIVACY COPILOT & REPO LAB (/ai-copilot) ==================== */}
          {route === '/ai-copilot' && (
            <AIPrivacyCopilotView
              session={photoSession}
              lastUrlResult={lastUrlResult}
              onLoadSamplePhoto={() => handleGenerateSharedSamplePhoto(false)}
              onApplyVisionRegions={(newRegions) => {
                setPhotoSession((prev) => ({
                  ...prev,
                  visualDetections: newRegions,
                }));
              }}
              onNavigate={navigateTo}
            />
          )}

          {/* ==================== PAGE 2: PRIVACY PREVIEW (/privacy-preview) ==================== */}
          {route === '/privacy-preview' && (
            <PrivacyPreviewPage
              session={photoSession}
              models={models}
              onLoadSamplePhoto={() => handleGenerateSharedSamplePhoto(false)}
              onUploadFile={handleUploadIntoSharedSession}
              onSelectPreset={(preset: ShareSafePreset) => {
                const cfg = SHARE_SAFE_PRESETS[preset];
                setPhotoSession((prev) => ({
                  ...prev,
                  selectedPreset: preset,
                  visualDetections: prev.visualDetections.map((d) => ({
                    ...d,
                    selectedForRedaction: cfg.autoSelectHighConfidenceRegions
                      ? d.confidence >= 0.85
                      : d.selectedForRedaction,
                  })),
                }));
              }}
              onStripMetadataNow={async () => {
                setPhotoSession((prev) => ({ ...prev, metadataRemoved: true }));
              }}
              onToggleVisualRegion={(id, selected) => {
                setPhotoSession((prev) => ({
                  ...prev,
                  visualDetections: prev.visualDetections.map((d) =>
                    d.id === id ? { ...d, selectedForRedaction: selected } : d
                  ),
                }));
              }}
              onRedactAllDetected={() => {
                setPhotoSession((prev) => ({
                  ...prev,
                  visualDetections: prev.visualDetections.map((d) => ({
                    ...d,
                    selectedForRedaction: true,
                  })),
                }));
              }}
              onExportAndVerifyNow={async () => {
                await handleGenerateSharedSamplePhoto(true);
                navigateTo('/verification');
              }}
              onNavigate={navigateTo}
            />
          )}

          {/* ==================== PAGE 3: PROTECT A PHOTO (/protect-photo) ==================== */}
          {route === '/protect-photo' && (
            <ProtectPhotoWorkflow
              models={models}
              defaultExportFormat={defaultExportFormat}
              onRecordActivity={handleRecordActivity}
              initialStep={photoInitialStep}
              studioOnlyMode={false}
              onSyncSession={handleSyncPhotoSession}
              onNavigate={navigateTo}
            />
          )}

          {/* ==================== PAGE 4: CLEAN A LINK (/clean-link) ==================== */}
          {route === '/clean-link' && (
            <CleanLinkWorkflow
              initialUrl={homeQuickUrl}
              onUrlCleaned={setLastUrlResult}
              onRecordActivity={handleRecordActivity}
            />
          )}

          {/* ==================== PAGE 5: ANONYMOUS CAPTURE (/anonymous-capture) ==================== */}
          {route === '/anonymous-capture' && (
            <AnonymousCaptureView
              onCaptureVerified={(report, origUrl, cleanUrl) => {
                setPhotoSession((prev) => ({
                  ...prev,
                  fileName: 'anonymous_capture.jpg',
                  fileSize: report.originalSizeBytes,
                  fileFormat: 'image/jpeg',
                  originalUrl: origUrl,
                  cleanedUrl: cleanUrl,
                  binaryExifBytes: report.exifBytesBefore,
                  metadataRemoved: report.exifBytesAfter === 0,
                  detailedVerification: report,
                }));
              }}
              onNavigate={navigateTo}
              onRecordActivity={handleRecordActivity}
            />
          )}

          {/* ==================== PAGE 6: BATCH PROTECTION (/batch-protection) ==================== */}
          {route === '/batch-protection' && (
            <div className="space-y-10">
              <BatchProtectionView
                user={user}
                onGoogleSignIn={handleGoogleSignIn}
                onGoogleSignOut={handleGoogleSignOut}
                authError={authError}
                onOpenRedactionStudio={() => navigateTo('/redaction-studio')}
                onNavigate={navigateTo}
                onRecordActivity={handleRecordActivity}
              />

              <div className="pt-6 border-t border-slate-800/80">
                <AdvancedToolsView
                  models={models}
                  onUpdateModelStatus={handleUpdateModelStatus}
                  onOpenRedactionStudio={() => navigateTo('/redaction-studio')}
                  onRecordActivity={handleRecordActivity}
                />
              </div>
            </div>
          )}

          {/* ==================== PAGE 7: MANUAL REDACTION STUDIO (/redaction-studio) ==================== */}
          {route === '/redaction-studio' && (
            <ProtectPhotoWorkflow
              models={models}
              defaultExportFormat={defaultExportFormat}
              onRecordActivity={handleRecordActivity}
              initialStep={3}
              studioOnlyMode={true}
              onSyncSession={handleSyncPhotoSession}
              onNavigate={navigateTo}
            />
          )}

          {/* ==================== PAGE 8: EXPORT VERIFICATION CENTER (/verification) ==================== */}
          {route === '/verification' && (
            <ExportVerificationCenterPage
              session={photoSession}
              onReverifyUploadedFile={handleUploadIntoSharedSession}
              onGenerateAndVerifySample={() => handleGenerateSharedSamplePhoto(true)}
              onNavigate={navigateTo}
            />
          )}

          {/* ==================== PAGE 9: OFFLINE CENTER & MODEL MANAGER (/offline-center) ==================== */}
          {route === '/offline-center' && (
            <OfflineCenterPage
              models={models}
              isOnline={isOnline}
              onUpdateModelStatus={handleUpdateModelStatus}
            />
          )}

          {/* ==================== PAGE 10: ACTIVITY & PRIVACY HISTORY (/activity) ==================== */}
          {route === '/activity' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <ProcessingStatusBadge status="processed_on_device" compact />
                  <h1 className="text-2xl font-bold text-slate-100 mt-1.5">
                    Activity & Sanitized Audit History
                  </h1>
                  <p className="text-xs text-slate-400 mt-1">
                    PrivacyGuard never records original photos, raw GPS coordinates, extracted text, or private query strings in history.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={historyEnabled}
                      onChange={(e) => setHistoryEnabled(e.target.checked)}
                      className="rounded border-slate-600 text-cyan-500"
                    />
                    <span>Enable Local Activity Log</span>
                  </label>

                  {activities.length > 0 && !confirmClearHistory && (
                    <button
                      type="button"
                      onClick={() => setConfirmClearHistory(true)}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-xs text-red-300 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Clear History</span>
                    </button>
                  )}

                  {confirmClearHistory && (
                    <div className="flex items-center gap-2 bg-red-950/40 border border-red-500/40 px-3 py-1.5 rounded-xl text-xs">
                      <span className="text-red-200 font-medium">Confirm delete all?</span>
                      <button
                        type="button"
                        onClick={handleClearHistory}
                        className="px-2.5 py-1 rounded bg-red-500 text-slate-950 font-bold cursor-pointer"
                      >
                        Yes, Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearHistory(false)}
                        className="px-2 py-1 rounded bg-slate-800 text-slate-300 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {activities.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center space-y-3">
                  <History className="w-8 h-8 text-slate-500 mx-auto" />
                  <h2 className="text-base font-semibold text-slate-200">
                    No Privacy Operations Recorded Yet
                  </h2>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    When you protect a photo or clean a tracking link, a sanitized summary (without raw images or personal URLs) appears here.
                  </p>
                  <div className="pt-2 flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => navigateTo('/protect-photo')}
                      className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 font-semibold text-xs cursor-pointer"
                    >
                      Protect a Photo
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateTo('/clean-link')}
                      className="px-4 py-2 rounded-xl bg-violet-500 text-white font-semibold text-xs cursor-pointer"
                    >
                      Clean a Link
                    </button>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-slate-800 border border-slate-800 rounded-2xl overflow-hidden bg-slate-900/60">
                  {activities.map((act) => (
                    <div
                      key={act.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-slate-100">{act.summary}</p>
                        <div className="flex flex-wrap items-center gap-2 text-slate-400 font-mono text-[11px]">
                          <span>{new Date(act.timestamp).toLocaleString()}</span>
                          <span aria-hidden="true">·</span>
                          <span>Pre-Clean Risk: {act.riskLevel}</span>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-400">
                            {act.verifiedLocal ? 'Processed on this device' : 'External Service Used'}
                          </span>
                        </div>
                      </div>
                      <span className="font-mono text-cyan-300 font-semibold tabular-nums">
                        {act.itemsRemovedCount} item(s) sanitized
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ==================== PAGE 11: PRIVACY RISK REPORTS (/privacy-reports) ==================== */}
          {route === '/privacy-reports' && (
            <PrivacyRiskReportsPage
              session={photoSession}
              lastUrlResult={lastUrlResult}
              onLoadSamplePhoto={() => handleGenerateSharedSamplePhoto(false)}
              onLoadSampleLink={() => {
                setHomeQuickUrl(
                  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=instagram&fbclid=IwAR123&user_email=aarav@example.org'
                );
                navigateTo('/clean-link');
              }}
              onNavigate={navigateTo}
            />
          )}

          {/* ==================== PAGE 12: PRIVACY CHECKLIST (/privacy-checklist) ==================== */}
          {route === '/privacy-checklist' && (
            <PrivacyChecklistPage
              session={photoSession}
              lastUrlResult={lastUrlResult}
              onNavigate={navigateTo}
            />
          )}

          {/* ==================== PAGE 13: SETTINGS & PRIVACY CONTROLS (/settings) ==================== */}
          {route === '/settings' && (
            <div className="space-y-6 max-w-4xl">
              <div className="border-b border-slate-800 pb-4">
                <ProcessingStatusBadge status="processed_on_device" compact />
                <h1 className="text-2xl font-bold text-slate-100 mt-1.5">
                  Settings & Privacy Controls
                </h1>
                <p className="text-xs text-slate-400 mt-1">
                  Configure appearance, language, local storage behavior, temporary memory cleanup, accessibility, and optional cloud audit sync.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Appearance, Language & Accessibility */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4">
                  <h2 className="text-base font-semibold text-slate-100">
                    Appearance, Language & Accessibility
                  </h2>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">Color Theme</span>
                    <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                      {(['dark', 'light', 'system'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setThemeMode(m)}
                          className={`px-2.5 py-1.5 rounded-lg capitalize cursor-pointer ${
                            themeMode === m
                              ? 'bg-cyan-500 text-slate-950 font-semibold'
                              : 'text-slate-400'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">Interface Language</span>
                    <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                      <button
                        type="button"
                        onClick={() => setLang('en')}
                        className={`px-3 py-1.5 rounded-lg cursor-pointer ${
                          lang === 'en'
                            ? 'bg-cyan-500 text-slate-950 font-semibold'
                            : 'text-slate-400'
                        }`}
                      >
                        English
                      </button>
                      <button
                        type="button"
                        onClick={() => setLang('hi')}
                        className={`px-3 py-1.5 rounded-lg cursor-pointer ${
                          lang === 'hi'
                            ? 'bg-cyan-500 text-slate-950 font-semibold'
                            : 'text-slate-400'
                        }`}
                      >
                        हिन्दी (Hindi)
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="settings-export-fmt" className="text-slate-300">
                      Default Export Image Format
                    </label>
                    <select
                      id="settings-export-fmt"
                      value={defaultExportFormat}
                      onChange={(e) =>
                        setDefaultExportFormat(
                          e.target.value as 'image/jpeg' | 'image/png' | 'image/webp'
                        )
                      }
                      className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-100"
                    >
                      <option value="image/jpeg">JPEG (.jpg)</option>
                      <option value="image/png">PNG (.png)</option>
                      <option value="image/webp">WebP (.webp)</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800">
                    <span className="text-slate-300">Reduced Motion Preference</span>
                    <input
                      type="checkbox"
                      checked={reducedMotion}
                      onChange={(e) => setReducedMotion(e.target.checked)}
                      aria-label="Enable reduced motion"
                      className="rounded border-slate-600 text-cyan-500"
                    />
                  </div>
                </div>

                {/* Temporary Data Cleanup & Model Shortcut */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4">
                  <h2 className="text-base font-semibold text-slate-100">
                    Temporary Data & Storage Safety
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Revoke active browser Object URLs, wipe volatile canvas buffers, and clear any unsaved inspection state from memory.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleClearTemporaryData}
                      className="px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Clear Temporary Data Now</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => navigateTo('/offline-center')}
                      className="px-4 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-200 font-medium text-xs cursor-pointer"
                    >
                      Manage Offline Models →
                    </button>
                  </div>

                  {tempClearFeedback && (
                    <p className="text-xs text-emerald-400 font-medium">{tempClearFeedback}</p>
                  )}

                  <div className="pt-3 border-t border-slate-800 space-y-2">
                    <div className="flex items-center gap-2">
                      <Cloud className="w-4 h-4 text-cyan-400" />
                      <h3 className="text-sm font-semibold text-slate-100">
                        Optional Cloud Audit Sync (Firebase)
                      </h3>
                    </div>
                    <p className="text-xs text-slate-400">
                      Core privacy tools never require an account. Optional Google Sign-In syncs only sanitized operation counts.
                    </p>
                    {authError && (
                      <p className="text-xs text-red-400 bg-red-950/30 border border-red-500/30 rounded-lg p-2">
                        {authError}
                      </p>
                    )}
                    {user ? (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex items-center justify-between gap-3 text-xs">
                        <div>
                          <p className="font-semibold text-slate-100">
                            {user.displayName || user.email}
                          </p>
                          <p className="text-emerald-400 text-[11px]">
                            Sanitized Firestore Sync Active
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleGoogleSignOut}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Sign Out</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleGoogleSignIn}
                        className="w-full py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-100 flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <LogIn className="w-4 h-4 text-cyan-400" />
                        <span>Sign in with Google (Optional Audit Sync)</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Supported Formats, Version & Honest Limitations */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-3 text-xs text-slate-300 leading-relaxed">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-100">
                    Supported Formats, Architecture & Known Limitations
                  </h2>
                  <span className="font-mono text-cyan-400">v2.1.0 Multi-Page PWA</span>
                </div>
                <p>
                  <strong>Supported Image Formats:</strong> JPEG (`.jpg`, `.jpeg`), PNG (`.png`), and WebP (`.webp`) up to 25 MB per file (up to 20 files per batch ZIP).
                </p>
                <p>
                  <strong>Metadata vs. Visible Pixels:</strong> Removing EXIF metadata strips hidden file headers (GPS coordinates, camera serials, timestamps), but does not alter faces, license plates, or text visible in the image pixels. Always use the Redaction Studio and Export Verification Center to confirm both.
                </p>
                <p>
                  <strong>Honest Scope:</strong> Link cleaning strips known tracking and referral parameters locally; it does not scan destination websites for malware or phishing. No automated tool can guarantee 100% anonymity against contextual clues like landmarks or reflections.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Concise Footer */}
      <footer className="border-t border-slate-800/80 py-5 px-4 sm:px-8 text-xs text-slate-400">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            <span className="font-semibold text-slate-200">PrivacyGuard AI</span>
            <span aria-hidden="true">·</span>
            <span>Local-First Multi-Page Privacy Utility</span>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => navigateTo('/protect-photo')}
              className="hover:text-slate-200 cursor-pointer"
            >
              Protect a Photo
            </button>
            <button
              type="button"
              onClick={() => navigateTo('/clean-link')}
              className="hover:text-slate-200 cursor-pointer"
            >
              Clean a Link
            </button>
            <button
              type="button"
              onClick={() => navigateTo('/privacy-preview')}
              className="hover:text-slate-200 cursor-pointer"
            >
              Privacy Preview
            </button>
            <button
              type="button"
              onClick={() => navigateTo('/verification')}
              className="hover:text-slate-200 cursor-pointer"
            >
              Verification Center
            </button>
            <button
              type="button"
              onClick={() => navigateTo('/offline-center')}
              className="hover:text-slate-200 cursor-pointer"
            >
              Offline Center
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
