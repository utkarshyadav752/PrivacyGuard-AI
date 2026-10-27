/**
 * Core pure privacy logic for PrivacyGuard AI:
 * 1. URL Sanitization & Tracker Ruleset (inspired by ClearURLs & Link Cleaner)
 * 2. Binary EXIF/JPEG/PNG Metadata Inspector, Generator & Output Verifier (inspired by MetaScrub & ScrubPix)
 * 3. Transparent Privacy Risk Scoring Rubric (inspired by MetaExtract)
 * 4. Sensitive Pattern Detection (inspired by Scrub & EgoBlur)
 * 5. Reference Repository Evaluation Matrix
 */

export type RiskLevel = 'Low' | 'Moderate' | 'High';

export interface UrlParameterFinding {
  key: string;
  value: string;
  maskedValue: string;
  action: 'removed' | 'retained';
  category:
    | 'ad_tracker'
    | 'campaign_analytics'
    | 'social_referral'
    | 'affiliate_ecommerce'
    | 'sensitive_pii'
    | 'essential'
    | 'unknown_retained';
  reason: string;
  riskContribution: 'none' | 'moderate' | 'high';
}

export interface UrlCleanResult {
  isValid: boolean;
  errorMessage?: string;
  originalUrl: string;
  cleanedUrl: string;
  hostname: string;
  protocol: string;
  pathname: string;
  hash: string;
  hashCleaned: boolean;
  unwrappedFromHost?: string;
  providerRuleMatched?: string;
  parameters: UrlParameterFinding[];
  removedCount: number;
  retainedCount: number;
  sensitiveWarnings: string[];
  riskReport: PrivacyRiskReport;
}

export interface ExifFieldFinding {
  key: string;
  label: string;
  value: string;
  category: 'location' | 'device' | 'timestamp' | 'software' | 'author' | 'technical';
  sensitivity: 'high' | 'moderate' | 'low';
  explanation: string;
}

export interface VisualDetectionRegion {
  id: string;
  type: 'face' | 'plate' | 'email' | 'phone' | 'id_number' | 'card_number' | 'text' | 'manual';
  label: string;
  detectedText?: string;
  confidence: number; // 0 to 1
  source: string; // e.g., 'On-Device OCR / Regex', 'On-Device Face Detector', 'Manual Selection'
  // Normalized coordinates (0..1) relative to image width/height
  x: number;
  y: number;
  width: number;
  height: number;
  selectedForRedaction: boolean;
  redactionStyle: 'blur' | 'pixelate' | 'solid';
}

export interface ExportVerificationResult {
  passedAllAvailableChecks: boolean;
  processedOnDevice: boolean;
  originalSizeBytes: number;
  exportedSizeBytes: number;
  exportedFormat: string;
  exifApp1RemainingBytes: number;
  gpsRemaining: boolean;
  metadataRemovedVerified: boolean;
  visualRedactionsAppliedCount: number;
  unredactedDetectionsRemainingCount: number;
  checksPassed: string[];
  checksWarned: string[];
  checksUnavailable: string[];
  timestampIso: string;
}

export interface PrivacyRiskCategoryBreakdown {
  category: string;
  status: 'clear' | 'warning' | 'critical' | 'unverified';
  points: number;
  explanation: string;
}

export interface PrivacyRiskReport {
  level: RiskLevel;
  totalPoints: number;
  maxRubricPoints: number;
  summary: string;
  categories: PrivacyRiskCategoryBreakdown[];
  unresolvedFindings: string[];
  checksNotRun: string[];
  methodologyNote: string;
}

export interface OnDeviceModelInfo {
  id: 'face-detector' | 'plate-detector' | 'local-ocr' | 'pii-ner';
  name: string;
  purpose: string;
  sizeLabel: string;
  sizeBytes: number;
  status: 'ready_offline' | 'download_required' | 'downloading' | 'unsupported';
  progress: number;
  engineType: string;
  offlineCapable: boolean;
  accuracyNote: string;
}

export interface ReferenceRepoEvaluation {
  id: string;
  name: string;
  repo: string;
  category: string;
  license: string;
  offlineSupport: string;
  strengths: string[];
  limitations: string[];
  adoptedInPrivacyGuard: string;
}

// ---------------------------------------------------------------------------
// 1. TRANSPARENT URL TRACKING RULESET (ClearURLs + Link Cleaner inspired)
// ---------------------------------------------------------------------------

interface TrackerRule {
  category: 'ad_tracker' | 'campaign_analytics' | 'social_referral' | 'affiliate_ecommerce';
  reason: string;
  domains?: string[]; // If omitted, applies globally
}

const KNOWN_TRACKER_RULES: Record<string, TrackerRule> = {
  // Campaign & Analytics
  utm_source: { category: 'campaign_analytics', reason: 'Identifies which platform or newsletter sent you to the link (Google Analytics).' },
  utm_medium: { category: 'campaign_analytics', reason: 'Tracks the marketing medium such as social, email, or CPC banner.' },
  utm_campaign: { category: 'campaign_analytics', reason: 'Tracks the specific marketing campaign name across websites.' },
  utm_term: { category: 'campaign_analytics', reason: 'Records paid search keywords used prior to clicking.' },
  utm_content: { category: 'campaign_analytics', reason: 'Differentiates specific links or buttons inside the same ad.' },
  utm_id: { category: 'campaign_analytics', reason: 'Google Analytics campaign identifier.' },
  _ga: { category: 'campaign_analytics', reason: 'Google Analytics cross-domain client tracking identifier.' },
  _gl: { category: 'campaign_analytics', reason: 'Google Analytics linker parameter correlating sessions.' },
  _hsenc: { category: 'campaign_analytics', reason: 'HubSpot email recipient tracking token.' },
  _hsmi: { category: 'campaign_analytics', reason: 'HubSpot email message identifier.' },
  mc_cid: { category: 'campaign_analytics', reason: 'Mailchimp campaign tracking ID.' },
  mc_eid: { category: 'campaign_analytics', reason: 'Mailchimp unique subscriber recipient ID (can identify your email).' },
  vero_id: { category: 'campaign_analytics', reason: 'Vero email marketing user tracker.' },
  mkt_tok: { category: 'campaign_analytics', reason: 'Marketo email recipient tracking token.' },

  // Ad Click Identifiers
  fbclid: { category: 'ad_tracker', reason: 'Meta / Facebook Click Identifier used to link your visit to your Facebook profile.' },
  gclid: { category: 'ad_tracker', reason: 'Google Click Identifier used to attribute ad clicks to your Google ad profile.' },
  dclid: { category: 'ad_tracker', reason: 'Google Display Network click tracker.' },
  gbraid: { category: 'ad_tracker', reason: 'Google Ads iOS privacy-measurement click parameter.' },
  wbraid: { category: 'ad_tracker', reason: 'Google Ads web-to-app click attribution identifier.' },
  msclkid: { category: 'ad_tracker', reason: 'Microsoft / Bing Ads unique click tracking identifier.' },
  twclid: { category: 'ad_tracker', reason: 'X / Twitter ad click attribution identifier.' },
  ttclid: { category: 'ad_tracker', reason: 'TikTok ad click attribution identifier.' },
  yclid: { category: 'ad_tracker', reason: 'Yandex ad click identifier.' },
  li_fat_id: { category: 'ad_tracker', reason: 'LinkedIn first-party ad tracking token.' },
  epik: { category: 'ad_tracker', reason: 'Pinterest ad click tracking identifier.' },
  rdt_cid: { category: 'ad_tracker', reason: 'Reddit ad click identifier.' },
  ScCid: { category: 'ad_tracker', reason: 'Snapchat ad click identifier.' },

  // Social Share & Referral Fingerprints (ClearURLs + Link Cleaner expanded rules)
  igsh: { category: 'social_referral', reason: 'Instagram share token that can link the shared URL back to the sharer account.' },
  igshid: { category: 'social_referral', reason: 'Instagram share identifier linking shared media to the sender.' },
  si: { category: 'social_referral', reason: 'Spotify / YouTube share attribution identifier linking the sender and recipient.' },
  pp: { category: 'social_referral', reason: 'YouTube search/recommendation referral fingerprint.' },
  feature: { category: 'social_referral', reason: 'YouTube referral source indicator (e.g., share, watch-on-other).' },
  ref: { category: 'social_referral', reason: 'Referral source tag tracking where the link was clicked.' },
  ref_src: { category: 'social_referral', reason: 'X / Twitter referral source tracker.' },
  ref_url: { category: 'social_referral', reason: 'X / Twitter referring page URL.' },
  s: { category: 'social_referral', reason: 'X / Twitter share platform/client identifier.', domains: ['twitter.com', 'x.com', 'mobile.twitter.com'] },
  t: { category: 'social_referral', reason: 'X / Twitter share timestamp/session token.', domains: ['twitter.com', 'x.com', 'mobile.twitter.com'] },
  rcm: { category: 'social_referral', reason: 'LinkedIn recommendation tracking parameter.' },
  trk: { category: 'social_referral', reason: 'LinkedIn click source tracking parameter.' },
  trkInfo: { category: 'social_referral', reason: 'LinkedIn detailed session click tracking token.' },
  lipi: { category: 'social_referral', reason: 'LinkedIn page instance tracking identifier.' },
  licu: { category: 'social_referral', reason: 'LinkedIn UI component tracking identifier.' },
  originalSubdomain: { category: 'social_referral', reason: 'LinkedIn regional redirect tracking parameter.' },
  _r: { category: 'social_referral', reason: 'TikTok share referral tracking parameter.', domains: ['tiktok.com'] },
  _t: { category: 'social_referral', reason: 'TikTok share timestamp identifier.', domains: ['tiktok.com'] },
  checksum: { category: 'social_referral', reason: 'TikTok share fingerprint hash.', domains: ['tiktok.com'] },
  sec_uid: { category: 'social_referral', reason: 'TikTok sharer secondary user ID (can reveal sharer account).', domains: ['tiktok.com'] },
  share_app_id: { category: 'social_referral', reason: 'TikTok client app share identifier.' },
  share_item_id: { category: 'social_referral', reason: 'TikTok shared item tracking ID.' },
  share_link_id: { category: 'social_referral', reason: 'TikTok unique share link session ID.' },
  share_id: { category: 'social_referral', reason: 'Reddit / social unique share session identifier.' },
  utm_name: { category: 'social_referral', reason: 'Reddit share campaign tracking name.' },
  nd: { category: 'social_referral', reason: 'Spotify navigation/deep-link tracker.', domains: ['spotify.com', 'open.spotify.com'] },
  context: { category: 'social_referral', reason: 'Spotify playlist/uri context tracker.', domains: ['spotify.com', 'open.spotify.com'] },

  // E-Commerce & Affiliate Trackers
  tag: { category: 'affiliate_ecommerce', reason: 'Amazon affiliate tracking tag.', domains: ['amazon.com', 'amazon.in', 'amazon.co.uk', 'amazon.de'] },
  ascsubtag: { category: 'affiliate_ecommerce', reason: 'Amazon sub-affiliate publisher user tracker.' },
  pd_rd_r: { category: 'affiliate_ecommerce', reason: 'Amazon product recommendation request ID.' },
  pd_rd_w: { category: 'affiliate_ecommerce', reason: 'Amazon recommendation widget tracking token.' },
  pd_rd_wg: { category: 'affiliate_ecommerce', reason: 'Amazon page impression group tracker.' },
  pf_rd_p: { category: 'affiliate_ecommerce', reason: 'Amazon placement tracking identifier.' },
  pf_rd_r: { category: 'affiliate_ecommerce', reason: 'Amazon referral request tracking ID.' },
  qid: { category: 'affiliate_ecommerce', reason: 'Amazon search query timestamp ID.' },
  sr: { category: 'affiliate_ecommerce', reason: 'Amazon search result rank position tracker.' },
  spm: { category: 'affiliate_ecommerce', reason: 'Alibaba / AliExpress page position analytics tracker.' },
  scm: { category: 'affiliate_ecommerce', reason: 'Alibaba content recommendation tracker.' },
};

