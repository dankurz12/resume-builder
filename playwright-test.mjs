/**
 * Playwright end-to-end tests for resume-builder
 * Serves CDN libraries locally to work in sandboxed environments.
 */
import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { strict as assert } from 'assert';
import { setTimeout as sleep } from 'timers/promises';

const PORT = 8765;
const BASE_URL = `http://localhost:${PORT}`;
const DOCX_PATH = '/home/user/resume-builder/sample-resume.docx';
const SAMPLE_JD = `We are looking for a Senior Software Engineer with 7+ years of experience in distributed systems architecture, Python, AWS (Lambda, ECS, RDS), and microservices. You will lead technical design, mentor engineers, and drive scalability for our platform serving 2M+ users. Strong experience with Kubernetes, CI/CD, and real-time data pipelines required.`;

// Read local CDN substitutes
const JSZIP_JS = readFileSync('/home/user/resume-builder/node_modules/jszip/dist/jszip.min.js', 'utf8');
const DOCX_JS  = readFileSync('/home/user/resume-builder/node_modules/docx/build/index.umd.js', 'utf8');

let server;
let browser;
let pageErrors = [];

// ── Mock tailor response ──────────────────────────────────────────────────────
function buildMockTailorResponse(paragraphCount) {
  const tailored = [
    "Jane Smith",
    "jane.smith@email.com | (555) 123-4567 | linkedin.com/in/janesmith",
    "",
    "PROFESSIONAL SUMMARY",
    "Senior Software Engineer with 7+ years building distributed systems on AWS. Expert in Python, microservices, and Kubernetes. Led platform scaling for 2M+ users.",
    "",
    "EXPERIENCE",
    "Senior Software Engineer — Acme Corp (2021–Present)",
    "• Architected microservices platform on AWS ECS/Lambda handling 2M+ daily users, improving reliability to 99.95%",
    "• Built real-time data pipeline in Python using Kafka, processing 500K events/minute",
    "• Mentored 5 engineers on distributed systems and drove Kubernetes adoption across 3 teams",
    "",
    "Software Engineer — StartupXYZ (2019–2021)",
    "• Led Python/AWS backend for SaaS platform scaling from 50 to 200+ enterprise clients",
    "• Implemented Kubernetes-based CI/CD pipeline reducing deploy time by 93%",
    "",
    "SKILLS",
    "Python, JavaScript, TypeScript, React, Node.js, AWS (Lambda/ECS/RDS), Docker, Kubernetes, Apache Kafka",
    "",
    "EDUCATION",
    "B.S. Computer Science — State University (2019)"
  ];
  const paragraphs = Array.from({ length: paragraphCount }, (_, i) => ({
    idx: i, text: tailored[i] !== undefined ? tailored[i] : ''
  }));
  return `<PARAGRAPHS>${JSON.stringify(paragraphs)}</PARAGRAPHS><CHANGES>[{"type":"modified","description":"Enhanced summary to highlight 7+ years and AWS/distributed systems expertise"},{"type":"keyword","description":"Added Python, AWS Lambda/ECS/RDS, Kubernetes, Apache Kafka throughout"}]</CHANGES>`;
}

// ── Start http-server ─────────────────────────────────────────────────────────
function startServer() {
  return new Promise((resolve) => {
    server = spawn('http-server', ['.', '-p', String(PORT), '-c-1', '--silent'], {
      cwd: '/home/user/resume-builder',
      stdio: 'ignore',
      detached: false
    });
    server.on('error', e => console.log('server error (ignored):', e.message));
    setTimeout(resolve, 2000);
  });
}

