// test.mjs — autonomous Node.js tests for resume-builder logic
import JSZip from 'jszip';
import { strict as assert } from 'assert';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('');
const DOMParser = dom.window.DOMParser;
const XMLSerializer = dom.window.XMLSerializer;

// ── Helpers (ported from index.html logic) ────────────────────────────────────

function parseParagraphs(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const pEls = doc.getElementsByTagNameNS('*', 'p');
  const paragraphs = [];
  for (let i = 0; i < pEls.length; i++) {
    const tEls = pEls[i].getElementsByTagNameNS('*', 't');
    let text = '';
    for (let j = 0; j < tEls.length; j++) text += tEls[j].textContent;
    paragraphs.push({ idx: i, text });
  }
  return paragraphs;
}

function substituteParaText(xml, paragraphMap) {
  const wNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const pEls = doc.getElementsByTagNameNS('*', 'p');

  for (let i = 0; i < pEls.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(paragraphMap, i)) continue;
    const newText = paragraphMap[i];
    const pEl = pEls[i];
    const runs = pEl.getElementsByTagNameNS('*', 'r');
    let firstRPr = null;
    if (runs.length > 0) {
      const rprEls = runs[0].getElementsByTagNameNS('*', 'rPr');
      if (rprEls.length > 0) firstRPr = rprEls[0].cloneNode(true);
    }
    const runsToRemove = Array.from(pEl.getElementsByTagNameNS('*', 'r'));
    runsToRemove.forEach(r => r.parentNode.removeChild(r));
    const newRun = doc.createElementNS(wNS, 'w:r');
    if (firstRPr) newRun.appendChild(firstRPr);
    const wt = doc.createElementNS(wNS, 'w:t');
    if (newText && (/^\s/.test(newText) || /\s$/.test(newText))) {
      wt.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    }
    wt.textContent = newText;
    newRun.appendChild(wt);
    pEl.appendChild(newRun);
  }
  return new XMLSerializer().serializeToString(doc);
}

function parseTailorResponse(raw) {
  const parasMatch = raw.match(/<PARAGRAPHS>([\s\S]*?)<\/PARAGRAPHS>/);
  if (!parasMatch) throw new Error('Could not parse structured response. Try again.');
  let rawParas;
  try {
    const jsonStr = parasMatch[1].trim()
      .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    rawParas = JSON.parse(jsonStr);
  } catch(e) { throw new Error('Invalid paragraph JSON in response. Try again.'); }

  const paragraphMap = {};
  rawParas.forEach(p => {
    const idx = typeof p.idx === 'number' ? p.idx : parseInt(p.idx, 10);
    if (!isNaN(idx)) paragraphMap[idx] = p.text ?? '';
  });

  const changesMatch = raw.match(/<CHANGES>([\s\S]*?)<\/CHANGES>/);
  let changes = [];
  if (changesMatch) {
    try { changes = JSON.parse(changesMatch[1].trim()); }
    catch(e) { changes = [{ type: 'modified', description: 'Resume tailored to match job description.' }]; }
  }
  return { paragraphMap, changes };
}

function isIOS(userAgent, platform, maxTouchPoints) {
  return /ipad|iphone|ipod/i.test(userAgent) ||
         (platform === 'MacIntel' && maxTouchPoints > 1);
}

