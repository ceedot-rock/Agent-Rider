const fs = require('fs');
const path = require('path');
const https = require('https');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(__dirname, '.env'));

const TOKEN = process.env.VERCEL_TOKEN;
const DEPLOY_ID = process.env.DEPLOY_ID;
const TEAM_ID = process.env.TEAM_ID;

if (!TOKEN || !DEPLOY_ID || !TEAM_ID) {
  console.error('Missing required environment variables: VERCEL_TOKEN, DEPLOY_ID, TEAM_ID');
  process.exit(1);
}

function apiGet(urlPath) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: 'api.vercel.com', path: urlPath, headers: { Authorization: `Bearer ${TOKEN}` } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => res.statusCode >= 200 && res.statusCode < 300 ? resolve(data) : reject(new Error(`HTTP ${res.statusCode}: ${data}`)));
    }).on('error', reject);
  });
}

async function fetchFileContent(uid) {
  const raw = await apiGet(`/v7/deployments/${DEPLOY_ID}/files/${uid}?teamId=${TEAM_ID}`);
  try {
    const p = JSON.parse(raw);
    // The v7 file content endpoint always base64-encodes `data`; it doesn't send an `encoding` field.
    if (p.data === undefined) return Buffer.from(raw);
    return Buffer.from(p.data, 'base64');
  } catch {
    return Buffer.from(raw);
  }
}

let fileCount = 0, errorCount = 0;

async function walk(nodes, currentPath) {
  for (const node of nodes) {
    const nodePath = path.join(currentPath, node.name);
    if (node.type === 'directory') {
      fs.mkdirSync(nodePath, { recursive: true });
      if (node.children?.length) await walk(node.children, nodePath);
    } else if (node.type === 'file') {
      try {
        const content = await fetchFileContent(node.uid);
        fs.mkdirSync(path.dirname(nodePath), { recursive: true });
        fs.writeFileSync(nodePath, content);
        fileCount++;
        process.stdout.write(`\rDownloaded ${fileCount} files...`);
      } catch (err) {
        errorCount++;
        console.error(`\nFailed: ${nodePath} — ${err.message}`);
      }
    }
  }
}

(async () => {
  console.log(`Fetching file tree for ${DEPLOY_ID}...`);
  const tree = JSON.parse(await apiGet(`/v6/deployments/${DEPLOY_ID}/files?teamId=${TEAM_ID}`));
  const nodes = Array.isArray(tree) ? tree : tree.children || [tree];
  await walk(nodes, '.');
  console.log(`\n\nDone. ${fileCount} files, ${errorCount} errors.`);
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