// ── Set up route intercepts (CDN + API mock) ──────────────────────────────────
async function setupRoutes(page, paragraphCount) {
  // Serve JSZip locally
  await page.route('**/jszip**', route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: JSZIP_JS
  }));
  // Serve docx library locally
  await page.route('**/docx**umd**', route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: DOCX_JS
  }));
  // Block Google Fonts (not needed for tests, causes delays)
  await page.route('**/fonts.googleapis.com/**', route => route.abort());
  await page.route('**/fonts.gstatic.com/**', route => route.abort());
  // Mock Claude API
  let apiCallCount = 0;
  await page.route('**/api.anthropic.com/**', async route => {
    apiCallCount++;
    console.log(`  [Mock API] call #${apiCallCount}`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'msg_mock_' + apiCallCount,
        type: 'message', role: 'assistant',
        content: [{ type: 'text', text: buildMockTailorResponse(paragraphCount) }],
        model: 'claude-sonnet-4-5', stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 200 }
      })
    });
  });
  return { getApiCallCount: () => apiCallCount };
}

// ── Navigate helper ───────────────────────────────────────────────────────────
async function navigateTo(page, url) {
  // Use 'load' not 'networkidle' — CDN failures keep networkidle from resolving
  await page.goto(url, { waitUntil: 'load', timeout: 20000 });
  // Wait for JSZip to be defined (lib loaded)
  await page.waitForFunction(() => typeof window.JSZip !== 'undefined', { timeout: 10000 })
    .catch(() => console.log('  Warning: JSZip not found in window — may affect DOCX processing'));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function testA_PageLoads(page) {
  console.log('\n[TEST A] Page loads and renders correctly');

  await navigateTo(page, BASE_URL);

  // Title present
  const title = await page.title();
  console.log('  Page title:', title);

  // Check key elements exist
  await page.waitForSelector('#addTplBtn', { state: 'visible', timeout: 5000 });
  console.log('  #addTplBtn visible');

  // Check CSS custom properties applied (body not plain white)
  const bgColor = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
  console.log('  Body background-color:', bgColor);
  assert.ok(bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== '', 'CSS should be applied (non-transparent background)');

  // Check #forgeBtn exists
  const forgeBtnCount = await page.locator('#forgeBtn').count();
  assert.ok(forgeBtnCount > 0, '#forgeBtn should exist');

  // Debug: list ALL element IDs in the DOM
  const allIds = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[id]')).map(el => el.id);
  });
  console.log('  All DOM IDs:', allIds.join(', '));

  // Debug: check key element IDs exist
  const domAudit = await page.evaluate(() => {
    const ids = ['inlineAddTpl','tplFile','tplName','tplUploadZone','tplFileStatus',
                 'addTplBtn','jdText','forgeBtn','resultCard','downloadBtn','apiModal'];
    const result = {};
    ids.forEach(id => {
      const el = document.getElementById(id);
      result[id] = el ? `exists (${el.tagName}, display=${window.getComputedStyle(el).display})` : 'NULL';
    });
    return result;
  });
  console.log('  DOM audit:');
  Object.entries(domAudit).forEach(([id, state]) => console.log(`    #${id}: ${state}`));

  console.log('  PASS — page loaded, CSS applied, key elements present');
}