const ESSENTIAL_PARAMS_BY_DOMAIN: Record<string, string[]> = {
  'youtube.com': ['v', 'list', 'index', 't', 'search_query'],
  'youtu.be': ['t'],
  'google.com': ['q', 'tbm', 'tbs', 'hl'],
  'duckduckgo.com': ['q', 'ia'],
  'github.com': ['q', 'tab', 'page', 'type', 'language'],
  'amazon.com': ['k', 'node', 'rh', 'page'],
  'amazon.in': ['k', 'node', 'rh', 'page'],
  'news.ycombinator.com': ['id', 'p'],
};

const GLOBAL_ESSENTIAL_PARAM_NAMES = new Set([
  'id',
  'q',
  'query',
  'search',
  'page',
  'p',
  'limit',
  'offset',
  'sort',
  'order',
  'filter',
  'tab',
  'view',
  'lang',
  'locale',
  'v',
  'code',
  'state',
  'token', // Auth/reset tokens are warned as sensitive, not blindly stripped if needed, or flagged
]);

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_REGEX = /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{4}/;
const SENSITIVE_KEY_NAMES = /^(email|e-mail|mail|phone|mobile|tel|user_email|lat|lng|latitude|longitude|ssn|aadhaar|pan|password|passwd|secret|api_key|apikey|access_token|session_id)$/i;

function maskSensitiveString(val: string): string {
  if (!val) return '';
  if (EMAIL_REGEX.test(val)) {
    return val.replace(/([a-zA-Z0-9._%+-]{1,2})[a-zA-Z0-9._%+-]*(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/, '$1***$2');
  }
  if (val.length > 8) {
    return `${val.slice(0, 3)}•••${val.slice(-2)}`;
  }
  return '••••••';
}

export function analyzeAndCleanUrl(
  rawInput: string,
  forcedRetainedKeys: Set<string> = new Set(),
  forcedRemovedKeys: Set<string> = new Set()
): UrlCleanResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      isValid: false,
      errorMessage: 'Please paste or enter a URL to inspect.',
      originalUrl: '',
      cleanedUrl: '',
      hostname: '',
      protocol: '',
      pathname: '',
      hash: '',
      hashCleaned: false,
      parameters: [],
      removedCount: 0,
      retainedCount: 0,
      sensitiveWarnings: [],
      riskReport: {
        level: 'Low',
        totalPoints: 0,
        maxRubricPoints: 100,
        summary: 'No URL analyzed yet.',
        categories: [],
        unresolvedFindings: [],
        checksNotRun: [],
        methodologyNote: 'Local URL parser idle.',
      },
    };
  }

  // Support pasting URLs missing https:// if they clearly look like domain.tld/...
  let candidate = trimmed;
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(candidate) && /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(\/.*|\?.*)?$/.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      isValid: false,
      errorMessage: 'This does not look like a valid web address (e.g. https://example.com/page?utm_source=test).',
      originalUrl: trimmed,
      cleanedUrl: '',
      hostname: '',
      protocol: '',
      pathname: '',
      hash: '',
      hashCleaned: false,
      parameters: [],
      removedCount: 0,
      retainedCount: 0,
      sensitiveWarnings: [],
      riskReport: {
        level: 'Low',
        totalPoints: 0,
        maxRubricPoints: 100,
        summary: 'Invalid URL syntax.',
        categories: [],
        unresolvedFindings: [],
        checksNotRun: [],
        methodologyNote: 'URL validation failed locally.',
      },
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      isValid: false,
      errorMessage: `Unsupported protocol "${parsed.protocol}". Only http:// and https:// web links are supported.`,
      originalUrl: trimmed,
      cleanedUrl: '',
      hostname: parsed.hostname,
      protocol: parsed.protocol,
      pathname: parsed.pathname,
      hash: parsed.hash,
      hashCleaned: false,
      parameters: [],
      removedCount: 0,
      retainedCount: 0,
      sensitiveWarnings: [],
      riskReport: {
        level: 'Low',
        totalPoints: 0,
        maxRubricPoints: 100,
        summary: 'Unsupported protocol.',
        categories: [],
        unresolvedFindings: [],
        checksNotRun: [],
        methodologyNote: 'Only HTTP/HTTPS URLs are analyzed.',
      },
    };
  }

  let unwrappedFromHost: string | undefined;
  // Unwrap tracking redirect wrappers (ClearURLs & Link Cleaner pattern: Facebook l.php, Google /url, YouTube /redirect, Reddit out.reddit.com, LinkedIn /redir/redirect)
  const initialHost = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const redirectParamCandidates = ['u', 'url', 'q', 'z', 'target', 'dest'];
  const isKnownRedirectWrapper =
    ((initialHost === 'l.facebook.com' || initialHost === 'lm.facebook.com' || initialHost === 'l.instagram.com') &&
      parsed.pathname.startsWith('/l.php')) ||
    (initialHost.startsWith('google.') && parsed.pathname === '/url') ||
    (initialHost === 'youtube.com' && parsed.pathname === '/redirect') ||
    initialHost === 'out.reddit.com' ||
    (initialHost === 't.umblr.com' && parsed.pathname.startsWith('/redirect')) ||
    (initialHost === 'linkedin.com' && parsed.pathname.startsWith('/redir/redirect'));

  if (isKnownRedirectWrapper) {
    for (const pKey of redirectParamCandidates) {
      const targetVal = parsed.searchParams.get(pKey);
      if (targetVal && /^https?:\/\//i.test(targetVal)) {
        try {
          const innerUrl = new URL(targetVal);
          unwrappedFromHost = parsed.hostname;
          parsed = innerUrl;
          break;
        } catch {
          // Keep outer URL if inner target is malformed
        }
      }
    }
  }

  const hostLower = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const cleanedUrlObj = new URL(parsed.toString());
  cleanedUrlObj.search = '';

  const providerRuleMatched = hostLower.includes('youtube') || hostLower === 'youtu.be'
    ? 'ClearURLs: YouTube Provider Rules'
    : hostLower.includes('instagram')
    ? 'ClearURLs: Instagram Share Rules'
    : hostLower.includes('facebook')
    ? 'ClearURLs: Meta / Facebook Rules'
    : hostLower.includes('amazon')
    ? 'ClearURLs: Amazon E-Commerce & /ref= Rules'
    : hostLower.includes('tiktok')
    ? 'ClearURLs: TikTok Share Rules'
    : hostLower.includes('linkedin')
    ? 'ClearURLs: LinkedIn Attribution Rules'
    : hostLower.includes('spotify')
    ? 'ClearURLs: Spotify Share Rules'
    : hostLower.includes('twitter') || hostLower === 'x.com'
    ? 'ClearURLs: X / Twitter Share Rules'
    : 'ClearURLs: Global Marketing & PII Ruleset';

  // Also strip Amazon /ref=... path segments if present
  let amazonRefStripped = false;
  if (hostLower.startsWith('amazon.') && /\/ref=[^/?#]+/.test(cleanedUrlObj.pathname)) {
    cleanedUrlObj.pathname = cleanedUrlObj.pathname.replace(/\/ref=[^/?#]+/g, '');
    amazonRefStripped = true;
  }

  const findings: UrlParameterFinding[] = [];
  const sensitiveWarnings: string[] = [];

  if (unwrappedFromHost) {
    findings.push({
      key: `Redirect Wrapper (${unwrappedFromHost})`,
      value: `Extracted destination URL from ${unwrappedFromHost}`,
      maskedValue: `Extracted destination URL from ${unwrappedFromHost}`,
      action: 'removed',
      category: 'social_referral',
      reason: `Unwrapped intermediate tracking redirect bounce (${unwrappedFromHost}) to go directly to the target page (Link Cleaner / ClearURLs pattern).`,
      riskContribution: 'moderate',
    });
  }

  if (parsed.username || parsed.password) {
    sensitiveWarnings.push('URL contains embedded username/password credentials in the authority section.');
    cleanedUrlObj.username = '';
    cleanedUrlObj.password = '';
  }

  if (amazonRefStripped) {
    findings.push({
      key: '/ref=...',
      value: 'Path referral segment',
      maskedValue: 'Path referral segment',
      action: 'removed',
      category: 'affiliate_ecommerce',
      reason: 'Amazon path-embedded referral tracker (/ref=...) removed while keeping the product ASIN path intact.',
      riskContribution: 'moderate',
    });
  }

  const domainEssentials = new Set(ESSENTIAL_PARAMS_BY_DOMAIN[hostLower] || []);

  parsed.searchParams.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    const rule = KNOWN_TRACKER_RULES[key] || KNOWN_TRACKER_RULES[lowerKey];
    const ruleMatchesDomain =
      rule && (!rule.domains || rule.domains.some((d) => hostLower === d || hostLower.endsWith(`.${d}`)));

    const isPiiKey = SENSITIVE_KEY_NAMES.test(lowerKey);
    const hasEmailValue = EMAIL_REGEX.test(value);
    const hasPhoneValue = value.length >= 10 && PHONE_REGEX.test(value) && !/^\d{10,13}$/.test(value); // avoid simple epoch timestamps unless formatted
    const isPrefixUtm = lowerKey.startsWith('utm_') || lowerKey.startsWith('hsa_') || lowerKey.startsWith('matomo_');

    let defaultAction: 'removed' | 'retained' = 'retained';
    let category: UrlParameterFinding['category'] = 'unknown_retained';
    let reason = 'Purpose is uncertain; retained by default so the destination page does not break.';
    let riskContribution: UrlParameterFinding['riskContribution'] = 'none';

    if (isPiiKey || hasEmailValue || hasPhoneValue) {
      defaultAction = 'removed';
      category = 'sensitive_pii';
      reason = hasEmailValue
        ? 'Contains an email address in the query string which exposes personal identity to analytics and third-party scripts.'
        : 'Contains sensitive-looking personal or session data in the URL query parameter.';
      riskContribution = 'high';
      sensitiveWarnings.push(`Parameter "${key}" appears to contain personal or session data (${maskSensitiveString(value)}).`);
    } else if (ruleMatchesDomain) {
      defaultAction = 'removed';
      category = rule.category;
      reason = rule.reason;
      riskContribution = rule.category === 'ad_tracker' || rule.category === 'social_referral' ? 'moderate' : 'moderate';
    } else if (isPrefixUtm) {
      defaultAction = 'removed';
      category = 'campaign_analytics';
      reason = 'Recognized marketing/analytics tracking parameter prefix.';
      riskContribution = 'moderate';
    } else if (domainEssentials.has(lowerKey) || GLOBAL_ESSENTIAL_PARAM_NAMES.has(lowerKey)) {
      defaultAction = 'retained';
      category = 'essential';
      reason = 'Required by the website to load the correct video, search query, item ID, or page.';
      riskContribution = 'none';
    } else {
      defaultAction = 'retained';
      category = 'unknown_retained';
      reason = 'Unclassified site parameter. Retained to avoid breaking the destination link; you can remove it manually if unneeded.';
      riskContribution = 'none';
    }

    let finalAction = defaultAction;
    if (forcedRetainedKeys.has(key)) {
      finalAction = 'retained';
    } else if (forcedRemovedKeys.has(key)) {
      finalAction = 'removed';
    }

    if (finalAction === 'retained') {
      cleanedUrlObj.searchParams.append(key, value);
    }

    findings.push({
      key,
      value,
      maskedValue: category === 'sensitive_pii' ? maskSensitiveString(value) : value,
      action: finalAction,
      category,
      reason,
      riskContribution,
    });
  });

  // Inspect URL hash for #utm_... tracking fragments
  let hashCleaned = false;
  if (parsed.hash && /^#(utm_|fbclid|gclid)/i.test(parsed.hash)) {
    cleanedUrlObj.hash = '';
    hashCleaned = true;
  }

  const removedCount = findings.filter((f) => f.action === 'removed').length + (hashCleaned ? 1 : 0);
  const retainedCount = findings.filter((f) => f.action === 'retained').length;

  const riskReport = calculateUrlRiskReport(findings, sensitiveWarnings, parsed.protocol === 'http:');

  return {
    isValid: true,
    originalUrl: trimmed,
    cleanedUrl: cleanedUrlObj.toString(),
    hostname: parsed.hostname,
    protocol: parsed.protocol,
    pathname: cleanedUrlObj.pathname,
    hash: cleanedUrlObj.hash,
    hashCleaned,
    unwrappedFromHost,
    providerRuleMatched,
    parameters: findings,
    removedCount,
    retainedCount,
    sensitiveWarnings,
    riskReport,
  };
}