// ── Test 1: Extract paragraphs from a real .docx zip ─────────────────────────
async function testExtractDocxParagraphs() {
  console.log('\n[TEST 1] extractDocxParagraphs — minimal .docx');

  const minimalXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>John Smith</w:t></w:r></w:p>
    <w:p><w:r><w:t>Senior Engineer</w:t></w:r><w:r><w:t> | john@example.com</w:t></w:r></w:p>
    <w:p><w:r><w:t></w:t></w:r></w:p>
    <w:p><w:r><w:t>EXPERIENCE</w:t></w:r></w:p>
    <w:p><w:r><w:t>Acme Corp — Led backend migration</w:t></w:r></w:p>
  </w:body>
</w:document>`;

  const zip = new JSZip();
  zip.file('word/document.xml', minimalXml);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });

  const reloaded = await JSZip.loadAsync(buffer);
  const xml = await reloaded.file('word/document.xml').async('string');
  const paragraphs = parseParagraphs(xml);

  assert.equal(paragraphs.length, 5, 'Should find 5 paragraphs');
  assert.equal(paragraphs[0].text, 'John Smith');
  assert.equal(paragraphs[1].text, 'Senior Engineer | john@example.com', 'Should concat multi-run');
  assert.equal(paragraphs[2].text, '', 'Empty paragraph preserved');
  assert.equal(paragraphs[3].text, 'EXPERIENCE');
  assert.equal(paragraphs[4].idx, 4);

  console.log('  PASS — paragraphs extracted, multi-run concat works');
}

// ── Test 2: localStorage simulation for template persistence ─────────────────
function testSaveLoadTemplates() {
  console.log('\n[TEST 2] saveNewTemplate / loadTemplates — localStorage simulation');

  let store = {};
  const localStorage = {
    getItem: k => store[k] ?? null,
    setItem: (k, v) => { store[k] = v; },
  };

  let savedTemplates = [];

  function persist() { localStorage.setItem('resumeTemplates', JSON.stringify(savedTemplates)); }
  function load() {
    try { savedTemplates = JSON.parse(localStorage.getItem('resumeTemplates') || '[]'); }
    catch(e) { savedTemplates = []; }
  }

  const tpl = {
    id: '1700000000000', name: 'Software Engineer',
    content: 'John Smith\nSenior Engineer',
    paragraphs: [{ idx: 0, text: 'John Smith' }, { idx: 1, text: 'Senior Engineer' }],
    docxBase64: null, addedAt: new Date().toISOString()
  };
  savedTemplates.push(tpl);
  persist();
  savedTemplates = [];
  load();

  assert.equal(savedTemplates.length, 1);
  assert.equal(savedTemplates[0].name, 'Software Engineer');
  assert.equal(savedTemplates[0].paragraphs.length, 2);
  assert.equal(savedTemplates[0].docxBase64, null);

  savedTemplates.push({ id: '1700000000001', name: 'Product Manager', content: 'Jane',
    paragraphs: [{ idx: 0, text: 'Jane' }], docxBase64: 'ZmFrZQ==', addedAt: new Date().toISOString() });
  persist();
  savedTemplates = [];
  load();
  assert.equal(savedTemplates.length, 2);
  assert.equal(savedTemplates[1].docxBase64, 'ZmFrZQ==');

  console.log('  PASS — templates persisted, reloaded, multi-template works');
}

// ── Test 3: Claude response parsing edge cases ────────────────────────────────
function testTailorParsing() {
  console.log('\n[TEST 3] tailorAsStructured response parsing — edge cases');

  // A: clean numeric idx
  const resultA = parseTailorResponse(`<PARAGRAPHS>[{"idx":0,"text":"John Smith"},{"idx":1,"text":"Tailored summary"},{"idx":2,"text":""}]</PARAGRAPHS><CHANGES>[{"type":"modified","description":"Updated summary"}]</CHANGES>`);
  assert.equal(resultA.paragraphMap[0], 'John Smith');
  assert.equal(resultA.paragraphMap[1], 'Tailored summary');
  assert.equal(resultA.paragraphMap[2], '');
  assert.equal(resultA.changes[0].type, 'modified');
  console.log('  PASS A: clean numeric idx');

  // B: code fences stripped
  const resultB = parseTailorResponse(`<PARAGRAPHS>\`\`\`json\n[{"idx":0,"text":"John Smith"},{"idx":1,"text":"Backend Eng"}]\n\`\`\`\n</PARAGRAPHS><CHANGES>[]</CHANGES>`);
  assert.equal(resultB.paragraphMap[0], 'John Smith');
  assert.equal(resultB.paragraphMap[1], 'Backend Eng');
  console.log('  PASS B: code fence stripping');

  // C: string idx coerced
  const resultC = parseTailorResponse(`<PARAGRAPHS>[{"idx":"0","text":"Jane"},{"idx":"2","text":"PM"}]</PARAGRAPHS><CHANGES>[]</CHANGES>`);
  assert.equal(resultC.paragraphMap[0], 'Jane');
  assert.equal(resultC.paragraphMap[2], 'PM');
  assert.equal(resultC.paragraphMap[1], undefined);
  console.log('  PASS C: string idx coerced via parseInt');

  // D: malformed CHANGES falls back
  const resultD = parseTailorResponse(`<PARAGRAPHS>[{"idx":0,"text":"Test"}]</PARAGRAPHS><CHANGES>not json</CHANGES>`);
  assert.equal(resultD.changes[0].type, 'modified');
  console.log('  PASS D: malformed CHANGES fallback');

  // E: missing PARAGRAPHS throws
  assert.throws(() => parseTailorResponse(`<CHANGES>[]</CHANGES>`), /Could not parse/);
  console.log('  PASS E: missing PARAGRAPHS throws');

  // F: null/missing text coerced to ''
  const resultF = parseTailorResponse(`<PARAGRAPHS>[{"idx":0,"text":null},{"idx":1}]</PARAGRAPHS><CHANGES>[]</CHANGES>`);
  assert.equal(resultF.paragraphMap[0], '');
  assert.equal(resultF.paragraphMap[1], '');
  console.log('  PASS F: null/missing text coerced to empty string');
}