async function testB_AddTemplateFormOpens(page) {
  console.log('\n[TEST B] Add template form opens and file input is iOS-compatible');

  // Make sure we're on the page
  if (!(await page.locator('#addTplBtn').isVisible().catch(() => false))) {
    await navigateTo(page, BASE_URL);
  }

  // Debug: check element state before clicking
  const preClickState = await page.evaluate(() => {
    const form = document.getElementById('inlineAddTpl');
    const btn = document.getElementById('addTplBtn');
    return {
      formExists: form !== null,
      formDisplay: form ? form.style.display : 'N/A',
      btnExists: btn !== null,
      btnText: btn ? btn.textContent.trim() : 'N/A'
    };
  });
  console.log('  Pre-click state:', JSON.stringify(preClickState));

  await page.click('#addTplBtn');

  // Wait for form to appear
  await page.waitForFunction(() => {
    const el = document.getElementById('inlineAddTpl');
    return el && window.getComputedStyle(el).display !== 'none';
  }, { timeout: 5000 });

  console.log('  #inlineAddTpl is visible');

  // File input must exist
  const inputCount = await page.locator('#tplFile').count();
  assert.ok(inputCount > 0, '#tplFile must exist');

  // Critical: file input must NOT be display:none
  const inputDisplay = await page.evaluate(() => {
    const el = document.getElementById('tplFile');
    if (!el) return 'NOT_FOUND';
    return window.getComputedStyle(el).display;
  });
  console.log('  #tplFile computed display:', inputDisplay);
  assert.notEqual(inputDisplay, 'NOT_FOUND', '#tplFile must exist');
  assert.notEqual(inputDisplay, 'none', '#tplFile must not be display:none (breaks iOS file picker)');

  // label[for="tplFile"] must exist
  const labelExists = await page.evaluate(() => !!document.querySelector('label[for="tplFile"]'));
  console.log('  label[for="tplFile"] exists:', labelExists);
  assert.ok(labelExists, 'label[for="tplFile"] is required for iOS tap-to-open');

  // Upload zone is visible
  await page.locator('#tplUploadZone').waitFor({ state: 'visible' });

  console.log('  PASS — form open, file input accessible, label[for] present');
}

async function testC_FileUploadAndSave(page) {
  console.log('\n[TEST C] DOCX file upload and template save');

  // Form should already be open from Test B, but ensure it's open
  const formVisible = await page.evaluate(() => {
    const el = document.getElementById('inlineAddTpl');
    return el && window.getComputedStyle(el).display !== 'none';
  });
  if (!formVisible) {
    await page.click('#addTplBtn');
    await page.waitForFunction(() => {
      const el = document.getElementById('inlineAddTpl');
      return el && window.getComputedStyle(el).display !== 'none';
    }, { timeout: 3000 });
  }

  const docxBuffer = readFileSync(DOCX_PATH);
  console.log('  Uploading', DOCX_PATH, '(', docxBuffer.length, 'bytes)');

  // Check if tplFile exists and its visibility state
  const tplFileState = await page.evaluate(() => {
    const el = document.getElementById('tplFile');
    if (!el) return { exists: false };
    return {
      exists: true,
      display: window.getComputedStyle(el).display,
      visibility: window.getComputedStyle(el).visibility,
      parentDisplay: window.getComputedStyle(el.parentElement).display,
    };
  });
  console.log('  #tplFile state:', JSON.stringify(tplFileState));

  // setInputFiles directly interacts with the input element
  await page.locator('#tplFile').setInputFiles({
    name: 'jane-smith-resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxBuffer
  });

  // Wait for DOCX parsing — status text should update
  await page.waitForFunction(() => {
    const el = document.getElementById('tplFileStatus');
    if (!el) return false;
    const txt = el.textContent || '';
    return txt.includes('✓') || txt.includes('paragraph') || txt.includes('Extracted') || txt.includes('parsed');
  }, { timeout: 15000 });

  const status = await page.textContent('#tplFileStatus');
  console.log('  File status after upload:', status.trim());

  assert.ok(
    status.includes('✓') || status.includes('paragraph') || status.includes('Extracted'),
    `Expected successful extraction message, got: "${status.trim()}"`
  );

  // Fill template name
  await page.fill('#tplName', 'Jane Smith - Software Engineer');

  // Save
  await page.click('#saveTplBtn');

  // Form should close
  await page.waitForFunction(() => {
    const el = document.getElementById('inlineAddTpl');
    return !el || window.getComputedStyle(el).display === 'none';
  }, { timeout: 5000 });

  // Template appears in list
  await page.waitForFunction(() => {
    const list = document.getElementById('tplList');
    return list && list.children.length > 0;
  }, { timeout: 3000 });

  const listText = await page.textContent('#tplList');
  console.log('  Template list content:', listText.trim().replace(/\s+/g, ' ').slice(0, 100));
  assert.ok(listText.includes('Jane Smith'), 'Template name should appear in list');

  // Verify localStorage
  const stored = await page.evaluate(() => localStorage.getItem('resumeTemplates'));
  assert.ok(stored !== null, 'Templates must be in localStorage');
  const parsed = JSON.parse(stored);
  assert.ok(parsed.length >= 1, 'At least 1 template must be stored');
  const tpl = parsed[0];
  assert.ok(tpl.docxBase64 && tpl.docxBase64.length > 100, 'docxBase64 must be stored for .docx files');
  assert.ok(tpl.paragraphs && tpl.paragraphs.length > 0, 'paragraphs must be stored');
  console.log('  localStorage: paragraphs =', tpl.paragraphs.length, ', docxBase64 length =', tpl.docxBase64.length);

  console.log('  PASS — file uploaded, extracted, template saved');
}