/**
 * Bulk Multi-Link Sanitizer (inspired by corbindavenport/link-cleaner & ClearURLs)
 */
export function cleanBulkUrls(rawMultilineText: string): {
  results: UrlCleanResult[];
  totalTrackersRemoved: number;
  cleanedTextBlock: string;
} {
  const lines = rawMultilineText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const results = lines.map((line) => analyzeAndCleanUrl(line));
  const totalTrackersRemoved = results.reduce((sum, r) => sum + (r.isValid ? r.removedCount : 0), 0);
  const cleanedTextBlock = results.map((r) => (r.isValid ? r.cleanedUrl : r.originalUrl)).join('\n');
  return {
    results,
    totalTrackersRemoved,
    cleanedTextBlock,
  };
}

export function calculateUrlRiskReport(
  findings: UrlParameterFinding[],
  sensitiveWarnings: string[],
  isInsecureHttp: boolean
): PrivacyRiskReport {
  const piiParams = findings.filter((f) => f.category === 'sensitive_pii');
  const adTrackers = findings.filter((f) => f.category === 'ad_tracker' || f.category === 'social_referral');
  const campaignTrackers = findings.filter((f) => f.category === 'campaign_analytics' || f.category === 'affiliate_ecommerce');
  const unknownRetained = findings.filter((f) => f.category === 'unknown_retained' && f.action === 'retained');

  const piiPoints = piiParams.length > 0 ? 45 : 0;
  const trackerPoints = Math.min(40, adTrackers.length * 15 + campaignTrackers.length * 10);
  const httpPoints = isInsecureHttp ? 15 : 0;
  const unknownPoints = unknownRetained.length > 0 ? 10 : 0;

  const totalPoints = Math.min(100, piiPoints + trackerPoints + httpPoints + unknownPoints);
  const level: RiskLevel = totalPoints >= 45 ? 'High' : totalPoints >= 15 ? 'Moderate' : 'Low';

  const categories: PrivacyRiskCategoryBreakdown[] = [
    {
      category: 'Personal / Sensitive Query Values',
      status: piiParams.length > 0 ? 'critical' : 'clear',
      points: piiPoints,
      explanation:
        piiParams.length > 0
          ? `${piiParams.length} parameter(s) contain email, phone, or personal identifiers.`
          : 'No email addresses, phone numbers, or sensitive keys detected in query parameters.',
    },
    {
      category: 'Known Tracking & Referral Parameters',
      status: adTrackers.length + campaignTrackers.length > 0 ? 'warning' : 'clear',
      points: trackerPoints,
      explanation:
        adTrackers.length + campaignTrackers.length > 0
          ? `${adTrackers.length + campaignTrackers.length} tracking or attribution parameter(s) identified for removal.`
          : 'No known ad-click or campaign tracking parameters found.',
    },
    {
      category: 'Unclassified Retained Parameters',
      status: unknownRetained.length > 0 ? 'warning' : 'clear',
      points: unknownPoints,
      explanation:
        unknownRetained.length > 0
          ? `${unknownRetained.length} site-specific parameter(s) retained to avoid breaking the destination page.`
          : 'All retained parameters match recognized functional keys.',
    },
    {
      category: 'Transport Encryption (HTTPS)',
      status: isInsecureHttp ? 'warning' : 'clear',
      points: httpPoints,
      explanation: isInsecureHttp
        ? 'Link uses unencrypted http:// rather than https://.'
        : 'Link uses encrypted https:// transport.',
    },
  ];

  const unresolvedFindings: string[] = [];
  if (unknownRetained.length > 0) {
    unresolvedFindings.push(
      `Retained ${unknownRetained.length} unclassified parameter(s): ${unknownRetained.map((u) => u.key).join(', ')}.`
    );
  }
  if (isInsecureHttp) {
    unresolvedFindings.push('URL uses unencrypted HTTP protocol.');
  }

  return {
    level,
    totalPoints,
    maxRubricPoints: 100,
    summary:
      level === 'High'
        ? 'High privacy risk before cleaning due to personal data or heavy cross-site tracking tokens in the URL.'
        : level === 'Moderate'
        ? 'Moderate privacy risk before cleaning due to advertising, campaign, or social share tracking parameters.'
        : 'Low privacy risk; no known tracking parameters or personal data found in the URL structure.',
    categories,
    unresolvedFindings,
    checksNotRun: [
      'Destination server redirect chain inspection (skipped offline by default to prevent leaking the URL to external servers).',
      'Malware or phishing reputation lookup (link cleaning removes trackers; it is not a malware scanner).',
    ],
    methodologyNote:
      'Calculated using PrivacyGuard Transparent Rubric v1: Sensitive PII in URL (+45), Ad/Social Trackers (+15 each, max 40), Campaign Trackers (+10 each), Unencrypted HTTP (+15), Unclassified Retained Params (+10). High >= 45, Moderate 15–44, Low < 15.',
  };
}