// ── Test 4: DOCX XML substitution round-trip ──────────────────────────────────
async function testRepackDocx() {
  console.log('\n[TEST 4] repackDocxWithNewText — XML substitution');

  const originalXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>John Smith</w:t></w:r></w:p>
    <w:p><w:r><w:t>Software Engineer</w:t></w:r></w:p>
    <w:p><w:r><w:t>5 years experience</w:t></w:r></w:p>
  </w:body>
</w:document>`;

  const zip = new JSZip();
  zip.file('word/document.xml', originalXml);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const docxBase64 = buffer.toString('base64');

  const decoded = Buffer.from(docxBase64, 'base64');
  const reloaded = await JSZip.loadAsync(decoded);
  const xml = await reloaded.file('word/document.xml').async('string');

  // Substitute only idx 1
  const newXml = substituteParaText(xml, { 1: 'Senior Frontend Engineer' });
  const after = parseParagraphs(newXml);
  assert.equal(after[0].text, 'John Smith', 'idx 0 unchanged');
  assert.equal(after[1].text, 'Senior Frontend Engineer', 'idx 1 replaced');
  assert.equal(after[2].text, '5 years experience', 'idx 2 unchanged');
  console.log('  PASS A: text substitution correct');

  assert.ok(newXml.includes('w:b'), 'Bold rPr preserved');
  console.log('  PASS B: rPr formatting node preserved');

  // Empty and leading-space text
  const newXml2 = substituteParaText(xml, { 0: '', 1: 'New text', 2: '  leading space' });
  const after2 = parseParagraphs(newXml2);
  assert.equal(after2[0].text, '');
  assert.equal(after2[2].text, '  leading space');
  console.log('  PASS C: empty string and leading-space handled');

  // Full zip repack
  reloaded.file('word/document.xml', newXml);
  const finalBuffer = await reloaded.generateAsync({ type: 'nodebuffer' });
  assert.ok(finalBuffer.length > 100, 'Output zip non-empty');
  console.log('  PASS D: zip repack produces valid buffer');
}

// ── Test 5: iOS detection ─────────────────────────────────────────────────────
function testIosDetection() {
  console.log('\n[TEST 5] triggerDownload — iOS detection logic');

  assert.equal(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5), true, 'iPad modern');
  assert.equal(isIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 5), true, 'iPhone UA');
  assert.equal(isIOS('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)', 'iPad', 5), true, 'iPad old UA');
  assert.equal(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'MacIntel', 0), false, 'Desktop Mac');
  assert.equal(isIOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', 'Win32', 0), false, 'Desktop Windows');
  assert.equal(isIOS('Mozilla/5.0 (Linux; Android 13; Pixel 7)', 'Linux armv81', 5), false, 'Android not iOS');

  console.log('  PASS — iOS detection correct');
}

// ── Test 6: escapeHtml XSS prevention ────────────────────────────────────────
function testEscapeHtml() {
  console.log('\n[TEST 6] escapeHtml — XSS prevention');

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  assert.equal(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml('AT&T'), 'AT&amp;T');
  assert.equal(escapeHtml('normal text'), 'normal text');
  assert.equal(escapeHtml('C++ & Java "Developer"'), 'C++ &amp; Java &quot;Developer&quot;');

  console.log('  PASS — HTML entities escaped correctly');
}

// ── Runner ────────────────────────────────────────────────────────────────────
async function runAll() {
  console.log('=== Resume Builder Test Suite ===');
  let passed = 0;
  let failed = 0;

  const tests = [
    testExtractDocxParagraphs,
    () => { testSaveLoadTemplates(); return Promise.resolve(); },
    () => { testTailorParsing(); return Promise.resolve(); },
    testRepackDocx,
    () => { testIosDetection(); return Promise.resolve(); },
    () => { testEscapeHtml(); return Promise.resolve(); },
  ];

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch(e) {
      console.error(`  FAIL: ${e.message}`);
      console.error(e.stack);
      failed++;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runAll();