async function testD_ForgeFlow(page) {
  console.log('\n[TEST D] Full forge flow with mocked Claude API');

  // Get paragraph count from saved template
  const paragraphCount = await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('resumeTemplates') || '[]');
    return t[0]?.paragraphs?.length || 21;
  });
  console.log('  Template paragraphs:', paragraphCount);

  // Re-mock API with correct paragraph count (routes persist per page)
  let apiHits = 0;
  await page.route('**/api.anthropic.com/**', async route => {
    apiHits++;
    console.log(`  [Mock API] hit #${apiHits}`);
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        id: 'msg_mock_' + apiHits, type: 'message', role: 'assistant',
        content: [{ type: 'text', text: buildMockTailorResponse(paragraphCount) }],
        model: 'claude-sonnet-4-5', stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 200 }
      })
    });
  });

  // Inject API key directly into page scope
  await page.evaluate(() => {
    // Save to localStorage so it persists
    localStorage.setItem('cfgApiKey', 'test-api-key-not-real');
  });

  // Trigger config load (the app usually does this on init)
  const loaded = await page.evaluate(() => {
    if (typeof loadConfig === 'function') { loadConfig(); return true; }
    // Fallback: set the global directly if accessible
    if (typeof apiKey !== 'undefined') {
      // eslint-disable-next-line no-global-assign
      apiKey = localStorage.getItem('cfgApiKey') || 'test-api-key-not-real';
      return true;
    }
    return false;
  });
  console.log('  API key load result:', loaded);

  // Check if key was applied
  const keyInScope = await page.evaluate(() => {
    return typeof apiKey !== 'undefined' ? apiKey.length : -1;
  });
  console.log('  apiKey length in page scope:', keyInScope);

  // Switch to text tab for JD input (the "Paste Text" tab is default active)
  try {
    // Click "Paste Text" tab which has onclick="switchTab('paste')"
    await page.click('div.tab[onclick*="paste"]', { timeout: 2000 });
  } catch(e) {
    console.log('  (paste tab click skipped — may already be active)');
  }

  // Fill JD text
  await page.fill('#jdText', SAMPLE_JD);
  const jdVal = await page.inputValue('#jdText');
  assert.ok(jdVal.length > 50, `JD textarea should have content, got length ${jdVal.length}`);
  console.log('  JD text filled, length:', jdVal.length);

  // Click forge
  await page.locator('#forgeBtn').waitFor({ state: 'visible', timeout: 3000 });
  await page.click('#forgeBtn');
  console.log('  Clicked #forgeBtn, waiting for results...');

  // Wait for result card
  try {
    await page.waitForFunction(() => {
      const rc = document.getElementById('resultCard');
      if (!rc) return false;
      const style = window.getComputedStyle(rc);
      return rc.classList.contains('visible') || style.display !== 'none' || style.opacity === '1';
    }, { timeout: 20000 });
    console.log('  Result card became visible');
  } catch(e) {
    // Check for error message
    const errMsg = await page.evaluate(() => {
      const selectors = ['#forgeError', '.error-banner', '[class*="error"]'];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el && el.textContent.trim()) return el.textContent.trim();
      }
      return null;
    });
    throw new Error(`Result never appeared. Error on page: ${errMsg || 'none'}. API hits: ${apiHits}. Original: ${e.message}`);
  }

  // Check changes list
  const changesCount = await page.evaluate(() => {
    const list = document.getElementById('changesList');
    return list ? list.children.length : 0;
  });
  console.log('  Changes list items:', changesCount);
  assert.ok(changesCount > 0, 'Changes list must have items');

  // Check download button visible
  const dlVisible = await page.locator('#downloadBtn').isVisible();
  console.log('  Download button visible:', dlVisible);
  assert.ok(dlVisible, '#downloadBtn should be visible after forge');

  assert.ok(apiHits >= 1, `Expected >= 1 API call, got ${apiHits}`);
  console.log('  PASS — forge completed with', apiHits, 'API calls, results shown');
}

