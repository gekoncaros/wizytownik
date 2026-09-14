(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const DB = 'wizytownik-v12', STORE = 'contacts';
  let database, mediaStream, facing = 'environment', mode = 'card';
  let draft = {};

  const fields = ['name','company','jobTitle','event','email','phone','website','address','tags','notes','rawText'];
  const screens = ['home','scan','edit','crm','admin'];

  function toast(message) {
    const el = $('toast'); el.textContent = message; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  }
  function go(name) {
    screens.forEach(key => $('screen' + key[0].toUpperCase() + key.slice(1)).classList.toggle('hidden', key !== name));
    if (name !== 'scan') stopCamera();
    if (name === 'home') renderRecent();
    if (name === 'crm') renderCrm();
    window.scrollTo(0, 0);
  }
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => { database = request.result; resolve(); };
      request.onerror = () => reject(request.error);
    });
  }
  function allContacts() {
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result.sort((a,b) => b.updatedAt - a.updatedAt));
      request.onerror = () => reject(request.error);
    });
  }
  function putContact(contact) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(contact);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  }
  function deleteContact(id) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  }
  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function card(contact) {
    const title = contact.name || contact.company || 'Bez nazwy';
    const sub = [contact.company, contact.jobTitle, contact.email || contact.phone].filter(Boolean).join(' · ') || 'Zeskanowana wizytówka';
    const initials = title.split(/\s+/).slice(0,2).map(x => x[0]).join('').toUpperCase();
    return '<button class="card" type="button" data-contact="' + contact.id + '"><span class="avatar">' + escapeHtml(initials) + '</span><div><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(sub) + '</small></div><b>›</b></button>';
  }
  function bindCards() {
    document.querySelectorAll('[data-contact]').forEach(button => button.addEventListener('click', async () => {
      const contacts = await allContacts();
      const contact = contacts.find(item => item.id === button.dataset.contact);
      if (contact) openEdit(contact);
    }));
  }
  async function renderRecent() {
    const contacts = await allContacts();
    $('recentList').innerHTML = contacts.length ? contacts.slice(0,4).map(card).join('') : '<p class="empty">Brak zapisanych wizytówek.</p>';
    bindCards();
  }
  async function renderCrm() {
    const term = $('search').value.trim().toLowerCase();
    const contacts = await allContacts();
    const result = contacts.filter(contact => Object.values(contact).join(' ').toLowerCase().includes(term));
    $('count').textContent = result.length + (result.length === 1 ? ' kontakt' : result.length < 5 ? ' kontakty' : ' kontaktów');
    $('crmList').innerHTML = result.length ? result.map(card).join('') : '<p class="empty">Brak kontaktów do wyświetlenia.</p>';
    bindCards();
  }

  async function startCamera() {
    go('scan');
    $('cameraHelp').classList.add('hidden');
    $('scanPreview').classList.add('hidden');
    $('cameraMessage').textContent = 'Uruchamianie aparatu…';
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Brak obsługi aparatu');
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 } }, audio: false });
      const video = $('video'); video.srcObject = mediaStream;
      await video.play();
      $('cameraMessage').textContent = mode === 'qr' ? 'Ustaw kod QR w ramce' : 'Ustaw wizytówkę w ramce';
    } catch (error) {
      $('cameraHelp').textContent = 'Aparat jest niedostępny. Użyj przycisku „Zdjęcie” — otworzy aparat telefonu.';
      $('cameraHelp').classList.remove('hidden');
      $('cameraMessage').textContent = 'Wybierz zdjęcie z aparatu';
    }
  }
  function stopCamera() {
    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  async function flipCamera() {
    facing = facing === 'environment' ? 'user' : 'environment';
    stopCamera(); await startCamera();
  }
  function capture() {
    const video = $('video');
    if (!video.videoWidth) return toast('Aparat jeszcze się uruchamia.');
    const canvas = $('canvas');
    const scale = Math.min(1, 1800 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    processImage(canvas.toDataURL('image/jpeg', .88));
  }
  function loadImage(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => processImage(reader.result);
    reader.readAsDataURL(file);
  }
  async function decodeQr(data) {
    try {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = data; });
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const result = window.jsQR && window.jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
      return result ? result.data : '';
    } catch (error) { return ''; }
  }
  function parseQr(text) {
    const result = {};
    if (/BEGIN:VCARD/i.test(text)) {
      const get = key => ((text.match(new RegExp('(?:^|\\n)' + key + '(?:;[^:]*)?:(.+)', 'i')) || ['', ''])[1]).trim();
      result.name = get('FN'); result.company = get('ORG'); result.jobTitle = get('TITLE');
      result.email = get('EMAIL'); result.phone = get('TEL'); result.website = get('URL');
      result.address = get('ADR').replace(/;/g, ', '); result.notes = 'Dane odczytane z QR.';
    } else if (/^mailto:/i.test(text)) result.email = text.replace(/^mailto:/i, '');
    else if (/^https?:\/\//i.test(text) || /^www\./i.test(text)) result.website = text;
    return result;
  }
  function parseText(text) {
    const lines = text.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
    const email = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0];
    const phone = (text.match(/(?:\+?\d[\d\s().-]{7,}\d)/) || [''])[0];
    const website = (text.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}/i) || [''])[0];
    const name = lines.find(line => /^[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż-]+\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż-]+/.test(line)) || '';
    return { name, company: lines.find(line => line !== name && !line.includes('@')) || '', email, phone, website };
  }
  async function processImage(data) {
    const side = draft.frontImage ? 'backImage' : 'frontImage';
    draft[side] = data;
    const qr = await decodeQr(data);
    if (qr) draft.qrText = qr;
    $('scanPreview').innerHTML = '<img src="' + data + '" alt="Zdjęcie"><div><strong>' + (qr ? 'Wykryto kod QR' : side === 'frontImage' ? 'Zapisano przód' : 'Zapisano tył') + '</strong><br><button id="btnRead" class="link" type="button">Odczytaj i uzupełnij dane</button></div>';
    $('scanPreview').classList.remove('hidden');
    $('btnRead').addEventListener('click', readData);
    if (mode === 'qr' && qr) openEdit(Object.assign({}, parseQr(qr), draft, { rawText: qr }));
  }
  async function readData() {
    const pictures = [draft.frontImage, draft.backImage].filter(Boolean);
    if (!pictures.length) return;
    $('scanStatus').textContent = 'Odczytywanie danych…';
    $('scanStatus').classList.remove('hidden');
    let text = draft.qrText || '';
    try {
      if (!window.Tesseract) throw new Error('OCR niedostępny');
      for (const picture of pictures) {
        const result = await window.Tesseract.recognize(picture, 'pol+eng');
        text += '\n' + result.data.text;
      }
    } catch (error) { toast('OCR niedostępny — możesz wpisać dane ręcznie.'); }
    $('scanStatus').classList.add('hidden');
    openEdit(Object.assign({}, parseText(text), parseQr(draft.qrText || ''), draft, { rawText: text.trim() }));
  }

  function openEdit(contact) {
    stopCamera();
    draft = Object.assign({}, contact);
    $('editTitle').textContent = contact.id ? 'Edytuj kontakt' : 'Sprawdź dane';
    fields.forEach(field => $('contactForm').elements[field].value = contact[field] || '');
    $('photos').innerHTML = [contact.frontImage, contact.backImage].filter(Boolean).map(src => '<img src="' + src + '" alt="Wizytówka">').join('');
    $('btnDelete').classList.toggle('hidden', !contact.id);
    $('btnThanks').classList.toggle('hidden', !contact.id || !contact.email);
    go('edit');
  }
  async function saveForm(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const contact = Object.assign({}, draft, values, {
      id: draft.id || (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'c-' + Date.now()),
      createdAt: draft.createdAt || Date.now(), updatedAt: Date.now()
    });
    await putContact(contact);
    draft = {};
    toast('Kontakt zapisany'); go('crm');
  }
  async function removeCurrent() {
    if (!draft.id || !confirm('Usunąć kontakt?')) return;
    await deleteContact(draft.id); draft = {}; toast('Kontakt usunięty'); go('crm');
  }
  function settings() {
    const base = { senderName: '', replyTo: '', subject: 'Dziękuję za rozmowę', template: 'Dzień dobry {{name}},\n\nDziękuję za rozmowę{{event}}.\n\nPozdrawiam,\n{{sender}}' };
    try { return Object.assign(base, JSON.parse(localStorage.getItem('wizytownik-settings') || '{}')); } catch (error) { return base; }
  }
  function openAdmin() {
    const data = settings(), form = $('settingsForm');
    ['senderName','replyTo','subject','template'].forEach(key => form.elements[key].value = data[key] || '');
    go('admin');
  }
  function saveSettings(event) {
    event.preventDefault();
    localStorage.setItem('wizytownik-settings', JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())));
    toast('Konfiguracja zapisana'); go('home');
  }
  function thankYou() {
    if (!draft.email) return toast('Brak adresu e-mail.');
    const data = settings();
    const eventText = draft.event ? ' podczas wydarzenia „' + draft.event + '”' : '';
    const fill = value => String(value || '').replace(/{{name}}/g, draft.name || 'Dzień dobry').replace(/{{company}}/g, draft.company || '').replace(/{{event}}/g, eventText).replace(/{{sender}}/g, data.senderName || '');
    location.href = 'mailto:' + encodeURIComponent(draft.email) + '?subject=' + encodeURIComponent(fill(data.subject)) + '&body=' + encodeURIComponent(fill(data.template));
  }
  async function download(kind) {
    const contacts = await allContacts();
    if (!contacts.length) return toast('Brak danych do eksportu.');
    let blob, name;
    if (kind === 'csv') {
      const keys = ['name','company','jobTitle','event','email','phone','website','address','tags','notes'];
      const quote = value => '"' + String(value || '').replace(/"/g, '""') + '"';
      const csv = [keys.join(';')].concat(contacts.map(contact => keys.map(key => quote(contact[key])).join(';'))).join('\n');
      blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }); name = 'wizytownik.csv';
    } else { blob = new Blob([JSON.stringify(contacts, null, 2)], { type: 'application/json' }); name = 'wizytownik-backup.json'; }
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); URL.revokeObjectURL(link.href);
  }

  $('btnStartScan').addEventListener('click', startCamera);
  $('navScan').addEventListener('click', startCamera);
  $('btnOpenCrm').addEventListener('click', () => go('crm'));
  $('navCrm').addEventListener('click', () => go('crm'));
  $('navHome').addEventListener('click', () => go('home'));
  $('btnAdmin').addEventListener('click', openAdmin);
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => go(button.dataset.go)));
  $('btnFlip').addEventListener('click', flipCamera);
  $('btnCapture').addEventListener('click', capture);
  $('fileInput').addEventListener('change', event => loadImage(event.target.files[0]));
  $('modeCard').addEventListener('click', () => { mode = 'card'; $('modeCard').classList.add('selected'); $('modeQr').classList.remove('selected'); });
  $('modeQr').addEventListener('click', () => { mode = 'qr'; $('modeQr').classList.add('selected'); $('modeCard').classList.remove('selected'); });
  $('contactForm').addEventListener('submit', saveForm);
  $('btnDelete').addEventListener('click', removeCurrent);
  $('btnThanks').addEventListener('click', thankYou);
  $('settingsForm').addEventListener('submit', saveSettings);
  $('search').addEventListener('input', renderCrm);
  $('btnCsv').addEventListener('click', () => download('csv'));
  $('btnJson').addEventListener('click', () => download('json'));

  openDatabase().then(() => go('home')).catch(() => { toast('Nie można otworzyć lokalnej bazy.'); go('home'); });
})();