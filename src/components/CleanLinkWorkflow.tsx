import React, { useState, useMemo, useEffect } from 'react';
import {
  Link2,
  ClipboardPaste,
  Copy,
  Check,
  RotateCcw,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  Share2,
  CheckCircle2,
  Sparkles,
  Info,
  Layers,
  RefreshCw,
} from 'lucide-react';
import {
  analyzeAndCleanUrl,
  cleanBulkUrls,
  UrlCleanResult,
} from '../utils/privacyEngine';

interface CleanLinkWorkflowProps {
  initialUrl?: string;
  onUrlCleaned?: (res: UrlCleanResult) => void;
  onRecordActivity: (entry: {
    actionType: 'link_clean';
    summary: string;
    riskLevel: 'Low' | 'Moderate' | 'High';
    itemsRemovedCount: number;
    verifiedLocal: boolean;
  }) => void;
}

const SAMPLE_URLS = [
  {
    label: 'Instagram / Social Share Link',
    url: 'https://www.instagram.com/reel/C8x9kLmN2pQ/?igsh=MzRlODBiNWFlZA==&utm_source=ig_web_copy_link',
  },
  {
    label: 'YouTube + Ad Click + Email Leak',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=45s&utm_source=newsletter&utm_medium=email&utm_campaign=fall_launch&fbclid=IwAR39xK8m2P0qL&si=9kLm2pQ8xR&user_email=aarav.sharma@example.org',
  },
  {
    label: 'Facebook Redirect + Amazon /ref=',
    url: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.amazon.in%2FSony-WH-1000XM5%2Fdp%2FB09XS7JWHH%2Fref%3Dsr_1_2%3Fqid%3D1729981234%26tag%3Daffiliatetracker-21%26k%3Dheadphones&h=AT29xLm',
  },
];

const SAMPLE_BULK_TEXT = `https://www.instagram.com/p/C9xLm2/?igsh=MzRlODBiNWFlZA==
https://www.tiktok.com/@creator/video/7291829102?_r=1&_t=8m9pQ&sec_uid=MS4wLjABAAAA&share_link_id=99182
https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=88219a8b7c6d4e&nd=1
https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Farticle%3Futm_source%3Dfb%26fbclid%3DIwAR123`;

