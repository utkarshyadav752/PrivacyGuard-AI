import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeAndCleanUrl,
  detectSensitiveTextPatterns,
  injectSampleExifIntoJpeg,
  inspectBinaryMetadataSegments,
  calculatePhotoRiskReport,
  verifyExportedImageBytes,
  getPresetBehaviorSummary,
  buildDetailedVerificationReport,
  generateSanitizedVerificationReportJson,
  runLiveOfflineDiagnostic,
  cleanBulkUrls,
  validateLuhnChecksum,
  stripJpegMetadataLossless,
} from './privacyEngine';

test('URL cleaner strips UTM, fbclid, igsh, and sensitive email while preserving essential parameters', () => {
  const dirtyUrl =
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&utm_source=instagram&utm_medium=social&fbclid=IwAR123456&si=shareToken99&user_email=aarav@example.org';
  const result = analyzeAndCleanUrl(dirtyUrl);

  assert.equal(result.isValid, true);
  assert.equal(result.cleanedUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s');
  assert.equal(result.removedCount, 5);
  assert.equal(result.retainedCount, 2);
  assert.equal(result.riskReport.level, 'High'); // because user_email is present
  assert.ok(result.sensitiveWarnings.length >= 1);
});

test('URL cleaner supports restoring individual removed parameters on user toggle', () => {
  const dirtyUrl = 'https://example.com/article?id=99&utm_source=newsletter&ref=top_nav';
  const restored = analyzeAndCleanUrl(dirtyUrl, new Set(['ref']), new Set());
  assert.equal(restored.cleanedUrl, 'https://example.com/article?id=99&ref=top_nav');
  assert.equal(restored.removedCount, 1);
  assert.equal(restored.retainedCount, 2);
});

test('URL cleaner strips Amazon /ref= path segments while preserving product path', () => {
  const amazonUrl =
    'https://www.amazon.in/Sony-Headphones/dp/B0863TXGM3/ref=sr_1_3?qid=1712345&sr=8-3&k=headphones';
  const res = analyzeAndCleanUrl(amazonUrl);
  assert.equal(res.isValid, true);
  assert.equal(res.cleanedUrl, 'https://www.amazon.in/Sony-Headphones/dp/B0863TXGM3?k=headphones');
});

test('Sensitive text detector identifies emails, phones, and ID numbers accurately', () => {
  const sampleText =
    'Contact aarav.sharma@example.org or call +91 98765 43210. Card/ID: 4912-8834-9012.';
  const entities = detectSensitiveTextPatterns(sampleText);
  assert.equal(entities.length, 3);
  assert.equal(entities[0].type, 'email');
  assert.equal(entities[1].type, 'phone');
  assert.equal(entities[2].type, 'id_number');
});

test('Binary EXIF injector and inspector detect APP1 EXIF segments and verify clean stripped buffers', () => {
  const cleanMinimalJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
  const cleanInspection = inspectBinaryMetadataSegments(cleanMinimalJpeg);
  assert.equal(cleanInspection.format, 'jpeg');
  assert.equal(cleanInspection.app1ExifBytes, 0);

  const withExif = injectSampleExifIntoJpeg(cleanMinimalJpeg);
  const dirtyInspection = inspectBinaryMetadataSegments(withExif);
  assert.equal(dirtyInspection.format, 'jpeg');
  assert.ok(dirtyInspection.app1ExifBytes > 100);
  assert.ok(dirtyInspection.embeddedAsciiStrings.some((s) => s.includes('iPhone 16 Pro')));

  const verification = verifyExportedImageBytes(
    withExif.length,
    cleanMinimalJpeg,
    'image/jpeg',
    true,
    [
      {
        id: 'face-1',
        type: 'face',
        label: 'Detected Face',
        confidence: 0.94,
        source: 'On-Device Detector',
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.2,
        selectedForRedaction: true,
        redactionStyle: 'blur',
      },
    ],
    true
  );

  assert.equal(verification.metadataRemovedVerified, true);
  assert.equal(verification.passedAllAvailableChecks, true);
  assert.equal(verification.visualRedactionsAppliedCount, 1);
  assert.equal(verification.unredactedDetectionsRemainingCount, 0);
});

test('Photo risk rubric scores GPS and visible regions transparently', () => {
  const report = calculatePhotoRiskReport(
    [
      {
        key: 'GPSCoordinates',
        label: 'GPS Coordinates',
        value: '28.6139° N, 77.2090° E',
        category: 'location',
        sensitivity: 'high',
        explanation: 'Exact capture location.',
      },
    ],
    [],
    []
  );
  assert.equal(report.level, 'High');
  assert.equal(report.totalPoints, 45);
});

test('Detailed verification report distinguishes Passed, Warning, and Not Verified and sanitizes exported JSON', () => {
  const cleanMinimalJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
  const detailReport = buildDetailedVerificationReport({
    originalSizeBytes: 74000,
    originalFormat: 'image/jpeg',
    originalExifBytes: 274,
    hadGpsInitially: true,
    hadDeviceMetaInitially: true,
    exportedBytes: cleanMinimalJpeg,
    exportedMimeType: 'image/jpeg',
    canDecodeExport: true,
    width: 960,
    height: 600,
    metadataRemovedRequested: true,
    visualDetections: [
      {
        id: 'face-1',
        type: 'face',
        label: 'Subject Face',
        confidence: 0.96,
        source: 'On-Device Face Detector',
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.2,
        selectedForRedaction: true,
        redactionStyle: 'blur',
      },
    ],
    redactionsApplied: true,
    ocrModelInstalled: false,
  });

  assert.equal(detailReport.overallStatus, 'passed');
  assert.equal(detailReport.exifBytesAfter, 0);
  const gpsItem = detailReport.items.find((i) => i.id === 'gps-check');
  assert.equal(gpsItem?.status, 'passed');
  assert.equal(gpsItem?.disposition, 'Removed');

  const ocrItem = detailReport.items.find((i) => i.id === 'ocr-coverage');
  assert.equal(ocrItem?.status, 'not_verified');
  assert.equal(ocrItem?.disposition, 'Not checked');

  const jsonStr = generateSanitizedVerificationReportJson(detailReport);
  assert.ok(!jsonStr.includes('28.6139')); // never leaks GPS coordinates
  assert.ok(jsonStr.includes('PASSED'));
});

test('Live offline diagnostic self-test passes all local engines', () => {
  const diag = runLiveOfflineDiagnostic();
  assert.equal(diag.allPassed, true);
  assert.equal(diag.tests.length, 3);
  const preset = getPresetBehaviorSummary('extra_privacy');
  assert.equal(preset.autoSelectHighConfidenceRegions, true);
});

test('ClearURLs & Link Cleaner redirect wrapper unwrapping and bulk link sanitizer work accurately', () => {
  const wrappedUrl =
    'https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.amazon.in%2FHeadphones%2Fdp%2FB09XS7JWHH%2Fref%3Dsr_1_2%3Fqid%3D1729981234%26tag%3Daffiliate-21%26k%3Dheadphones&h=AT29xLm';
  const res = analyzeAndCleanUrl(wrappedUrl);
  assert.equal(res.isValid, true);
  assert.equal(res.unwrappedFromHost, 'l.facebook.com');
  assert.equal(res.cleanedUrl, 'https://www.amazon.in/Headphones/dp/B09XS7JWHH?k=headphones');
  assert.ok(res.providerRuleMatched?.includes('Amazon'));

  const bulk = cleanBulkUrls(
    'https://www.instagram.com/p/C9x/?igsh=123\nhttps://open.spotify.com/track/123?si=abc&nd=1'
  );
  assert.equal(bulk.results.length, 2);
  assert.equal(bulk.totalTrackersRemoved, 3);
});

test('Scrub Luhn payment card checksum and ScrubPix lossless binary JPEG stripper verify cleanly', () => {
  assert.equal(validateLuhnChecksum('4532-0151-1283-0366'), true);
  assert.equal(validateLuhnChecksum('4532-0151-1283-0367'), false);

  const entities = detectSensitiveTextPatterns('Card: 4532-0151-1283-0366');
  assert.equal(entities.length, 1);
  assert.equal(entities[0].type, 'card_number');

  const cleanMinimalJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xaa, 0xbb, 0xff, 0xd9]);
  const dirtyJpeg = injectSampleExifIntoJpeg(cleanMinimalJpeg);
  const stripped = stripJpegMetadataLossless(dirtyJpeg);
  assert.equal(stripped.isLosslessJpeg, true);
  assert.equal(stripped.segmentsRemoved, 1);
  assert.ok(stripped.bytesRemoved > 200);
  assert.deepEqual(stripped.cleanedBytes, cleanMinimalJpeg);
});