async function testE_Download(page) {
  console.log('\n[TEST E] Download .docx works without errors');

  // Intercept window.open
  await page.evaluate(() => {
    window._windowOpenCalled = false;
    const orig = window.open.bind(window);
    window.open = (url, ...args) => { window._windowOpenCalled = true; return orig(url, ...args); };
  });

  const errorsBefore = pageErrors.length;
  await page.click('#downloadBtn');
  await sleep(3000);

  const newErrors = pageErrors.slice(errorsBefore);
  if (newErrors.length > 0) {
    console.log('  Errors during download:', newErrors);
  }
  assert.equal(newErrors.length, 0, `Should be no JS errors during download, got: ${newErrors.join('; ')}`);

  console.log('  PASS — download triggered, no errors');
}

// ── Main runner ───────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Resume Builder Playwright Test Suite ===\n');

  console.log('Starting http-server on port', PORT, '...');
  await startServer();
  console.log('Server ready.');

  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    ...devices['iPad Air'],
    bypassCSP: true,
  });
  const page = await context.newPage();

  // Collect JS errors
  page.on('pageerror', err => {
    // Ignore font-loading errors which are expected in this env
    if (!err.message.includes('font') && !err.message.includes('Font')) {
      pageErrors.push(err.message);
      console.log('  [PageError]', err.message);
    }
  });

  // Set up CDN intercepts BEFORE first navigation
  await setupRoutes(page, 21);

  const results = { passed: 0, failed: 0, failures: [] };
  const tests = [
    ['A: Page loads',           testA_PageLoads],
    ['B: Add template form',    testB_AddTemplateFormOpens],
    ['C: File upload + save',   testC_FileUploadAndSave],
    ['D: Forge flow (mocked)',  testD_ForgeFlow],
    ['E: Download',             testE_Download],
  ];

  for (const [name, fn] of tests) {
    pageErrors = [];
    try {
      await fn(page);
      results.passed++;
    } catch(e) {
      console.error(`\n  ✗ FAIL [${name}]: ${e.message}`);
      results.failed++;
      results.failures.push({ name, error: e.message });
      try {
        const fname = `/tmp/pw-fail-${name.replace(/[^a-z0-9]/gi, '-')}.png`;
        await page.screenshot({ path: fname, fullPage: false });
        console.log('  Screenshot:', fname);
      } catch (_) {}
    }
  }

  await browser.close();
  if (server) server.kill();

  console.log(`\n=== Results: ${results.passed}/${tests.length} passed ===`);
  if (results.failed > 0) {
    console.log('\nFailures:');
    results.failures.forEach(f => console.log(`  • [${f.name}]: ${f.error}`));
    process.exit(1);
  }
  console.log('\n✓ All tests passed!');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  if (browser) browser.close().catch(() => {});
  if (server) server.kill();
  process.exit(1);
});