export const CleanLinkWorkflow: React.FC<CleanLinkWorkflowProps> = ({
  initialUrl = '',
  onUrlCleaned,
  onRecordActivity,
}) => {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [urlInput, setUrlInput] = useState<string>(initialUrl);
  const [bulkInput, setBulkInput] = useState<string>(SAMPLE_BULK_TEXT);
  const [forcedRetained, setForcedRetained] = useState<Set<string>>(new Set());
  const [forcedRemoved, setForcedRemoved] = useState<Set<string>>(new Set());
  const [copiedClean, setCopiedClean] = useState<boolean>(false);
  const [copiedOriginal, setCopiedOriginal] = useState<boolean>(false);
  const [copiedBulk, setCopiedBulk] = useState<boolean>(false);

  // AI URL Intelligence state
  const [isAiAnalyzing, setIsAiAnalyzing] = useState<boolean>(false);
  const [aiIntel, setAiIntel] = useState<{
    engineUsed: string;
    ecosystemSummary: string;
    sharerFingerprintRisk: string;
    redirectBounceAnalysis: string;
    recommendation: string;
  } | null>(null);

  const analysis = useMemo(
    () => analyzeAndCleanUrl(urlInput, forcedRetained, forcedRemoved),
    [urlInput, forcedRetained, forcedRemoved]
  );

  const bulkAnalysis = useMemo(() => cleanBulkUrls(bulkInput), [bulkInput]);

  useEffect(() => {
    if (analysis.isValid && onUrlCleaned) {
      onUrlCleaned(analysis);
    }
  }, [analysis, onUrlCleaned]);

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrlInput(text);
        setForcedRetained(new Set());
        setForcedRemoved(new Set());
        setAiIntel(null);
      }
    } catch {
      // Clipboard API permission denied or unavailable; user can paste directly into input
    }
  };

  const handleToggleParameter = (key: string, currentAction: 'removed' | 'retained') => {
    const nextRetained = new Set(forcedRetained);
    const nextRemoved = new Set(forcedRemoved);

    if (currentAction === 'removed') {
      nextRemoved.delete(key);
      nextRetained.add(key);
    } else {
      nextRetained.delete(key);
      nextRemoved.add(key);
    }

    setForcedRetained(nextRetained);
    setForcedRemoved(nextRemoved);
  };

  const handleResetOverrides = () => {
    setForcedRetained(new Set());
    setForcedRemoved(new Set());
  };

  const handleCopyCleaned = async () => {
    if (!analysis.isValid || !analysis.cleanedUrl) return;
    try {
      await navigator.clipboard.writeText(analysis.cleanedUrl);
    } catch {
      // Fallback
    }
    setCopiedClean(true);
    setTimeout(() => setCopiedClean(false), 2000);

    onRecordActivity({
      actionType: 'link_clean',
      summary: `Cleaned URL (${analysis.hostname}): removed ${analysis.removedCount} tracker/sensitive parameter(s), retained ${analysis.retainedCount} parameter(s).`,
      riskLevel: analysis.riskReport.level,
      itemsRemovedCount: analysis.removedCount,
      verifiedLocal: true,
    });
  };

  const handleCopyOriginal = async () => {
    if (!analysis.originalUrl) return;
    try {
      await navigator.clipboard.writeText(analysis.originalUrl);
    } catch {
      // Fallback
    }
    setCopiedOriginal(true);
    setTimeout(() => setCopiedOriginal(false), 2000);
  };

  const handleCopyBulkCleaned = async () => {
    if (!bulkAnalysis.cleanedTextBlock) return;
    try {
      await navigator.clipboard.writeText(bulkAnalysis.cleanedTextBlock);
    } catch {
      // Fallback
    }
    setCopiedBulk(true);
    setTimeout(() => setCopiedBulk(false), 2000);

    onRecordActivity({
      actionType: 'link_clean',
      summary: `Bulk-cleaned ${bulkAnalysis.results.length} URL(s) and stripped ${bulkAnalysis.totalTrackersRemoved} total tracker(s).`,
      riskLevel: 'Moderate',
      itemsRemovedCount: bulkAnalysis.totalTrackersRemoved,
      verifiedLocal: true,
    });
  };

  const handleNativeShare = async () => {
    if (!analysis.isValid || !analysis.cleanedUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({
          url: analysis.cleanedUrl,
        });
      } catch {
        // User cancelled share sheet
      }
    }
  };

  const handleRunAiUrlIntelligence = async () => {
    if (!analysis.isValid) return;
    setIsAiAnalyzing(true);
    try {
      const response = await fetch('/api/gemini/url-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalUrl: analysis.originalUrl,
          cleanedUrl: analysis.cleanedUrl,
          removedParams: analysis.parameters
            .filter((p) => p.action === 'removed')
            .map((p) => ({ key: p.key, category: p.category })),
          hostname: analysis.hostname,
          unwrappedFromHost: analysis.unwrappedFromHost || '',
        }),
      });
      const data = await response.json();
      if (data && data.ecosystemSummary) {
        setAiIntel(data);
      }
    } catch {
      setAiIntel({
        engineUsed: 'local-clearurls-intelligence',
        ecosystemSummary: `Sanitized ${analysis.removedCount} tracking parameter(s) on ${analysis.hostname} using ClearURLs & Link Cleaner rules.`,
        sharerFingerprintRisk:
          'Social share tokens (igsh, si, fbclid, sec_uid) can link the sender account to the recipient.',
        redirectBounceAnalysis: analysis.unwrappedFromHost
          ? `Unwrapped intermediate redirect wrapper (${analysis.unwrappedFromHost}).`
          : 'No outer redirect bounce wrapper detected.',
        recommendation: 'Copy and share the sanitized URL above.',
      });
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-violet-400 font-medium">
            <ShieldCheck className="w-4 h-4" />
            <span>
              Processed on this device · ClearURLs + Link Cleaner Engine (65+ Rules + Redirect Unwrapper)
            </span>
          </div>
          <h2 className="text-2xl font-bold text-slate-100 mt-1">Clean a Link</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setMode('single')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                mode === 'single'
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              Single URL Inspector
            </button>
            <button
              type="button"
              onClick={() => setMode('bulk')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
                mode === 'bulk'
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Bulk Multi-Link Cleaner</span>
            </button>
          </div>
        </div>
      </div>

      {mode === 'bulk' ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-100">
                  Bulk Multi-Link Sanitizer (corbindavenport/link-cleaner & ClearURLs)
                </h3>
                <p className="text-xs text-slate-400">
                  Paste multiple links (one per line) to strip tracking parameters and unwrap redirect bounces across all of them simultaneously.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopyBulkCleaned}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                {copiedBulk ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>
                  {copiedBulk
                    ? 'Copied All Cleaned Links!'
                    : `Copy All ${bulkAnalysis.results.length} Cleaned Links (${bulkAnalysis.totalTrackersRemoved} Trackers Stripped)`}
                </span>
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="bulk-url-input" className="text-xs font-semibold text-slate-300">
                  Input Links (One per line)
                </label>
                <textarea
                  id="bulk-url-input"
                  rows={6}
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 focus:border-cyan-400 focus:outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-emerald-400 block">
                  Sanitized Output Links ({bulkAnalysis.totalTrackersRemoved} trackers removed)
                </span>
                <textarea
                  rows={6}
                  readOnly
                  value={bulkAnalysis.cleanedTextBlock}
                  aria-label="Sanitized output links"
                  className="w-full rounded-xl border border-emerald-500/30 bg-slate-950 p-3 font-mono text-xs text-emerald-300 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Sample Link Quick Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {SAMPLE_URLS.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => {
                  setUrlInput(s.url);
                  setForcedRetained(new Set());
                  setForcedRemoved(new Set());
                  setAiIntel(null);
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs text-slate-300 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                <span>Try: {s.label}</span>
              </button>
            ))}
          </div>

          {/* STEP 1: PASTE A URL */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="clean-url-input" className="text-sm font-semibold text-slate-100">
                Step 1: Paste or enter a link to inspect
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-cyan-300 cursor-pointer"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  <span>Paste</span>
                </button>
                {urlInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setUrlInput('');
                      setForcedRetained(new Set());
                      setForcedRemoved(new Set());
                      setAiIntel(null);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 cursor-pointer"
                    aria-label="Clear URL input"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    <span>Clear</span>
                  </button>
                )}
              </div>
            </div>

            <div className="relative">
              <input
                id="clean-url-input"
                type="text"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  setForcedRetained(new Set());
                  setForcedRemoved(new Set());
                  setAiIntel(null);
                }}
                placeholder="https://example.com/product?id=42&utm_source=instagram&fbclid=IwAR..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3.5 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <p className="mt-2.5 text-xs text-slate-400">
              Example: Paste any Instagram, YouTube, TikTok, Spotify, Amazon, or Facebook redirect link. PrivacyGuard parses and unwraps the URL strictly on your device.
            </p>
          </div>

          {/* Validation Error State */}
          {urlInput.trim() !== '' && !analysis.isValid && (
            <div
              role="alert"
              className="rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-sm text-red-200 flex items-start gap-3"
            >
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Unable to Parse URL</p>
                <p className="text-xs text-red-300 mt-0.5">{analysis.errorMessage}</p>
              </div>
            </div>
          )}

          {/* STEP 2, 3, 4: ANALYSIS, COMPARISON & COPY/SHARE */}
          {analysis.isValid && (
            <div className="space-y-6">
              {/* Unwrapped Redirect Banner (Link Cleaner / ClearURLs feature) */}
              {analysis.unwrappedFromHost && (
                <div className="rounded-2xl border border-cyan-500/40 bg-cyan-950/20 p-4 text-xs text-cyan-200 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>
                      <strong>Redirect Bounce Unwrapped:</strong> Extracted direct target URL from{' '}
                      <code className="font-mono text-cyan-300">{analysis.unwrappedFromHost}</code> and stripped inner trackers.
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-cyan-300 shrink-0">
                    {analysis.providerRuleMatched}
                  </span>
                </div>
              )}

              {/* Sensitive Warnings Banner */}
              {analysis.sensitiveWarnings.length > 0 && (
                <div className="rounded-2xl border border-rose-500/40 bg-rose-950/20 p-4 text-xs text-rose-200 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-sm text-rose-300">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Sensitive Personal Information Found in URL</span>
                  </div>
                  {analysis.sensitiveWarnings.map((w, idx) => (
                    <p key={idx} className="pl-6">
                      • {w}
                    </p>
                  ))}
                </div>
              )}

              {/* STEP 3: CLEAR COMPARISON & COPY/SHARE ACTIONS */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Cleaned URL Output Card */}
                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/15 p-6 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" />
                        Cleaned URL Ready to Share
                      </span>
                      <span className="text-xs font-mono text-slate-300 tabular-nums">
                        {analysis.removedCount} removed · {analysis.retainedCount} retained
                      </span>
                    </div>

                    <div
                      data-testid="cleaned-url-output"
                      className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-sm text-emerald-300 break-all select-all"
                    >
                      {analysis.cleanedUrl}
                    </div>

                    {analysis.providerRuleMatched && (
                      <p className="mt-2 text-[11px] font-mono text-cyan-300">
                        Active Rule Group: {analysis.providerRuleMatched}
                      </p>
                    )}

                    {analysis.removedCount === 0 && (
                      <p className="mt-2.5 text-xs text-emerald-300 flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        This link is already clean — no known tracking or sensitive parameters were found.
                      </p>
                    )}
                  </div>

                  {/* Step 4: Copy, Share & AI Explain Controls */}
                  <div className="flex flex-wrap items-center gap-2.5 pt-2">
                    <button
                      type="button"
                      onClick={handleCopyCleaned}
                      className="flex-1 min-w-[150px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
                    >
                      {copiedClean ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      <span>{copiedClean ? 'Copied Cleaned URL!' : 'Copy Cleaned URL'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleRunAiUrlIntelligence}
                      disabled={isAiAnalyzing}
                      className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-violet-500/40 bg-violet-500/15 hover:bg-violet-500/25 text-xs font-semibold text-violet-200 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isAiAnalyzing ? 'animate-spin' : ''}`} />
                      <span>{isAiAnalyzing ? 'Analyzing...' : 'AI Tracker Analysis'}</span>
                    </button>

                    {typeof navigator !== 'undefined' && 'share' in navigator && (
                      <button
                        type="button"
                        onClick={handleNativeShare}
                        className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 cursor-pointer"
                      >
                        <Share2 className="w-4 h-4" />
                        <span>Share</span>
                      </button>
                    )}

                    {(forcedRetained.size > 0 || forcedRemoved.size > 0) && (
                      <button
                        type="button"
                        onClick={handleResetOverrides}
                        className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Undo Overrides</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Original URL Comparison Card */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                        <Link2 className="w-4 h-4" />
                        Original URL (Before Cleaning)
                      </span>
                      <span className="text-xs font-mono text-amber-300">
                        Pre-Clean Risk: {analysis.riskReport.level} ({analysis.riskReport.totalPoints}/100)
                      </span>
                    </div>

                    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4 font-mono text-xs text-slate-400 break-all">
                      {analysis.originalUrl}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleCopyOriginal}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-300 cursor-pointer"
                    >
                      {copiedOriginal ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedOriginal ? 'Copied Original' : 'Copy Original URL'}</span>
                    </button>
                    <span className="text-[11px] text-slate-400">
                      Host: <strong className="text-slate-200 font-mono">{analysis.hostname}</strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* AI Tracker & Redirect Intelligence Output Card */}
              {aiIntel && (
                <div className="rounded-2xl border border-violet-500/40 bg-violet-950/15 p-5 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-violet-200 flex items-center gap-1.5 text-sm">
                      <Sparkles className="w-4 h-4 text-violet-400" />
                      <span>AI URL Tracker & Attribution Briefing</span>
                    </span>
                    <span className="font-mono text-[10px] text-violet-300">
                      {aiIntel.engineUsed}
                    </span>
                  </div>
                  <p className="text-slate-200">{aiIntel.ecosystemSummary}</p>
                  <p className="text-slate-300">
                    <strong className="text-violet-300">Social Attribution Risk:</strong>{' '}
                    {aiIntel.sharerFingerprintRisk}
                  </p>
                  <p className="text-slate-300">
                    <strong className="text-cyan-300">Redirect Bounce Check:</strong>{' '}
                    {aiIntel.redirectBounceAnalysis}
                  </p>
                </div>
              )}

              {/* STEP 2 DETAILS: PARAMETER-BY-PARAMETER BREAKDOWN & RESTORE TOGGLES */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-100">
                      Step 2: Parameter-by-Parameter Inspection ({analysis.parameters.length})
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Every removed and retained parameter is explained below. You can restore any stripped parameter or remove any retained one with one click.
                    </p>
                  </div>
                </div>

                {analysis.parameters.length === 0 ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-6 text-center text-xs text-slate-400">
                    This URL contains no query parameters (`?...`) or path trackers.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
                    {analysis.parameters.map((param, idx) => (
                      <div
                        key={`${param.key}-${idx}`}
                        className="p-4 bg-slate-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono font-semibold text-slate-100">
                              {param.key}
                            </span>
                            <span className="text-slate-500">=</span>
                            <span className="font-mono text-slate-300 break-all">
                              {param.maskedValue}
                            </span>
                            <span aria-hidden="true" className="text-slate-600">
                              ·
                            </span>
                            <span
                              className={`font-medium ${
                                param.action === 'removed' ? 'text-rose-400' : 'text-emerald-400'
                              }`}
                            >
                              {param.action === 'removed' ? 'Removed' : 'Retained'}
                            </span>
                            <span aria-hidden="true" className="text-slate-600">
                              ·
                            </span>
                            <span className="text-slate-400 capitalize">
                              {param.category.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400">{param.reason}</p>
                        </div>

                        {param.key !== '/ref=...' &&
                          !param.key.startsWith('Redirect Wrapper') && (
                            <button
                              type="button"
                              onClick={() => handleToggleParameter(param.key, param.action)}
                              className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              {param.action === 'removed'
                                ? 'Restore Parameter'
                                : 'Remove Parameter'}
                            </button>
                          )}
                      </div>
                    ))}
                  </div>
                )}

                <p className="mt-4 text-xs text-slate-400">
                  Honest Scope: Link cleaning strips known tracking and referral parameters locally; it does not check destination websites for malware or phishing.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
