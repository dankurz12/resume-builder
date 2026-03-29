import JSZip from 'jszip';
import { writeFileSync } from 'fs';

const resumeXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Jane Smith</w:t></w:r></w:p>
    <w:p><w:r><w:t>jane.smith@email.com | (555) 123-4567 | linkedin.com/in/janesmith</w:t></w:r></w:p>
    <w:p><w:r><w:t></w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>PROFESSIONAL SUMMARY</w:t></w:r></w:p>
    <w:p><w:r><w:t>Results-driven software engineer with 5 years of experience building scalable web applications.</w:t></w:r></w:p>
    <w:p><w:r><w:t></w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>EXPERIENCE</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Senior Software Engineer</w:t></w:r><w:r><w:t> — Acme Corp (2021–Present)</w:t></w:r></w:p>
    <w:p><w:r><w:t>• Led migration of monolithic app to microservices, reducing latency by 40%</w:t></w:r></w:p>
    <w:p><w:r><w:t>• Built real-time dashboard serving 50K daily active users</w:t></w:r></w:p>
    <w:p><w:r><w:t>• Mentored 3 junior engineers and conducted weekly code reviews</w:t></w:r></w:p>
    <w:p><w:r><w:t></w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Software Engineer</w:t></w:r><w:r><w:t> — StartupXYZ (2019–2021)</w:t></w:r></w:p>
    <w:p><w:r><w:t>• Developed React frontend for SaaS product used by 200+ enterprise clients</w:t></w:r></w:p>
    <w:p><w:r><w:t>• Implemented CI/CD pipeline cutting deployment time from 2 hours to 8 minutes</w:t></w:r></w:p>
    <w:p><w:r><w:t></w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>SKILLS</w:t></w:r></w:p>
    <w:p><w:r><w:t>JavaScript, TypeScript, React, Node.js, Python, AWS, Docker, Kubernetes</w:t></w:r></w:p>
    <w:p><w:r><w:t></w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>EDUCATION</w:t></w:r></w:p>
    <w:p><w:r><w:t>B.S. Computer Science — State University (2019)</w:t></w:r></w:p>
  </w:body>
</w:document>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

const zip = new JSZip();
zip.file('[Content_Types].xml', contentTypes);
zip.file('_rels/.rels', rels);
zip.file('word/document.xml', resumeXml);
zip.file('word/_rels/document.xml.rels', wordRels);

const buffer = await zip.generateAsync({
  type: 'nodebuffer',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
});
writeFileSync('/home/user/resume-builder/sample-resume.docx', buffer);
console.log('Created sample-resume.docx:', buffer.length, 'bytes (21 paragraphs)');
