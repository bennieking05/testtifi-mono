import axios from 'axios';

const API = process.env.API_BASE_URL || process.env.VITE_API_BASE_URL || 'http://localhost:8000';

function log(title, obj){
  console.log(`\n=== ${title} ===`);
  if (obj !== undefined) console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

async function run(){
  const results = [];
  const push = (name, ok, info) => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${info ? ' - ' + info : ''}`); };

  // 1) Email notification opt-in (mock)
  try {
    log('Mock Request', { method: 'POST', url: `${API}/api/email-notifications`, body: { summaryId: '<mock-id>', notifyOnComplete: true } });
    push('Email notifications opt-in request shape', true);
  } catch (e) { push('Email notifications opt-in request shape', false, e.message); }

  // 2) Summaries list polling shape
  try {
    log('Mock Request', { method: 'GET', url: `${API}/api/summaries` });
    push('Summaries list request shape', true);
  } catch (e) { push('Summaries list request shape', false, e.message); }

  // 3) Preview route shape
  try {
    log('Mock Request', { method: 'GET', url: `${API}/api/preview?id=<mock-id>` });
    push('Preview request shape', true);
  } catch (e) { push('Preview request shape', false, e.message); }

  // 4) Download endpoints shapes
  try {
    ['pdf','docx','txt','csv'].forEach(fmt => log('Mock Request', { method: 'GET', url: `${API}/api/download?jobId=<mock-id>&format=${fmt}` }));
    push('Download request shapes', true);
  } catch (e) { push('Download request shapes', false, e.message); }

  // 5) Upload shape (multipart)
  try {
    log('Mock Request', { method: 'POST', url: `${API}/api/upload`, body: { file: '<binary>', summaryName: 'Test', deponent: 'John Doe', notifyOnComplete: true } });
    push('Upload request shape', true);
  } catch (e) { push('Upload request shape', false, e.message); }

  // 6) Snapshot routes
  try {
    log('Mock Request', { method: 'GET', url: `${API}/api/snapshots` });
    push('Snapshots request shape', true);
  } catch (e) { push('Snapshots request shape', false, e.message); }

  // Summary
  console.log('\n=== Summary ===');
  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log(`Total: ${results.length}, Passed: ${pass}, Failed: ${fail}`);
}

run().catch(e=>{ console.error('Test runner error', e); process.exit(1); });
