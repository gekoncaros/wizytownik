(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const DB = 'wizytownik-v12', STORE = 'contacts';
  let database, mediaStream, facing = 'environment', mode = 'card';
  let draft = {};
  let dbReady = false;
  let liveQrFrame = 0, liveQrBusy = false, liveQrLastAt = 0, scanSequence = 0, imageProcessing = false;
  const scanUtils = window.WizytownikScanUtils;

  const fields = ['name','company','jobTitle','event','email','phone','website','address','tags','notes','rawText'];
  const screens = ['home','scan','edit','crm','admin'];

  function toast(message) {
    const el = $('toast'); el.textContent = message; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  }
  function go(name) {
    screens.forEach(key => $('screen' + key[0].toUpperCase() + key.slice(1)).classList.toggle('hidden', key !== name));
    if (name !== 'scan') stopCamera();
    if (name === 'home' && dbReady) renderRecent();
    if (name === 'crm' && dbReady) renderCrm();
    window.scrollTo(0, 0);
  }
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => { database = request.result; dbReady = true; resolve(); };
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
    const searchable = contact => fields.map(key => contact[key] || '').join(' ').toLowerCase();
    const result = term ? contacts.filter(contact => searchable(contact).includes(term)) : contacts;
    $('count').textContent = result.length + (result.length === 1 ? ' kontakt' : result.length < 5 ? ' kontakty' : ' kontaktów');
    $('crmList').innerHTML = result.length ? result.map(card).join('') : '<p class="empty">Brak kontaktów do wyświetlenia.</p>';
    bindCards();
  }

  async function startCamera(resetDraft = true) {
    if (mediaStream) stopCamera();
    if (resetDraft) {
      scanSequence += 1;
      draft = {};
      $('fileInput').value = '';
    }
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
      if (mode === 'qr') startLiveQrScan();
    } catch (error) {
      $('cameraHelp').textContent = 'Aparat jest niedostępny. Użyj przycisku „Zdjęcie” — otworzy aparat telefonu.';
      $('cameraHelp').classList.remove('hidden');
      $('cameraMessage').textContent = 'Wybierz zdjęcie z aparatu';
    }
  }
  function stopCamera() {
    if (liveQrFrame) cancelAnimationFrame(liveQrFrame);
    liveQrFrame = 0; liveQrBusy = false;
    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  async function flipCamera() {
    facing = facing === 'environment' ? 'user' : 'environment';
    stopCamera(); await startCamera(false);
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
    if (file.type && !file.type.startsWith('image/')) return toast('Wybierz plik graficzny wizytówki.');
    if (file.size > 15 * 1024 * 1024) return toast('Zdjęcie jest zbyt duże. Wybierz plik do 15 MB.');
    const reader = new FileReader();
    reader.onload = () => processImage(reader.result);
    reader.readAsDataURL(file);
  }
  async function imageToCanvas(data, maxSide = 1800) {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = data; });
    const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * ratio));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * ratio));
    canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  function enhanceCanvas(source) {
    const canvas = document.createElement('canvas');
    canvas.width = source.width; canvas.height = source.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray = Math.round(pixels.data[index] * .299 + pixels.data[index + 1] * .587 + pixels.data[index + 2] * .114);
      const contrast = gray < 148 ? Math.max(0, gray - 38) : Math.min(255, (gray - 148) * 1.65 + 148);
      pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = contrast;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  }
  function cropCanvas(source, left, top, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(1200, source.width); canvas.height = Math.round(canvas.width * height / width);
    canvas.getContext('2d', { alpha: false }).drawImage(source, left, top, width, height, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  function decodeQrCanvas(canvas) {
    if (!window.jsQR || !canvas.width || !canvas.height) return '';
    const read = candidate => {
      try {
        const context = candidate.getContext('2d', { willReadFrequently: true });
        const image = context.getImageData(0, 0, candidate.width, candidate.height);
        const result = window.jsQR(image.data, candidate.width, candidate.height, { inversionAttempts: 'attemptBoth' });
        return result ? result.data : '';
      } catch (error) { return ''; }
    };
    let result = read(canvas) || read(enhanceCanvas(canvas));
    if (result) return result;
    const width = Math.round(canvas.width * .62), height = Math.round(canvas.height * .62);
    const positions = [[0, 0], [canvas.width - width, 0], [0, canvas.height - height], [canvas.width - width, canvas.height - height], [Math.round((canvas.width - width) / 2), Math.round((canvas.height - height) / 2)]];
    for (const [left, top] of positions) {
      result = read(cropCanvas(canvas, left, top, width, height));
      if (result) return result;
    }
    return '';
  }
  async function decodeQr(data) {
    try {
      return decodeQrCanvas(await imageToCanvas(data));
    } catch (error) { return ''; }
  }
  async function optimiseImage(data) {
    const canvas = await imageToCanvas(data, 1800);
    return canvas.toDataURL('image/jpeg', .86);
  }
  function setScanStatus(message) {
    $('scanStatus').textContent = message;
    $('scanStatus').classList.remove('hidden');
  }
  function startLiveQrScan() {
    if (mode !== 'qr' || !mediaStream || liveQrFrame) return;
    const video = $('video');
    const loop = () => {
      liveQrFrame = requestAnimationFrame(loop);
      if (liveQrBusy || !video.videoWidth || mode !== 'qr' || performance.now() - liveQrLastAt < 250) return;
      liveQrBusy = true;
      liveQrLastAt = performance.now();
      const canvas = document.createElement('canvas');
      const ratio = Math.min(1, 900 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio);
      canvas.getContext('2d', { alpha: false }).drawImage(video, 0, 0, canvas.width, canvas.height);
      const text = decodeQrCanvas(canvas);
      liveQrBusy = false;
      if (text) {
        draft.qrText = text;
        stopCamera();
        toast('Kod QR odczytany');
        openEdit(Object.assign({}, scanUtils.parseQr(text), draft, { rawText: text }));
      }
    };
    liveQrFrame = requestAnimationFrame(loop);
  }
  function setMode(nextMode) {
    mode = nextMode;
    $('modeCard').classList.toggle('selected', mode === 'card');
    $('modeQr').classList.toggle('selected', mode === 'qr');
    if (mediaStream) {
      $('cameraMessage').textContent = mode === 'qr' ? 'Skaner QR działa automatycznie' : 'Ustaw wizytówkę w ramce';
      if (mode === 'qr') startLiveQrScan(); else if (liveQrFrame) { cancelAnimationFrame(liveQrFrame); liveQrFrame = 0; }
    }
  }
  async function processImage(data) {
    if (imageProcessing) return toast('Poczekaj na przetworzenie zdjęcia.');
    imageProcessing = true;
    const sequence = scanSequence;
    setScanStatus('Przygotowywanie zdjęcia…');
    let picture = data;
    try { picture = await optimiseImage(data); } catch (error) { /* original image remains usable */ }
    if (sequence !== scanSequence) { imageProcessing = false; return; }
    const side = draft.frontImage ? 'backImage' : 'frontImage';
    draft[side] = picture;
    setScanStatus('Szukanie kodu QR…');
    const qr = await decodeQr(picture);
    if (sequence !== scanSequence) { imageProcessing = false; return; }
    if (qr) draft.qrText = qr;
    $('scanStatus').classList.add('hidden');
    const message = qr ? 'Wykryto kod QR — dane uzupełnią się pierwsze.' : mode === 'qr' ? 'Nie znaleziono kodu QR. Spróbuj ponownie, zbliż kod lub użyj lepszego światła.' : side === 'frontImage' ? 'Zapisano przód wizytówki' : 'Zapisano tył wizytówki';
    $('scanPreview').innerHTML = '<img src="' + picture + '" alt="Zdjęcie"><div><strong>' + message + '</strong><br><button id="btnRead" class="link" type="button">Odczytaj i uzupełnij dane</button></div>';
    $('scanPreview').classList.remove('hidden');
    $('btnRead').addEventListener('click', readData);
    imageProcessing = false;
    if (mode === 'qr' && qr) openEdit(Object.assign({}, scanUtils.parseQr(qr), draft, { rawText: qr }));
  }
  async function readData() {
    const pictures = [draft.frontImage, draft.backImage].filter(Boolean);
    if (!pictures.length) return;
    setScanStatus('Odczytywanie danych z wizytówki…');
    const readButton = $('btnRead');
    if (readButton) readButton.disabled = true;
    let text = draft.qrText || '';
    try {
      if (!window.Tesseract) throw new Error('OCR niedostępny');
      for (let index = 0; index < pictures.length; index += 1) {
        const update = event => {
          if (event.status === 'recognizing text' && Number.isFinite(event.progress)) setScanStatus('OCR ' + (index + 1) + '/' + pictures.length + ': ' + Math.round(event.progress * 100) + '%');
        };
        const first = await window.Tesseract.recognize(pictures[index], 'pol+eng', { logger: update, tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
        let pageText = first.data.text || '';
        if (!scanUtils.isUsefulOcr(pageText) || Object.keys(scanUtils.parseText(pageText)).length < 3) {
          const enhanced = enhanceCanvas(await imageToCanvas(pictures[index], 1800)).toDataURL('image/jpeg', .92);
          setScanStatus('Ponowny OCR w trybie wysokiego kontrastu…');
          const retry = await window.Tesseract.recognize(enhanced, 'pol+eng', { logger: update, tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
          pageText = scanUtils.uniqueText(pageText, retry.data.text || '');
        }
        text = scanUtils.uniqueText(text, pageText);
      }
    } catch (error) { toast('OCR niedostępny — możesz wpisać dane ręcznie.'); }
    $('scanStatus').classList.add('hidden');
    if (readButton) readButton.disabled = false;
    openEdit(Object.assign({}, scanUtils.mergeContactData(scanUtils.parseText(text), scanUtils.parseQr(draft.qrText || '')), draft, { rawText: text.trim() }));
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
    } else if (kind === 'vcard') {
      const escapeVcard = value => String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
      const vcard = contacts.map(contact => {
        const names = String(contact.name || '').trim().split(/\s+/);
        const first = names.shift() || '', last = names.join(' ');
        return ['BEGIN:VCARD','VERSION:3.0','N:' + escapeVcard(last) + ';' + escapeVcard(first) + ';;;','FN:' + escapeVcard(contact.name || contact.company || 'Kontakt'),'ORG:' + escapeVcard(contact.company),'TITLE:' + escapeVcard(contact.jobTitle),'TEL;TYPE=WORK,VOICE:' + escapeVcard(contact.phone),'EMAIL;TYPE=INTERNET:' + escapeVcard(contact.email),'URL:' + escapeVcard(contact.website),'ADR;TYPE=WORK:;;' + escapeVcard(contact.address) + ';;;;','NOTE:' + escapeVcard((contact.notes || '') + (contact.event ? ' | Źródło: ' + contact.event : '') + (contact.tags ? ' | Tagi: ' + contact.tags : '')),'END:VCARD'].join('\r\n');
      }).join('\r\n');
      blob = new Blob([vcard], { type: 'text/vcard;charset=utf-8' }); name = 'wizytownik-kontakty.vcf';
    } else { blob = new Blob([JSON.stringify(contacts, null, 2)], { type: 'application/json' }); name = 'wizytownik-backup.json'; }
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
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
  $('modeCard').addEventListener('click', () => setMode('card'));
  $('modeQr').addEventListener('click', () => setMode('qr'));
  $('contactForm').addEventListener('submit', saveForm);
  $('btnDelete').addEventListener('click', removeCurrent);
  $('btnThanks').addEventListener('click', thankYou);
  $('settingsForm').addEventListener('submit', saveSettings);
  $('search').addEventListener('input', renderCrm);
  $('btnVcard').addEventListener('click', () => download('vcard'));
  $('btnCsv').addEventListener('click', () => download('csv'));
  $('btnJson').addEventListener('click', () => download('json'));

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  openDatabase().then(() => go('home')).catch(() => { toast('Nie można otworzyć lokalnej bazy. Tryb CRM jest niedostępny.'); });
})();
