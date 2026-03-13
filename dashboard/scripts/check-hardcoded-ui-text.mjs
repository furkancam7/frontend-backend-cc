import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const TARGET_FILES = [
  'src/App.jsx',
  'src/components/Login.jsx',
  'src/components/DetectionList.jsx',
  'src/components/DataTable.jsx',
  'src/components/DetectionNotification.jsx',
  'src/components/HeaderClock.jsx',
  'src/components/DetectionHistory.jsx',
  'src/components/DetectionDetailView.jsx',
  'src/components/DetectionSidebar.jsx',
  'src/components/settings/LocationSettings.jsx',
  'src/components/map-parts/DevicePopupContent.jsx',
  'src/components/map-parts/TacticalPopupContent.jsx',
  'src/components/NotificationLog.jsx',
  'src/components/DeviceStatus.jsx',
  'src/components/DetectionDetail.jsx'
];

const ALLOWLIST = new Set([
  'EN',
  'TR',
  'SR',
  'MQTT',
  'SSH',
  'ID',
  'UUID',
  'UNK',
  'N/A',
  'X:',
  'Y:',
  'ONLINE',
  'OFFLINE'
]);

const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

const isAllowedText = (value) => {
  const text = value.trim();
  if (!text) return true;
  if (ALLOWLIST.has(text)) return true;
  if (/^[0-9\s.,:;!@#$%^&*()+\-_=<>[\]{}|/?\\'"]+$/.test(text)) return true;
  if (/^(https?:|\/api\/|mapbox:\/\/)/i.test(text)) return true;
  return false;
};

const findings = [];

for (const relativePath of TARGET_FILES) {
  const absolutePath = path.join(ROOT, relativePath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const source = stripComments(raw);
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const textNodeMatches = [...line.matchAll(/>\s*([A-Za-z][^<{]*)</g)];
    textNodeMatches.forEach((match) => {
      const value = match[1].trim();
      if (!value || isAllowedText(value)) return;
      findings.push({ relativePath, lineNumber, value, type: 'text-node' });
    });

    const attrMatches = [...line.matchAll(/(?:title|placeholder|aria-label)=["']([^"']*[A-Za-z][^"']*)["']/g)];
    attrMatches.forEach((match) => {
      const value = match[1].trim();
      if (!value || isAllowedText(value)) return;
      findings.push({ relativePath, lineNumber, value, type: 'attribute' });
    });
  });
}

if (findings.length > 0) {
  console.error('Hardcoded UI text check failed. Replace literals with i18n keys:\n');
  findings.forEach((finding) => {
    console.error(`- ${finding.relativePath}:${finding.lineNumber} [${finding.type}] "${finding.value}"`);
  });
  process.exit(1);
}

console.log('Hardcoded UI text check passed.');
