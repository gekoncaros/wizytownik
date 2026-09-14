const DB_NAME = 'wizytownik-db';
const STORE = 'contacts';
let db, stream, facingMode = 'environment';
let draft = { frontImage: null, backImage: null, rawText: '', qrText: '', id: null };
let deferredInstall;
let scanMode = 'card';
const EMAIL_SETTINGS_KEY = 'wizytownik-email-settings';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => { db = request.result; resolve(); };
    request.onerror = () => reject(request.error);
  });
}
function records() {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a,b) => b.updatedAt - a.updatedAt));
    req.onerror = () => reject(req.error);
  });
}
function saveRecord(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
function removeRecord(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}

function showView(id) {
  stopCamera();
  $('.view').forEach(view => {
    const isActive = view.id === id + 'View';
    view.classList.toggle('active', isActive);
    view.style.display = isActive ? 'block' : 'none';
  });
  $('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.action === id));
  if (id === 'home') renderHome();
  if (id === 'library') renderLibrary();
  window.scrollTo({top: 0, behavior: 'auto'});
}
window.wizytownikShowView = showView;
function getEmailSettings() {
  return { senderName: '', replyTo: '', subject: 'Dziękuję za rozmowę', template: 'Dzień dobry {{name}},\n\nDziękuję za rozmowę{{event}}. Miło było poznać {{company}}.\n\nPozdrawiam,\n{{sender}}', ...JSON.parse(localStorage.getItem(EMAIL_SETTINGS_KEY) || '{}') };
}
function fillTemplate(template, contact, settings) {
  const event = contact.event ? ' podczas wydarzenia „' + contact.event + '”' : '';
  return template.replace(/{{name}}/g, contact.name || 'Dzień dobry').replace(/{{company}}/g, contact.company || 'Państwa firmę').replace(/{{event}}/g, event).replace(/{{sender}}/g, settings.senderName || '');
}
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}
function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join('').toUpperCase() || '?';
}
function dateText(t) {
  return new Intl.DateTimeFormat('pl-PL', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }).format(t);
}
function contactCard(c) {
  const title = c.name || c.company || 'Bez nazwy';
  const subtitle = [c.company, c.jobTitle].filter(Boolean).join(' · ') || c.email || c.phone || 'Zeskanowana wizytówka';
  return `<button class="contact-card" data-open="${c.id}">
    <span class="avatar">${initials(title)}</span>
    <span class="contact-main"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small><small class="muted">${dateText(c.updatedAt)}</small></span>
    <span class="chevron">›</span>
  </button>`;
}
async function renderHome() {
  const all = await records();
  $('#recentList').className = 'contact-list' + (all.length ? '' : ' empty-state');
  $('#recentList').innerHTML = all.length ? all.slice(0,4).map(contactCard).join('') : 'Brak zapisanych wizytówek';
  bindCards();
}
async function renderLibrary() {
  const term = $('#searchInput').value.trim().toLowerCase();
  const all = await records();
  const filtered = all.filter(c => Object.values(c).join(' ').toLowerCase().includes(term));
  $('#contactCount').textContent = `${filtered.length} ${filtered.length === 1 ? 'kontakt' : filtered.length < 5 ? 'kontakty' : 'kontaktów'}`;
  $('#libraryList').className = 'contact-list' + (filtered.length ? '' : ' empty-state');
  $('#libraryList').innerHTML = filtered.length ? filtered.map(contactCard).join('') : (term ? 'Nie znaleziono kontaktów.' : 'Tu pojawią się zeskanowane wizytówki.');
  bindCards();
}
function bindCards() {
  $$('[data-open]').forEach(b => b.addEventListener('click', async () => {
    const all = await records(); const record = all.find(c => c.id === b.dataset.open);
    openEditor(record);
  }));
}