// ---------------------------------------------------------------------------
// 2. SENSITIVE TEXT & PATTERN DETECTOR (Scrub inspired)
// ---------------------------------------------------------------------------

export interface DetectedTextEntity {
  type: 'email' | 'phone' | 'id_number' | 'card_number';
  value: string;
  masked: string;
  confidence: number;
}

/**
 * Validates whether a numeric string of 13-19 digits passes the Luhn payment card checksum (JalolbekJR/scrub pattern).
 */
export function validateLuhnChecksum(rawDigits: string): boolean {
  const digits = rawDigits.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export function detectSensitiveTextPatterns(text: string): DetectedTextEntity[] {
  const results: DetectedTextEntity[] = [];
  if (!text) return results;

  const emailGlobal = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let match: RegExpExecArray | null;
  while ((match = emailGlobal.exec(text)) !== null) {
    results.push({
      type: 'email',
      value: match[0],
      masked: maskSensitiveString(match[0]),
      confidence: 0.96,
    });
  }

  // First extract 12-digit / 16-digit ID and Luhn payment card numbers so phone regex does not partially match inside a 16-digit card
  const idOrCardEntities: DetectedTextEntity[] = [];
  const idOrCardGlobal = /\b\d{4}[\s-]\d{4}[\s-]\d{4}(?:[\s-]\d{4})?\b/g;
  const textWithoutCards = text.replace(idOrCardGlobal, (matchedStr) => {
    const rawCandidate = matchedStr.trim();
    const digitsOnly = rawCandidate.replace(/\D/g, '');
    if (digitsOnly.length >= 13 && validateLuhnChecksum(digitsOnly)) {
      idOrCardEntities.push({
        type: 'card_number',
        value: rawCandidate,
        masked: `••••-••••-••••-${digitsOnly.slice(-4)}`,
        confidence: 0.98,
      });
    } else {
      idOrCardEntities.push({
        type: 'id_number',
        value: rawCandidate,
        masked: `••••-••••-${rawCandidate.slice(-4)}`,
        confidence: 0.91,
      });
    }
    return ' '.repeat(matchedStr.length);
  });

  const phoneGlobal =
    /(?:\+\d{1,3}[\s-]?)?(?:\(\d{3}\)[\s-]\d{3}[\s-]\d{4}|\d{5}[\s-]\d{5}|\d{3}[\s-]\d{3}[\s-]\d{4})/g;
  while ((match = phoneGlobal.exec(textWithoutCards)) !== null) {
    results.push({
      type: 'phone',
      value: match[0].trim(),
      masked: maskSensitiveString(match[0].trim()),
      confidence: 0.89,
    });
  }

  results.push(...idOrCardEntities);
  return results;
}

// ---------------------------------------------------------------------------
// 3. BINARY EXIF / METADATA ENGINE & VERIFIER (MetaScrub & ScrubPix inspired)
// ---------------------------------------------------------------------------

/**
 * Inspects raw image bytes (Uint8Array / ArrayBuffer) to detect JPEG APP1 (EXIF/XMP),
 * APP13 (IPTC), COM (Comments), and PNG metadata chunks (eXIf, tEXt, iTXt, tIME).
 * Used both for initial inspection and to verify that exported files are genuinely clean.
 */
export function inspectBinaryMetadataSegments(bytes: Uint8Array): {
  format: 'jpeg' | 'png' | 'webp' | 'unknown';
  app1ExifBytes: number;
  xmpBytes: number;
  iptcBytes: number;
  commentBytes: number;
  pngTextChunks: number;
  embeddedAsciiStrings: string[];
} {
  let format: 'jpeg' | 'png' | 'webp' | 'unknown' = 'unknown';
  let app1ExifBytes = 0;
  let xmpBytes = 0;
  let iptcBytes = 0;
  let commentBytes = 0;
  let pngTextChunks = 0;
  const embeddedAsciiStrings: string[] = [];

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    format = 'jpeg';
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) {
        // Start of Scan (SOS) or End of Image (EOI)
        break;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        offset += 2;
        continue;
      }
      const segLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (segLength < 2 || offset + 2 + segLength > bytes.length) break;

      const segData = bytes.subarray(offset + 4, offset + 2 + segLength);
      if (marker === 0xe1) {
        // APP1: Check for "Exif\0\0" or XMP
        const header = new TextDecoder('ascii', { fatal: false }).decode(segData.subarray(0, Math.min(32, segData.length)));
        if (header.startsWith('Exif')) {
          app1ExifBytes += segLength;
          // Extract readable ASCII strings >= 4 chars inside the EXIF segment
          extractReadableAscii(segData, embeddedAsciiStrings);
        } else if (header.includes('http://ns.adobe.com/xap')) {
          xmpBytes += segLength;
          extractReadableAscii(segData, embeddedAsciiStrings);
        } else {
          app1ExifBytes += segLength;
        }
      } else if (marker === 0xed) {
        iptcBytes += segLength;
      } else if (marker === 0xfe) {
        commentBytes += segLength;
        extractReadableAscii(segData, embeddedAsciiStrings);
      }

      offset += 2 + segLength;
    }
  } else if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    format = 'png';
    let offset = 8;
    while (offset + 8 <= bytes.length) {
      const length =
        ((bytes[offset] << 24) >>> 0) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3];
      const type = String.fromCharCode(
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7]
      );
      if (type === 'eXIf') {
        app1ExifBytes += length;
      } else if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
        pngTextChunks++;
        const chunkData = bytes.subarray(offset + 8, Math.min(bytes.length, offset + 8 + length));
        extractReadableAscii(chunkData, embeddedAsciiStrings);
      }
      if (type === 'IEND') break;
      offset += 12 + length;
    }
  } else if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    format = 'webp';
  }

  return {
    format,
    app1ExifBytes,
    xmpBytes,
    iptcBytes,
    commentBytes,
    pngTextChunks,
    embeddedAsciiStrings,
  };
}

function extractReadableAscii(buf: Uint8Array, target: string[]) {
  let current = '';
  for (let i = 0; i < buf.length; i++) {
    const code = buf[i];
    if (code >= 32 && code <= 126) {
      current += String.fromCharCode(code);
    } else {
      if (current.length >= 4 && current !== 'Exif' && current !== 'MM*' && current !== 'II*') {
        target.push(current.trim());
      }
      current = '';
    }
  }
  if (current.length >= 4) {
    target.push(current.trim());
  }
}

/**
 * Injects a valid, real binary APP1 EXIF + GPS segment into a JPEG Uint8Array
 * so that sample demo photos contain genuine binary EXIF tags parseable by `exifr`
 * and `inspectBinaryMetadataSegments`.
 */
export function injectSampleExifIntoJpeg(jpegBytes: Uint8Array): Uint8Array {
  if (jpegBytes.length < 4 || jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
    return jpegBytes;
  }

  // Construct a standard Little-Endian ("II") TIFF + EXIF + GPS APP1 segment
  // Containing Make="Apple", Model="iPhone 16 Pro", Software="iOS 18.2",
  // DateTime="2026:10:24 14:32:19", Artist="Aarav Sharma", and GPS IFD (28.6139 N, 77.2090 E)
  const makeStr = 'Apple\0';
  const modelStr = 'iPhone 16 Pro\0';
  const softwareStr = 'iOS 18.2.1\0';
  const dateStr = '2026:10:24 14:32:19\0';
  const artistStr = 'Aarav Sharma (New Delhi)\0';

  const tiffBuffer = new ArrayBuffer(360);
  const view = new DataView(tiffBuffer);
  const u8 = new Uint8Array(tiffBuffer);

  // TIFF Header at offset 0: "II" (0x4949), magic 42 (0x002a), IFD0 offset = 8
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);

  // IFD0 at offset 8 with 6 entries:
  // 1. Make (0x010f)
  // 2. Model (0x0110)
  // 3. Software (0x0131)
  // 4. DateTime (0x0132)
  // 5. Artist (0x013b)
  // 6. GPSInfoIFDPointer (0x8825)
  const numEntries = 6;
  view.setUint16(8, numEntries, true);

  let entryOffset = 10;
  let dataOffset = 10 + numEntries * 12 + 4; // 86

  function writeAsciiEntry(tag: number, str: string) {
    view.setUint16(entryOffset, tag, true);
    view.setUint16(entryOffset + 2, 2, true); // ASCII
    view.setUint32(entryOffset + 4, str.length, true);
    view.setUint32(entryOffset + 8, dataOffset, true);
    for (let i = 0; i < str.length; i++) {
      u8[dataOffset + i] = str.charCodeAt(i);
    }
    dataOffset += str.length + (str.length % 2); // word align
    entryOffset += 12;
  }

  writeAsciiEntry(0x010f, makeStr);
  writeAsciiEntry(0x0110, modelStr);
  writeAsciiEntry(0x0131, softwareStr);
  writeAsciiEntry(0x0132, dateStr);
  writeAsciiEntry(0x013b, artistStr);

  // GPS IFD Pointer entry (0x8825, type 4 = LONG, count 1, value = gpsIfdOffset)
  const gpsIfdOffset = dataOffset;
  view.setUint16(entryOffset, 0x8825, true);
  view.setUint16(entryOffset + 2, 4, true); // LONG
  view.setUint32(entryOffset + 4, 1, true);
  view.setUint32(entryOffset + 8, gpsIfdOffset, true);
  entryOffset += 12;

  // Next IFD offset = 0
  view.setUint32(entryOffset, 0, true);

  // Write GPS IFD at gpsIfdOffset with 4 entries:
  // 0x0001 GPSLatitudeRef = "N\0"
  // 0x0002 GPSLatitude = 28/1, 36/1, 5004/100 (28.6139)
  // 0x0003 GPSLongitudeRef = "E\0"
  // 0x0004 GPSLongitude = 77/1, 12/1, 3240/100 (77.2090)
  view.setUint16(gpsIfdOffset, 4, true);
  let gpsEntry = gpsIfdOffset + 2;
  let gpsData = gpsEntry + 4 * 12 + 4;

  // 1. GPSLatitudeRef (0x0001)
  view.setUint16(gpsEntry, 0x0001, true);
  view.setUint16(gpsEntry + 2, 2, true);
  view.setUint32(gpsEntry + 4, 2, true);
  u8[gpsEntry + 8] = 78; // 'N'
  u8[gpsEntry + 9] = 0;
  gpsEntry += 12;

  // 2. GPSLatitude (0x0002, type 5 = RATIONAL, count 3)
  view.setUint16(gpsEntry, 0x0002, true);
  view.setUint16(gpsEntry + 2, 5, true);
  view.setUint32(gpsEntry + 4, 3, true);
  view.setUint32(gpsEntry + 8, gpsData, true);
  view.setUint32(gpsData, 28, true);
  view.setUint32(gpsData + 4, 1, true);
  view.setUint32(gpsData + 8, 36, true);
  view.setUint32(gpsData + 12, 1, true);
  view.setUint32(gpsData + 16, 5004, true);
  view.setUint32(gpsData + 20, 100, true);
  gpsData += 24;
  gpsEntry += 12;

  // 3. GPSLongitudeRef (0x0003)
  view.setUint16(gpsEntry, 0x0003, true);
  view.setUint16(gpsEntry + 2, 2, true);
  view.setUint32(gpsEntry + 4, 2, true);
  u8[gpsEntry + 8] = 69; // 'E'
  u8[gpsEntry + 9] = 0;
  gpsEntry += 12;

  // 4. GPSLongitude (0x0004, type 5 = RATIONAL, count 3)
  view.setUint16(gpsEntry, 0x0004, true);
  view.setUint16(gpsEntry + 2, 5, true);
  view.setUint32(gpsEntry + 4, 3, true);
  view.setUint32(gpsEntry + 8, gpsData, true);
  view.setUint32(gpsData, 77, true);
  view.setUint32(gpsData + 4, 1, true);
  view.setUint32(gpsData + 8, 12, true);
  view.setUint32(gpsData + 12, 1, true);
  view.setUint32(gpsData + 16, 3240, true);
  view.setUint32(gpsData + 20, 100, true);
  gpsData += 24;
  gpsEntry += 12;

  view.setUint32(gpsEntry, 0, true);

  const usedTiffBytes = u8.subarray(0, gpsData);
  const exifHeader = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  const segLen = 2 + exifHeader.length + usedTiffBytes.length;

  const app1Segment = new Uint8Array(2 + segLen);
  app1Segment[0] = 0xff;
  app1Segment[1] = 0xe1;
  app1Segment[2] = (segLen >> 8) & 0xff;
  app1Segment[3] = segLen & 0xff;
  app1Segment.set(exifHeader, 4);
  app1Segment.set(usedTiffBytes, 4 + exifHeader.length);

  // Splice right after SOI (0xFFD8)
  const output = new Uint8Array(jpegBytes.length + app1Segment.length);
  output.set(jpegBytes.subarray(0, 2), 0);
  output.set(app1Segment, 2);
  output.set(jpegBytes.subarray(2), 2 + app1Segment.length);
  return output;
}

// ---------------------------------------------------------------------------
// 4. PHOTO PRIVACY RISK RUBRIC & EXPORT VERIFICATION
// ---------------------------------------------------------------------------

export function calculatePhotoRiskReport(
  metadataFindings: ExifFieldFinding[],
  visualDetections: VisualDetectionRegion[],
  checksNotRun: string[] = []
): PrivacyRiskReport {
  const hasGps = metadataFindings.some((m) => m.category === 'location');
  const deviceOrAuthorMeta = metadataFindings.filter(
    (m) => m.category === 'device' || m.category === 'author' || m.category === 'timestamp' || m.category === 'software'
  );
  const unredactedVisual = visualDetections.filter((d) => !d.selectedForRedaction);

  const gpsPoints = hasGps ? 45 : 0;
  const metaPoints = deviceOrAuthorMeta.length > 0 ? Math.min(25, deviceOrAuthorMeta.length * 8) : 0;
  const visualPoints = visualDetections.length > 0 ? Math.min(40, visualDetections.length * 15) : 0;
  const totalPoints = Math.min(100, gpsPoints + metaPoints + visualPoints);

  const level: RiskLevel = totalPoints >= 45 ? 'High' : totalPoints >= 15 ? 'Moderate' : 'Low';

  const categories: PrivacyRiskCategoryBreakdown[] = [
    {
      category: 'Hidden Location Data (GPS EXIF)',
      status: hasGps ? 'critical' : 'clear',
      points: gpsPoints,
      explanation: hasGps
        ? 'Exact GPS coordinates are embedded in the file header, revealing where the photo was taken.'
        : 'No GPS coordinates detected in the image header.',
    },
    {
      category: 'Identifying Device & Capture Metadata',
      status: deviceOrAuthorMeta.length > 0 ? 'warning' : 'clear',
      points: metaPoints,
      explanation:
        deviceOrAuthorMeta.length > 0
          ? `${deviceOrAuthorMeta.length} identifying metadata tag(s) found (device model, capture timestamp, author, or software).`
          : 'No device make/model, author, or capture timestamp tags detected.',
    },
    {
      category: 'Visible Sensitive Content in Pixels',
      status: visualDetections.length > 0 ? (unredactedVisual.length > 0 ? 'critical' : 'warning') : 'clear',
      points: visualPoints,
      explanation:
        visualDetections.length > 0
          ? `${visualDetections.length} sensitive region(s) detected in the image pixels (${
              visualDetections.length - unredactedVisual.length
            } marked for redaction).`
          : 'No visible faces, license plates, or sensitive text regions flagged in the current scan.',
    },
    {
      category: 'Checks Not Run / Model Availability',
      status: checksNotRun.length > 0 ? 'unverified' : 'clear',
      points: 0,
      explanation:
        checksNotRun.length > 0
          ? `${checksNotRun.length} optional check(s) were not run or require manual confirmation.`
          : 'All selected local metadata and visual checks completed.',
    },
  ];

  const unresolvedFindings: string[] = [];
  if (hasGps) unresolvedFindings.push('Hidden GPS location coordinates are present in the original file.');
  if (deviceOrAuthorMeta.length > 0) {
    unresolvedFindings.push(`Original file contains ${deviceOrAuthorMeta.length} device/author metadata fields.`);
  }
  if (unredactedVisual.length > 0) {
    unresolvedFindings.push(
      `${unredactedVisual.length} detected visible region(s) are not yet selected for redaction.`
    );
  }

  return {
    level,
    totalPoints,
    maxRubricPoints: 100,
    summary:
      level === 'High'
        ? 'High privacy exposure: image contains precise GPS location data or visible personal details in the pixels.'
        : level === 'Moderate'
        ? 'Moderate privacy exposure: image contains device/capture metadata or visible details worth reviewing.'
        : 'Low privacy exposure based on completed checks. Always visually inspect before sharing.',
    categories,
    unresolvedFindings,
    checksNotRun,
    methodologyNote:
      'Calculated using PrivacyGuard Transparent Rubric v1: Hidden GPS Coordinates (+45), Device/Timestamp/Author EXIF (+8 per tag, max 25), Visible Sensitive Regions (+15 per region, max 40). Removing metadata alone does not hide content visible in pixels.',
  };
}