async function startCamera() {
  showView('scan');
  $('#cameraStage').classList.remove('hidden');
  $('#scanPreview').classList.add('hidden');
  $('#cameraFallback').classList.add('hidden');
  $('#captureButton').disabled = true;
  $('#cameraHelp').textContent = 'Uruchamianie aparatu…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('UNSUPPORTED');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    const video = $('#cameraVideo');
    video.srcObject = stream;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      setTimeout(() => reject(new Error('VIDEO_TIMEOUT')), 8000);
    });
    await video.play();
    $('#captureButton').disabled = false;
    $('#cameraHelp').textContent = scanMode === 'qr' ? 'Ustaw kod QR w ramce' : (draft.frontImage ? 'Ustaw tył wizytówki w ramce' : 'Ustaw przód wizytówki w ramce');
  } catch (e) {
    console.error('Camera error', e);
    $('#cameraStage').classList.add('hidden');
    $('#cameraFallback').classList.remove('hidden');
    const message = e.name === 'NotAllowedError'
      ? 'Brak zgody na aparat. W Safari wybierz aA → Ustawienia strony → Aparat → Zezwalaj.'
      : 'Nie udało się uruchomić podglądu. Użyj przycisku „Wybierz zdjęcie” — otworzy aparat telefonu.';
    $('#cameraFallback').querySelector('p').textContent = message;
    toast('Użyj aparatu systemowego.');
  }
}
function stopCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
}
async function flipCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  stopCamera(); await startCamera();
}
function captureImage() {
  const video = $('#cameraVideo');
  if (!stream || !video.videoWidth || video.readyState < 2) return toast('Aparat jeszcze się uruchamia — spróbuj za chwilę.');
  const canvas = $('#captureCanvas');
  const max = 1800, ratio = Math.min(1, max / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  handleImage(canvas.toDataURL('image/jpeg', .86));
}
function loadFile(file) {
  if (!file) return;
  const reader = new FileReader(); reader.onload = () => handleImage(reader.result); reader.readAsDataURL(file);
}
async function decodeQr(dataUrl) {
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl; });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const found = await detector.detect(canvas);
      if (found[0]?.rawValue) return found[0].rawValue;
    }
    const result = window.jsQR?.(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
    return result?.data || '';
  } catch (e) { return ''; }
}
function parseQr(text = '') {
  const value = text.trim();
  if (!value) return {};
  if (/BEGIN:VCARD/i.test(value)) {
    const field = name => (value.match(new RegExp('(?:^|\\n)' + name + '(?:;[^:]*)?:(.+)', 'i')) || [,''])[1].replace(/\\n/gi, '\n').trim();
    const phone = field('TEL'); const email = field('EMAIL'); const website = field('URL');
    return { name: field('FN'), company: field('ORG'), jobTitle: field('TITLE'), phone, email, website, address: field('ADR').replace(/;/g, ', '), notes: 'Dane odczytane z kodu QR.' };
  }
  if (/^mailto:/i.test(value)) return { email: value.replace(/^mailto:/i,''), notes: 'Adres odczytany z kodu QR.' };
  if (/^https?:\/\//i.test(value) || /^www\./i.test(value)) return { website: value, notes: 'Strona odczytana z kodu QR.' };
  return { notes: 'Kod QR: ' + value };
}
async function handleImage(dataUrl) {
  const target = draft.frontImage ? 'backImage' : 'frontImage';
  draft[target] = dataUrl;
  const qr = await decodeQr(dataUrl);
  if (qr) { draft.qrText = qr; toast('Wykryto kod QR — dane zostaną uzupełnione.'); }
  $('#scanPreview').innerHTML = `<img src="${dataUrl}" alt="Zdjęcie wizytówki"><div><strong>${target === 'frontImage' ? 'Przód zapisany' : 'Tył zapisany'}</strong><p>${qr ? 'Znaleziono kod QR.' : (target === 'frontImage' ? 'Możesz teraz zrobić zdjęcie drugiej strony lub odczytać dane.' : 'Obie strony zapisane. Odczytuję dane.')}</p></div>`;
  $('#scanPreview').classList.remove('hidden');
  $('#captureButton').classList.add('captured');
  if (scanMode === 'qr' && qr) return openEditor({ ...parseQr(qr), ...draft });
  if (target === 'frontImage') {
    $('#scanPreview').insertAdjacentHTML('beforeend', '<button class="text-button" id="ocrNow">Odczytaj dane teraz</button>');
    $('#ocrNow').onclick = () => runOcr();
  } else await runOcr();
}
async function runOcr() {
  const images = [draft.frontImage, draft.backImage].filter(Boolean);
  if (!images.length) return;
  $('#scanProgress').classList.remove('hidden');
  try {
    let text = '';
    for (const image of images) {
      const result = await Tesseract.recognize(image, 'pol+eng', { logger: m => {
        if (m.status === 'recognizing text') $('#scanProgress span:last-child').textContent = `Odczytywanie… ${Math.round(m.progress * 100)}%`;
      }});
      text += '\n' + result.data.text;
    }
    draft.rawText = text.trim();
    openEditor({ ...parseCard(text), ...parseQr(draft.qrText), ...draft });
  } catch (e) {
    console.error(e);
    toast('OCR nie powiodło się — uzupełnij dane ręcznie.');
    openEditor({ ...draft });
  } finally { $('#scanProgress').classList.add('hidden'); }
}
function parseCard(text) {
  const clean = text.replace(/\r/g,'').split('\n').map(x => x.trim()).filter(Boolean);
  const email = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0] || '';
  const phone = (text.match(/(?:\+?\d[\d\s().-]{7,}\d)/) || [])[0] || '';
  const website = (text.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/[a-z0-9._~:/?#[\]@!$&'()*+,;=%-]*)?/i) || [])[0] || '';
  const useful = clean.filter(l => !l.includes('@') && !l.match(/^\+?[\d\s().-]{8,}$/) && !l.match(/www\.|https?:\/\//i));
  const nameLine = useful.find(l => /^[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż-]+\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż-]+/.test(l)) || useful[0] || '';
  const rest = useful.filter(l => l !== nameLine);
  return { name: nameLine, company: rest[0] || '', jobTitle: rest[1] || '', email, phone, website, address: '', tags: '', notes: '' };
}
function openEditor(record = {}) {
  stopCamera();
  draft = { ...draft, ...record };
  $('#editorTitle').textContent = record.id ? 'Edytuj kontakt' : 'Sprawdź dane';
  $('#deleteButton').classList.toggle('hidden', !record.id);
  $('#thanksButton').classList.toggle('hidden', !record.id || !record.email);
  const form = $('#contactForm');
  ['name','company','event','jobTitle','email','phone','website','address','tags','notes','rawText'].forEach(k => form.elements[k].value = draft[k] || '');
  $('#sideImages').innerHTML = [draft.frontImage, draft.backImage].filter(Boolean).map((src, i) => `<figure><img src="${src}" alt="Strona ${i+1} wizytówki"><figcaption>${i ? 'Tył' : 'Przód'}</figcaption></figure>`).join('');
  showView('editor');
}
async function submitContact(e) {
  e.preventDefault();
  const values = Object.fromEntries(new FormData(e.target).entries());
  const record = { ...draft, ...values, id: draft.id || crypto.randomUUID(), createdAt: draft.createdAt || Date.now(), updatedAt: Date.now() };
  await saveRecord(record); draft = { frontImage:null, backImage:null, rawText:'', qrText:'', id:null };
  toast('Kontakt zapisany'); showView('home');
}
function discardDraft() {
  if (confirm('Odrzucić niezapisany skan?')) { draft = { frontImage:null, backImage:null, rawText:'', qrText:'', id:null }; showView('home'); }
}
function openAdmin() {
  showView('admin');
  try {
    const settings = getEmailSettings();
    const form = $('#emailSettingsForm');
    if (!form) throw new Error('Brak formularza ustawień');
    ['senderName','replyTo','subject','template'].forEach(key => form.elements[key].value = settings[key] || '');
  } catch (error) {
    console.error('Admin settings error', error);
    toast('Panel otwarty, ale ustawienia wymagają odświeżenia strony.');
  }
}
function saveEmailSettings(event) {
  event.preventDefault();
  const settings = Object.fromEntries(new FormData(event.target).entries());
  localStorage.setItem(EMAIL_SETTINGS_KEY, JSON.stringify(settings));
  toast('Konfiguracja podziękowań zapisana');
  showView('home');
}
function sendThanks() {
  if (!draft.email) return toast('Ten kontakt nie ma adresu e-mail.');
  const settings = getEmailSettings();
  const subject = fillTemplate(settings.subject || 'Dziękuję za rozmowę', draft, settings);
  const body = fillTemplate(settings.template, draft, settings);
  window.location.href = 'mailto:' + encodeURIComponent(draft.email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}
function csvCell(value) { return '"' + String(value || '').replace(/"/g, '""') + '"'; }
async function exportData(type) {
  const all = await records();
  if (!all.length) return toast('Brak danych do eksportu.');
  let blob, name;
  if (type === 'csv') {
    const keys = ['name','company','event','jobTitle','email','phone','website','address','tags','notes','qrText','createdAt'];
    const rows = [keys.join(';'), ...all.map(c => keys.map(k => k === 'createdAt' ? csvCell(new Date(c[k]).toLocaleString('pl-PL')) : csvCell(c[k])).join(';'))];
    blob = new Blob(['\uFEFF' + rows.join('\n')], {type:'text/csv;charset=utf-8'}); name = 'wizytownik-kontakty.csv';
  } else { blob = new Blob([JSON.stringify(all, null, 2)], {type:'application/json'}); name = 'wizytownik-backup.json'; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
async function deleteCurrent() {
  if (!draft.id || !confirm('Usunąć ten kontakt?')) return;
  await removeRecord(draft.id); toast('Kontakt usunięty'); draft = {frontImage:null,backImage:null,rawText:'',qrText:'',id:null}; showView('library');
}

document.addEventListener('click', e => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  const actions = { home: () => showView('home'), library: () => showView('library'), admin: openAdmin, 'start-scan': startCamera, camera: startCamera, 'flip-camera': flipCamera, 'pick-image': () => $('#imagePicker').click(), discard: discardDraft, 'export-csv': () => exportData('csv'), 'export-json': () => exportData('json'), 'delete-current': deleteCurrent, 'send-thanks': sendThanks };
  actions[action]?.();
});
$('#captureButton').addEventListener('click', captureImage);
$('#imagePicker').addEventListener('change', e => loadFile(e.target.files[0]));
$('#contactForm').addEventListener('submit', submitContact);
$('#adminButton').addEventListener('click', event => { event.stopPropagation(); openAdmin(); });
$('#emailSettingsForm').addEventListener('submit', saveEmailSettings);
$$('[data-mode]').forEach(button => button.addEventListener('click', () => {
  scanMode = button.dataset.mode;
  $$('[data-mode]').forEach(b => b.classList.toggle('active', b === button));
  $('#cameraHelp').textContent = scanMode === 'qr' ? 'Ustaw kod QR w ramce' : 'Ustaw wizytówkę w ramce';
}));
$('#searchInput').addEventListener('input', renderLibrary);
$('#filterButton').addEventListener('click', () => $('#searchInput').focus());
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('#installButton').classList.remove('hidden'); });
$('#installButton').addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('#installButton').classList.add('hidden'); });
window.addEventListener('appinstalled', () => toast('Wizytownik zainstalowany'));
// Service worker intentionally disabled during mobile testing to avoid stale cached versions.
openDb().then(renderHome).catch(() => toast('Nie udało się otworzyć lokalnej bazy.'));