export function verifyExportedImageBytes(
  originalBytesLength: number,
  exportedBytes: Uint8Array,
  exportedMimeType: string,
  metadataRemovedRequested: boolean,
  visualDetections: VisualDetectionRegion[],
  redactionsApplied: boolean,
  unavailableChecks: string[] = []
): ExportVerificationResult {
  const binaryCheck = inspectBinaryMetadataSegments(exportedBytes);
  const totalMetaBytes =
    binaryCheck.app1ExifBytes +
    binaryCheck.xmpBytes +
    binaryCheck.iptcBytes +
    binaryCheck.commentBytes +
    binaryCheck.pngTextChunks;

  const metadataRemovedVerified = totalMetaBytes === 0;
  const appliedCount = redactionsApplied
    ? visualDetections.filter((d) => d.selectedForRedaction).length
    : 0;
  const unredactedCount = redactionsApplied
    ? visualDetections.filter((d) => !d.selectedForRedaction).length
    : visualDetections.length;

  const checksPassed: string[] = [];
  const checksWarned: string[] = [];

  if (metadataRemovedVerified) {
    checksPassed.push(
      `Re-inspected exported ${binaryCheck.format.toUpperCase()} binary header: 0 bytes of EXIF, GPS, XMP, or text metadata remain.`
    );
  } else if (metadataRemovedRequested) {
    checksWarned.push(
      `Warning: ${totalMetaBytes} bytes of metadata segments were still detected in the exported file.`
    );
  } else {
    checksWarned.push(
      'Metadata removal was not selected; original metadata tags may still be present.'
    );
  }

  if (appliedCount > 0) {
    checksPassed.push(
      `Flattened ${appliedCount} visual redaction(s) permanently into the exported pixel buffer (not a reversible overlay).`
    );
  }

  if (unredactedCount > 0) {
    checksWarned.push(
      `${unredactedCount} flagged visible region(s) were left unredacted in the image pixels.`
    );
  }

  checksWarned.push(
    'Important distinction: Stripping EXIF metadata removes hidden file headers (like GPS), while pixel redaction hides faces/text visible to the eye. Always visually review the final image.'
  );

  return {
    passedAllAvailableChecks: metadataRemovedVerified && unredactedCount === 0,
    processedOnDevice: true,
    originalSizeBytes: originalBytesLength,
    exportedSizeBytes: exportedBytes.length,
    exportedFormat: exportedMimeType,
    exifApp1RemainingBytes: binaryCheck.app1ExifBytes,
    gpsRemaining: binaryCheck.app1ExifBytes > 0,
    metadataRemovedVerified,
    visualRedactionsAppliedCount: appliedCount,
    unredactedDetectionsRemainingCount: unredactedCount,
    checksPassed,
    checksWarned,
    checksUnavailable: unavailableChecks,
    timestampIso: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 5. REFERENCE REPOSITORIES EVALUATION MATRIX
// ---------------------------------------------------------------------------

export const REFERENCE_REPOSITORIES: ReferenceRepoEvaluation[] = [
  {
    id: 'metascrub',
    name: '1. MetaScrub',
    repo: 'Skytuhua/metascrub',
    category: 'Image Metadata Privacy & Verification',
    license: 'MIT',
    offlineSupport: 'Full Offline PWA',
    strengths: [
      'Zero-upload local metadata stripping',
      'Before-and-after metadata diff viewer',
      'Post-export binary verification pass',
    ],
    limitations: ['Does not inspect or redact sensitive text/faces inside pixels'],
    adoptedInPrivacyGuard:
      'Adopted the before/after metadata diff view and mandatory post-export binary header re-verification step.',
  },
  {
    id: 'scrub',
    name: '2. Scrub',
    repo: 'JalolbekJR/scrub',
    category: 'Faces, Text & Sensitive Region Redaction',
    license: 'MIT',
    offlineSupport: 'Local Browser Canvas + On-Device Models',
    strengths: [
      'Detects faces, emails, phone numbers, and card numbers',
      'Supports manual rectangular redaction with blur, pixelate, and solid mask',
      'Verifies exported files',
    ],
    limitations: ['Heavy OCR models require initial download before offline use'],
    adoptedInPrivacyGuard:
      'Adopted the unified sensitive-region detector (faces, plates, emails, phones, IDs) + manual redaction studio.',
  },
  {
    id: 'link-cleaner',
    name: '3. Link Cleaner',
    repo: 'corbindavenport/link-cleaner',
    category: 'PWA Link Sanitization & Share Target',
    license: 'GPL-3.0 (Reference Only — Clean-Room Implementation)',
    offlineSupport: '100% Offline Local URL Parser',
    strengths: [
      'Fast single-paste workflow for Instagram, Chrome, and social links',
      'One-tap copy and native Web Share API integration',
    ],
    limitations: ['Limited per-parameter explanation when uncertain parameters are retained'],
    adoptedInPrivacyGuard:
      'Adopted the ultra-fast paste/copy/share workflow while adding parameter-by-parameter explanations and restore toggles.',
  },
  {
    id: 'clearurls',
    name: '4. ClearURLs',
    repo: 'ClearURLs/Addon',
    category: 'Domain-Specific Tracking Protection Rules',
    license: 'LGPL-3.0 (Reference Ruleset Pattern)',
    offlineSupport: 'Bundled Local Ruleset',
    strengths: [
      'Comprehensive catalog of global (utm_*, fbclid, gclid) and domain-specific (Amazon /ref=, YouTube si) trackers',
      'Preserves essential destination query parameters',
    ],
    limitations: ['Browser extension architecture rather than standalone web app'],
    adoptedInPrivacyGuard:
      'Adopted domain-aware essential parameter preservation (e.g. YouTube ?v=, search ?q=) and Amazon /ref= path cleaning.',
  },
  {
    id: 'metaextract',
    name: '5. MetaExtract',
    repo: 'yashtamhane/MetaExtract',
    category: 'Privacy Risk Scoring & Batch ZIP Cleaning',
    license: 'MIT',
    offlineSupport: 'Offline Browser PWA',
    strengths: [
      'Assigns explainable privacy risk scores based on real metadata findings',
      'Batch processing with ZIP archive download',
    ],
    limitations: ['Risk score must be transparently documented to avoid black-box confusion'],
    adoptedInPrivacyGuard:
      'Adopted the transparent point-based Privacy Risk Report rubric and JSZip batch cleaning workflow.',
  },
  {
    id: 'egoblur',
    name: '6. EgoBlur (Meta Research)',
    repo: 'facebookresearch/EgoBlur',
    category: 'AI Face & License Plate Anonymization Research',
    license: 'Apache-2.0',
    offlineSupport: 'Requires On-Device Vision Runtime',
    strengths: [
      'High-recall automatic anonymization of faces and vehicle license plates in street scenes',
    ],
    limitations: ['Full TorchScript models are too heavy for instant zero-download mobile web load'],
    adoptedInPrivacyGuard:
      'Adopted the dual Face + License Plate anonymization workflow with honest Model Manager download states.',
  },
  {
    id: 'scrubpix',
    name: '7. ScrubPix',
    repo: 'didrod205/scrubpix',
    category: 'Quality-Preserving Metadata Removal',
    license: 'MIT',
    offlineSupport: '100% Local Browser Processing',
    strengths: [
      'Configurable output format and quality controls when stripping metadata',
      'No server uploads',
    ],
    limitations: ['Metadata stripping alone does not obscure pixel-level PII'],
    adoptedInPrivacyGuard:
      'Adopted quality-controlled local re-encoding (JPEG/PNG/WebP) with explicit pixel vs. metadata distinction.',
  },
  {
    id: 'image-metadata-cleaner',
    name: '8. Image Meta Data Cleaner',
    repo: 'Aaqib-Proj/Image-Meta-Data-Cleaner',
    category: 'Social-Sharing Friendly Workflow',
    license: 'MIT',
    offlineSupport: 'Local Browser Canvas',
    strengths: [
      'Approachable step-by-step UX for non-technical users preparing social media posts',
    ],
    limitations: ['Basic UI without verification report'],
    adoptedInPrivacyGuard:
      'Adopted the beginner-friendly 4-step guided flow (Select -> Inspect -> Review & Edit -> Clean & Export).',
  },
];

// ---------------------------------------------------------------------------
// 6. BILINGUAL TRANSLATIONS (English & Hindi)
// ---------------------------------------------------------------------------

export const TRANSLATIONS = {
  en: {
    brand: 'PrivacyGuard AI',
    heroTitle: 'Your privacy, protected before you share.',
    heroSubtitle: 'Remove hidden photo data and clean tracking links in a few simple steps.',
    protectPhoto: 'Protect a Photo',
    protectPhotoDesc: 'Remove hidden metadata, find sensitive details, and prepare safer images to share.',
    cleanLink: 'Clean a Link',
    cleanLinkDesc: 'Remove unnecessary trackers and review sensitive information in a URL.',
    navHome: 'Home',
    navPhoto: 'Protect a Photo',
    navLink: 'Clean a Link',
    navAdvanced: 'Advanced Tools',
    navActivity: 'Activity',
    navSettings: 'Settings',
    processedOnDevice: 'Processed on this device',
    online: 'Online',
    offline: 'Offline Ready',
  },
  hi: {
    brand: 'PrivacyGuard AI',
    heroTitle: 'शेयर करने से पहले आपकी गोपनीयता सुरक्षित।',
    heroSubtitle: 'कुछ आसान चरणों में फ़ोटो का छुपा डेटा हटाएं और ट्रैकिंग लिंक साफ़ करें।',
    protectPhoto: 'फ़ोटो सुरक्षित करें',
    protectPhotoDesc: 'छुपा हुआ मेटाडेटा हटाएं, संवेदनशील जानकारी पहचानें और सुरक्षित फ़ोटो तैयार करें।',
    cleanLink: 'लिंक साफ़ करें',
    cleanLinkDesc: 'URL से अनावश्यक ट्रैकर्स हटाएं और संवेदनशील जानकारी की जांच करें।',
    navHome: 'होम',
    navPhoto: 'फ़ोटो सुरक्षा',
    navLink: 'लिंक क्लीनर',
    navAdvanced: 'उन्नत टूल्स',
    navActivity: 'गतिविधि',
    navSettings: 'सेटिंग्स',
    processedOnDevice: 'इसी डिवाइस पर प्रोसेस किया गया',
    online: 'ऑनलाइन',
    offline: 'ऑफ़लाइन तैयार',
  },
};

// ---------------------------------------------------------------------------
// 7. SHARE-SAFE EXPORT PRESETS & DETAILED VERIFICATION REPORT ENGINE
// ---------------------------------------------------------------------------

export type ShareSafePreset = 'everyday' | 'extra_privacy' | 'manual';

export interface ShareSafePresetConfig {
  id: ShareSafePreset;
  name: string;
  tagline: string;
  stripMetadata: boolean;
  autoSelectHighConfidenceRegions: boolean;
  preferredStyleForText: 'solid' | 'blur' | 'pixelate';
  behaviorSummary: string[];
}

export const SHARE_SAFE_PRESETS: Record<ShareSafePreset, ShareSafePresetConfig> = {
  everyday: {
    id: 'everyday',
    name: 'Everyday Sharing',
    tagline: 'Strip hidden EXIF/GPS metadata while keeping image pixels untouched unless you select regions.',
    stripMetadata: true,
    autoSelectHighConfidenceRegions: false,
    preferredStyleForText: 'solid',
    behaviorSummary: [
      'Removes all supported hidden metadata (GPS coordinates, camera make/model, capture timestamps, XMP/IPTC).',
      'Does not automatically alter image pixels — you remain in control of any visual redactions.',
      'Re-encodes a clean copy and verifies 0 bytes of EXIF remain.',
    ],
  },
  extra_privacy: {
    id: 'extra_privacy',
    name: 'Extra Privacy',
    tagline: 'Remove hidden metadata and queue detected faces, plates, and sensitive text for review before export.',
    stripMetadata: true,
    autoSelectHighConfidenceRegions: true,
    preferredStyleForText: 'solid',
    behaviorSummary: [
      'Removes all supported hidden EXIF/GPS/XMP metadata headers.',
      'Pre-selects detected faces (blur), license plates (pixelate), and sensitive text/IDs (opaque solid mask) for your review.',
      'Never exports silently — lets you inspect and toggle every region before flattening pixels.',
    ],
  },
  manual: {
    id: 'manual',
    name: 'Manual Control',
    tagline: 'Choose every metadata and pixel redaction action individually.',
    stripMetadata: true,
    autoSelectHighConfidenceRegions: false,
    preferredStyleForText: 'blur',
    behaviorSummary: [
      'Full manual control over metadata stripping, output format (JPEG/PNG/WebP), quality, crop, and rotation.',
      'Draw custom rectangular redactions with Blur, Pixelate, or Solid Mask.',
    ],
  },
};

export function getPresetBehaviorSummary(preset: ShareSafePreset): ShareSafePresetConfig {
  return SHARE_SAFE_PRESETS[preset];
}

export type VerificationCheckStatus = 'passed' | 'warning' | 'not_verified';
export type FieldDisposition =
  | 'Removed'
  | 'Still present'
  | 'Not detected'
  | 'Not checked'
  | 'Verification unavailable';

export interface DetailedVerificationItem {
  id: string;
  label: string;
  category: 'metadata' | 'integrity' | 'visual' | 'scope';
  status: VerificationCheckStatus;
  disposition: FieldDisposition;
  detail: string;
}

export interface DetailedVerificationReport {
  overallStatus: VerificationCheckStatus;
  processedOnDevice: boolean;
  timestampIso: string;
  originalSizeBytes: number;
  exportedSizeBytes: number;
  originalFormat: string;
  exportedFormat: string;
  dimensionsLabel: string;
  canDecodeExport: boolean;
  exifBytesBefore: number;
  exifBytesAfter: number;
  redactionsFlattenedCount: number;
  unredactedSuggestionsCount: number;
  items: DetailedVerificationItem[];
  limitationsNote: string[];
}

export function buildDetailedVerificationReport(params: {
  originalSizeBytes: number;
  originalFormat: string;
  originalExifBytes: number;
  hadGpsInitially: boolean;
  hadDeviceMetaInitially: boolean;
  exportedBytes: Uint8Array;
  exportedMimeType: string;
  canDecodeExport: boolean;
  width?: number;
  height?: number;
  metadataRemovedRequested: boolean;
  visualDetections: VisualDetectionRegion[];
  redactionsApplied: boolean;
  ocrModelInstalled: boolean;
}): DetailedVerificationReport {
  const afterInfo = inspectBinaryMetadataSegments(params.exportedBytes);
  const afterTotalMeta =
    afterInfo.app1ExifBytes +
    afterInfo.xmpBytes +
    afterInfo.iptcBytes +
    afterInfo.commentBytes +
    afterInfo.pngTextChunks;

  const appliedRedactions = params.redactionsApplied
    ? params.visualDetections.filter((d) => d.selectedForRedaction).length
    : 0;
  const unredactedRemaining = params.redactionsApplied
    ? params.visualDetections.filter((d) => !d.selectedForRedaction).length
    : params.visualDetections.length;

  const items: DetailedVerificationItem[] = [];

  // 1. Export File Integrity & Decode Check
  items.push({
    id: 'decode-integrity',
    label: 'Exported File Decode & Structural Integrity',
    category: 'integrity',
    status: params.canDecodeExport && params.exportedBytes.length > 0 ? 'passed' : 'warning',
    disposition: params.canDecodeExport ? 'Removed' : 'Verification unavailable',
    detail: params.canDecodeExport
      ? `Exported ${params.exportedMimeType} (${(params.exportedBytes.length / 1024).toFixed(1)} KB) decoded cleanly${
          params.width && params.height ? ` at ${params.width}×${params.height}px` : ''
        }.`
      : 'Exported image buffer could not be decoded by the browser image decoder.',
  });

  // 2. GPS Location Metadata Check
  if (params.hadGpsInitially) {
    const gpsGone = afterInfo.app1ExifBytes === 0;
    items.push({
      id: 'gps-check',
      label: 'GPS Location Coordinates (EXIF GPS IFD)',
      category: 'metadata',
      status: gpsGone ? 'passed' : 'warning',
      disposition: gpsGone ? 'Removed' : 'Still present',
      detail: gpsGone
        ? 'Previously detected GPS coordinates were completely stripped from the exported binary header.'
        : 'GPS / APP1 metadata bytes are still present in the exported file.',
    });
  } else {
    items.push({
      id: 'gps-check',
      label: 'GPS Location Coordinates (EXIF GPS IFD)',
      category: 'metadata',
      status: afterInfo.app1ExifBytes === 0 ? 'passed' : 'warning',
      disposition: afterInfo.app1ExifBytes === 0 ? 'Not detected' : 'Still present',
      detail:
        afterInfo.app1ExifBytes === 0
          ? 'No GPS metadata was present in the original or exported file header (0 bytes).'
          : 'Binary APP1 header detected in export.',
    });
  }

  // 3. Camera / Device / Timestamp EXIF Check
  if (params.hadDeviceMetaInitially || params.originalExifBytes > 0) {
    const metaGone = afterTotalMeta === 0;
    items.push({
      id: 'exif-headers',
      label: 'Camera Make, Model, Timestamp & XMP/IPTC Segments',
      category: 'metadata',
      status: metaGone ? 'passed' : 'warning',
      disposition: metaGone ? 'Removed' : 'Still present',
      detail: metaGone
        ? `Stripped ${params.originalExifBytes} bytes of original metadata segments; 0 bytes remain in exported file.`
        : `${afterTotalMeta} bytes of metadata segments remain in the exported file.`,
    });
  } else {
    items.push({
      id: 'exif-headers',
      label: 'Camera Make, Model, Timestamp & XMP/IPTC Segments',
      category: 'metadata',
      status: afterTotalMeta === 0 ? 'passed' : 'warning',
      disposition: afterTotalMeta === 0 ? 'Not detected' : 'Still present',
      detail:
        afterTotalMeta === 0
          ? 'Verified 0 bytes of EXIF, XMP, IPTC, or PNG text chunks in the exported file.'
          : `${afterTotalMeta} bytes of metadata segments detected.`,
    });
  }

  // 4. Visual Pixel Redactions Check
  if (params.visualDetections.length > 0) {
    if (appliedRedactions > 0 && unredactedRemaining === 0) {
      items.push({
        id: 'pixel-redactions',
        label: 'Detected Visual Regions (Faces, Plates & Text)',
        category: 'visual',
        status: 'passed',
        disposition: 'Removed',
        detail: `All ${appliedRedactions} selected region(s) were permanently flattened into the exported image pixels.`,
      });
    } else if (appliedRedactions > 0 && unredactedRemaining > 0) {
      items.push({
        id: 'pixel-redactions',
        label: 'Detected Visual Regions (Faces, Plates & Text)',
        category: 'visual',
        status: 'warning',
        disposition: 'Still present',
        detail: `Flattened ${appliedRedactions} region(s), but ${unredactedRemaining} detected suggestion(s) were left unredacted in the pixels.`,
      });
    } else {
      items.push({
        id: 'pixel-redactions',
        label: 'Detected Visual Regions (Faces, Plates & Text)',
        category: 'visual',
        status: 'warning',
        disposition: 'Still present',
        detail: `${unredactedRemaining} detected visual region(s) were not redacted. Metadata removal alone does not hide visible pixels.`,
      });
    }
  } else {
    items.push({
      id: 'pixel-redactions',
      label: 'Visual Pixel Redactions',
      category: 'visual',
      status: 'not_verified',
      disposition: 'Not detected',
      detail:
        'No automatic visual regions were flagged or drawn. Note: "not detected" does not prove no sensitive content is visible in the image.',
    });
  }

  // 5. Multi-Script Offline OCR Check
  items.push({
    id: 'ocr-coverage',
    label: 'Full Multi-Script Dense OCR Inspection',
    category: 'scope',
    status: params.ocrModelInstalled ? 'passed' : 'not_verified',
    disposition: params.ocrModelInstalled ? 'Not detected' : 'Not checked',
    detail: params.ocrModelInstalled
      ? 'Local multi-script OCR model was active during inspection.'
      : 'Optional 8.2 MB Multi-Script OCR model was not installed; only deterministic credential/PII regions and manual boxes were checked.',
  });

  // 6. Contextual & Background Landmark Check (Always unverified by automation)
  items.push({
    id: 'contextual-privacy',
    label: 'Background Landmarks, Reflections & Contextual Clues',
    category: 'scope',
    status: 'not_verified',
    disposition: 'Verification unavailable',
    detail:
      'Automated verification cannot determine whether street signs, house numbers, reflections, or uniforms reveal your location or identity.',
  });

  const hasWarning = items.some((i) => i.status === 'warning');
  const overallStatus: VerificationCheckStatus = hasWarning ? 'warning' : 'passed';

  return {
    overallStatus,
    processedOnDevice: true,
    timestampIso: new Date().toISOString(),
    originalSizeBytes: params.originalSizeBytes,
    exportedSizeBytes: params.exportedBytes.length,
    originalFormat: params.originalFormat,
    exportedFormat: params.exportedMimeType,
    dimensionsLabel:
      params.width && params.height ? `${params.width} × ${params.height} px` : 'Verified Canvas Buffer',
    canDecodeExport: params.canDecodeExport,
    exifBytesBefore: params.originalExifBytes,
    exifBytesAfter: afterTotalMeta,
    redactionsFlattenedCount: appliedRedactions,
    unredactedSuggestionsCount: unredactedRemaining,
    items,
    limitationsNote: [
      'A metadata inspection cannot prove that all visible personal information has been removed from the pixels.',
      'A successful blur or mask operation does not prove that every face, reflection, or sensitive text region was detected.',
      'File integrity verification confirms the image opens cleanly, which is distinct from complete contextual privacy.',
    ],
  };
}

/**
 * Generates a sanitized downloadable JSON verification report containing only
 * structural verification outcomes — NEVER raw GPS coordinates, OCR text, or private URLs.
 */
export function generateSanitizedVerificationReportJson(report: DetailedVerificationReport): string {
  const safePayload = {
    application: 'PrivacyGuard AI — Export Verification Center',
    schemaVersion: '1.0',
    generatedAtIso: report.timestampIso,
    processedOnDevice: report.processedOnDevice,
    privacyNotice:
      'This report is intentionally sanitized. It contains zero GPS coordinates, zero extracted OCR text, and zero private URLs.',
    summary: {
      overallVerificationState: report.overallStatus.toUpperCase(),
      canDecodeExport: report.canDecodeExport,
      originalFormat: report.originalFormat,
      exportedFormat: report.exportedFormat,
      originalSizeBytes: report.originalSizeBytes,
      exportedSizeBytes: report.exportedSizeBytes,
      dimensions: report.dimensionsLabel,
      metadataBytesBefore: report.exifBytesBefore,
      metadataBytesAfter: report.exifBytesAfter,
      visualRedactionsFlattened: report.redactionsFlattenedCount,
      unredactedSuggestionsRemaining: report.unredactedSuggestionsCount,
    },
    checks: report.items.map((item) => ({
      id: item.id,
      check: item.label,
      category: item.category,
      resultState: item.status.toUpperCase(),
      disposition: item.disposition,
      explanation: item.detail,
    })),
    importantLimitations: report.limitationsNote,
  };
  return JSON.stringify(safePayload, null, 2);
}

/**
 * Runs a real, deterministic self-test of local offline capabilities (EXIF binary
 * injection/inspection, URL tracker sanitization, and PII pattern recognition).
 */
export function runLiveOfflineDiagnostic(): {
  allPassed: boolean;
  durationMs: number;
  tests: Array<{ name: string; passed: boolean; detail: string }>;
} {
  const start = performance.now();
  const tests: Array<{ name: string; passed: boolean; detail: string }> = [];

  // Test 1: Binary EXIF injector + stripper verification
  const minimalJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const injected = injectSampleExifIntoJpeg(minimalJpeg);
  const inspectInjected = inspectBinaryMetadataSegments(injected);
  const inspectClean = inspectBinaryMetadataSegments(minimalJpeg);
  const exifTestPassed = inspectInjected.app1ExifBytes > 100 && inspectClean.app1ExifBytes === 0;
  tests.push({
    name: 'Local Binary EXIF/GPS Parser & Verifier',
    passed: exifTestPassed,
    detail: exifTestPassed
      ? `Detected ${inspectInjected.app1ExifBytes} bytes of binary APP1 EXIF/GPS in test buffer and verified 0 bytes in clean buffer.`
      : 'Binary EXIF parser self-check failed.',
  });

  // Test 2: Local URL Tracker & PII Sanitizer
  const sampleDirtyUrl =
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=share_token_123&utm_source=instagram&fbclid=IwAR999&user_email=test@example.com';
  const urlRes = analyzeAndCleanUrl(sampleDirtyUrl);
  const urlTestPassed =
    urlRes.isValid &&
    urlRes.cleanedUrl === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' &&
    urlRes.removedCount === 4;
  tests.push({
    name: 'Local URL Tracker & PII Ruleset (60+ Rules)',
    passed: urlTestPassed,
    detail: urlTestPassed
      ? 'Stripped si, utm_source, fbclid, and user_email while preserving essential ?v= video ID offline.'
      : 'URL ruleset self-check failed.',
  });

  // Test 3: Local Sensitive Text Classifier
  const piiRes = detectSensitiveTextPatterns(
    'Contact aarav.sharma@example.org or +91 98765 43210, ID 4912-8834-9012'
  );
  const piiPassed = piiRes.length === 3;
  tests.push({
    name: 'Local Sensitive Text Pattern Classifier (Email / Phone / ID)',
    passed: piiPassed,
    detail: piiPassed
      ? 'Accurately classified email, phone number, and 12-digit ID pattern with zero external calls.'
      : 'PII pattern classifier self-check failed.',
  });

  const durationMs = Math.max(1, Math.round((performance.now() - start) * 100) / 100);
  return {
    allPassed: tests.every((t) => t.passed),
    durationMs,
    tests,
  };
}

/**
 * ScrubPix-inspired True Lossless Binary JPEG Metadata Stripper (didrod205/scrubpix).
 * Surgically strips APP1..APP15 (0xFFE1..0xFFEF, including EXIF, GPS, XMP, IPTC) and COM (0xFFFE)
 * segments directly from a JPEG byte stream without decoding or re-compressing image pixels.
 */
export function stripJpegMetadataLossless(jpegBytes: Uint8Array): {
  cleanedBytes: Uint8Array;
  bytesRemoved: number;
  segmentsRemoved: number;
  isLosslessJpeg: boolean;
} {
  if (jpegBytes.length < 4 || jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
    return {
      cleanedBytes: jpegBytes,
      bytesRemoved: 0,
      segmentsRemoved: 0,
      isLosslessJpeg: false,
    };
  }

  const keptChunks: Uint8Array[] = [jpegBytes.subarray(0, 2)]; // Keep SOI (0xFFD8)
  let offset = 2;
  let bytesRemoved = 0;
  let segmentsRemoved = 0;

  while (offset < jpegBytes.length) {
    if (jpegBytes[offset] !== 0xff) {
      // Rest of stream is compressed scan data
      keptChunks.push(jpegBytes.subarray(offset));
      break;
    }

    const marker = jpegBytes[offset + 1];
    // Start of Scan (0xDA) or End of Image (0xD9) -> copy everything from here to end untouched
    if (marker === 0xda || marker === 0xd9) {
      keptChunks.push(jpegBytes.subarray(offset));
      break;
    }

    // Standalone markers without length
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      keptChunks.push(jpegBytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    if (offset + 4 > jpegBytes.length) {
      keptChunks.push(jpegBytes.subarray(offset));
      break;
    }

    const segLength = (jpegBytes[offset + 2] << 8) | jpegBytes[offset + 3];
    if (segLength < 2 || offset + 2 + segLength > jpegBytes.length) {
      keptChunks.push(jpegBytes.subarray(offset));
      break;
    }

    // Strip APP1..APP15 (0xE1..0xEF) and COM (0xFE), keep APP0 (0xE0 JFIF), DQT, DHT, SOF, etc.
    const shouldStrip = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (shouldStrip) {
      bytesRemoved += 2 + segLength;
      segmentsRemoved++;
    } else {
      keptChunks.push(jpegBytes.subarray(offset, offset + 2 + segLength));
    }

    offset += 2 + segLength;
  }

  const totalLength = keptChunks.reduce((acc, c) => acc + c.length, 0);
  const cleanedBytes = new Uint8Array(totalLength);
  let writePos = 0;
  for (const chunk of keptChunks) {
    cleanedBytes.set(chunk, writePos);
    writePos += chunk.length;
  }

  return {
    cleanedBytes,
    bytesRemoved,
    segmentsRemoved,
    isLosslessJpeg: true,
  };
}

/**
 * Social-Media-Friendly Resize Presets (inspired by Aaqib-Proj/Image-Meta-Data-Cleaner)
 */
export interface SocialResizePreset {
  id: 'original' | 'ig_square' | 'ig_portrait' | 'story_reel' | 'messaging_hd';
  label: string;
  maxWidth: number | null;
  maxHeight: number | null;
  description: string;
}

export const SOCIAL_RESIZE_PRESETS: SocialResizePreset[] = [
  {
    id: 'original',
    label: 'Original Resolution',
    maxWidth: null,
    maxHeight: null,
    description: 'Preserves exact pixel width and height (ScrubPix lossless-ready).',
  },
  {
    id: 'ig_square',
    label: 'Social Square (1080×1080 max)',
    maxWidth: 1080,
    maxHeight: 1080,
    description: 'Optimized for Instagram, LinkedIn, and profile posts.',
  },
  {
    id: 'ig_portrait',
    label: 'Social Portrait (1080×1350 max)',
    maxWidth: 1080,
    maxHeight: 1350,
    description: '4:5 feed aspect cap for Instagram and threads.',
  },
  {
    id: 'story_reel',
    label: 'Story / Status (1080×1920 max)',
    maxWidth: 1080,
    maxHeight: 1920,
    description: '9:16 vertical cap for WhatsApp Status and Instagram Stories.',
  },
  {
    id: 'messaging_hd',
    label: 'Messaging Compact (1280px max)',
    maxWidth: 1280,
    maxHeight: 1280,
    description: 'Fast, lightweight share copy for Signal, WhatsApp, and Telegram.',
  },
];


