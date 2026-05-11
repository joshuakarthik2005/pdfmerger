import './style.css';

const $ = s => document.querySelector(s);
const files = []; 
let merging = false, mergedBlob = null, mergedBlobUrl = null;

const dropzone = $('#dropzone'), fileInput = $('#fileInput'), fileList = $('#fileList'),
      fileSection = $('#fileSection'), fileCount = $('#fileCount'), fileSummary = $('#fileSummary'),
      actionBtn = $('#actionBtn'), actionBtnText = $('#actionBtnText'), dlBtn = $('#dlBtn'),
      progressWrap = $('#progressWrap'), progressBar = $('#progressBar'), progressText = $('#progressText'),
      clearBtn = $('#clearBtn'), viewerEmpty = $('#viewerEmpty'), viewerDiv = $('#viewerDiv'),
      toastContainer = $('#toastContainer');

const DB_NAME = 'pdfMergerDB', DB_STORE = 'files', DB_VER = 1;

// Helper to ensure URL starts with http
const ensureHttp = url => (url && !url.startsWith('http')) ? 'https://' + url : url;

// Get the API URL from Vite's env variables (fallback to localhost for development if undefined)
const API_URL = ensureHttp(import.meta.env.VITE_API_URL) || 'http://localhost:5000/api';
const PYTHON_API_URL = ensureHttp(import.meta.env.VITE_PYTHON_API_URL) || 'http://localhost:5001/api';

// ===== State =====
let currentMode = 'merge'; // 'merge' | 'sign'
let signTargetPdf = null;
let sigMode = 'draw'; // 'draw' | 'upload'
let sigImageFile = null;

// ===== IndexedDB =====
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => { console.error('IndexedDB open error', e); rej(e); };
  });
}

async function saveSession() {
  try {
    const data = [];
    for (const f of files) {
      const buf = await f.file.arrayBuffer();
      data.push({ name: f.name, size: f.size, buf: new Uint8Array(buf) });
    }
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onerror = e => reject(e);
      req.onsuccess = e => {
        const db = e.target.result;
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(data, 'savedPDFs');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = ev => { db.close(); reject(ev); };
      };
    });
  } catch (e) {
    console.error('IndexedDB save failed', e);
  }
}

async function loadSession() {
  try {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, 'readonly');
    const st = tx.objectStore(DB_STORE);
    return new Promise((res, rej) => {
      const r = st.get('savedPDFs');
      r.onsuccess = () => { db.close(); res(r.result || []); };
      r.onerror = e => { db.close(); res([]); };
    });
  } catch (e) { return []; }
}

async function clearSession() {
  try {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete('savedPDFs');
    return new Promise(r => { tx.oncomplete = () => { db.close(); r(); }; });
  } catch (e) {}
}

// ===== Helpers =====
function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

const TI = {
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
};

function toast(msg, type = 'error') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = TI[type] + msg;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

function updateUI() {
  if (currentMode === 'merge') {
    const n = files.length;
    fileSection.style.display = n ? 'block' : 'none';
    const ts = files.reduce((s, f) => s + f.size, 0);
    fileCount.textContent = n + ' file' + (n !== 1 ? 's' : '');
    fileSummary.textContent = n ? n + ' file' + (n !== 1 ? 's' : '') + ' · ' + fmtSize(ts) : '';
    actionBtn.disabled = n < 2 || merging;
    if (!merging) actionBtnText.textContent = n < 2 ? 'Add at least 2 PDFs' : 'Merge ' + n + ' PDFs';
  } else {
    fileSection.style.display = 'none';
    const isReady = signTargetPdf && (sigMode === 'draw' ? isCanvasDrawn() : sigImageFile);
    actionBtn.disabled = !isReady || merging;
    if (!merging) actionBtnText.textContent = 'Sign PDF';
  }
}

function renderList() {
  fileList.innerHTML = '';
  files.forEach((f, i) => {
    const el = document.createElement('div');
    el.className = 'file-item'; 
    el.draggable = true; 
    el.dataset.index = i; 
    el.tabIndex = 0;
    
    let meta = `<span>${fmtSize(f.size)}</span>`;
    
    el.innerHTML = `
      <div class="drag-handle">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="3" r="1.2"/><circle cx="11" cy="3" r="1.2"/>
          <circle cx="5" cy="8" r="1.2"/><circle cx="11" cy="8" r="1.2"/>
          <circle cx="5" cy="13" r="1.2"/><circle cx="11" cy="13" r="1.2"/>
        </svg>
      </div>
      <div class="file-ico">PDF</div>
      <div class="file-info">
        <div class="file-name" title="${f.name}">${f.name}</div>
        <div class="file-meta">${meta}</div>
      </div>
      <button class="file-remove" data-idx="${i}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>`;
    fileList.appendChild(el);
  });
  updateUI();
}

async function addFiles(incoming) {
  let added = 0;
  for (const file of incoming) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast(file.name + ' is not a PDF.');
      continue;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast(file.name + ' exceeds 50 MB.', 'warn');
      continue;
    }
    if (files.some(f => f.name === file.name && f.size === file.size)) {
      toast(file.name + ' already added.', 'warn');
      continue;
    }
    
    files.push({ file, name: file.name, size: file.size });
    added++;
  }
  if (added) toast(added + ' file' + (added > 1 ? 's' : '') + ' added.', 'success');
  renderList();
  await saveSession();
}

// ===== Dropzone =====
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', e => { if (e.key === 'Enter') fileInput.click(); });
fileInput.addEventListener('change', () => { 
  if (fileInput.files.length) { 
    addFiles([...fileInput.files]); 
    fileInput.value = ''; 
  } 
});
let dc = 0;
dropzone.addEventListener('dragenter', e => { e.preventDefault(); dc++; dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', e => { e.preventDefault(); dc--; if (!dc) dropzone.classList.remove('drag-over'); });
dropzone.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
dropzone.addEventListener('drop', e => { e.preventDefault(); dc = 0; dropzone.classList.remove('drag-over'); if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });

// ===== Drag reorder =====
let dragIdx = null;
fileList.addEventListener('dragstart', e => {
  const it = e.target.closest('.file-item'); if (!it) return;
  dragIdx = +it.dataset.index;
  it.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragIdx);
});
fileList.addEventListener('dragend', e => {
  const it = e.target.closest('.file-item'); if (it) it.classList.remove('dragging');
  document.querySelectorAll('.file-item').forEach(el => el.classList.remove('drag-target'));
  dragIdx = null;
});
fileList.addEventListener('dragover', e => {
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  const it = e.target.closest('.file-item');
  document.querySelectorAll('.file-item').forEach(el => el.classList.remove('drag-target'));
  if (it && +it.dataset.index !== dragIdx) it.classList.add('drag-target');
});
fileList.addEventListener('drop', e => {
  e.preventDefault();
  const it = e.target.closest('.file-item'); if (!it || dragIdx === null) return;
  const ti = +it.dataset.index; if (ti === dragIdx) return;
  const [m] = files.splice(dragIdx, 1);
  files.splice(ti, 0, m);
  renderList();
  saveSession();
});

// ===== Keyboard reorder =====
fileList.addEventListener('keydown', e => {
  const it = e.target.closest('.file-item'); if (!it) return;
  const idx = +it.dataset.index;
  if (e.key === 'ArrowUp' && idx > 0) {
    e.preventDefault();
    const [m] = files.splice(idx, 1);
    files.splice(idx - 1, 0, m);
    renderList(); saveSession();
    setTimeout(() => { const items = fileList.querySelectorAll('.file-item'); if (items[idx - 1]) items[idx - 1].focus(); }, 50);
  } else if (e.key === 'ArrowDown' && idx < files.length - 1) {
    e.preventDefault();
    const [m] = files.splice(idx, 1);
    files.splice(idx + 1, 0, m);
    renderList(); saveSession();
    setTimeout(() => { const items = fileList.querySelectorAll('.file-item'); if (items[idx + 1]) items[idx + 1].focus(); }, 50);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault(); removeFile(idx);
  }
});

function removeFile(idx) {
  const name = files[idx].name;
  const el = fileList.querySelectorAll('.file-item')[idx];
  if (el) {
    el.classList.add('removing');
    setTimeout(() => { files.splice(idx, 1); renderList(); saveSession(); toast(name + ' removed.', 'warn'); }, 250);
  } else {
    files.splice(idx, 1); renderList(); saveSession(); toast(name + ' removed.', 'warn');
  }
}
fileList.addEventListener('click', e => { const btn = e.target.closest('.file-remove'); if (btn) removeFile(+btn.dataset.idx); });
clearBtn.addEventListener('click', () => { if (!files.length) return; files.length = 0; renderList(); clearSession(); toast('All files cleared.', 'warn'); });

// ===== Mode Switcher =====
$('#modeMergeBtn').onclick = () => setMode('merge');
$('#modeSignBtn').onclick = () => setMode('sign');

function setMode(m) {
  currentMode = m;
  if (m === 'merge') {
    $('#modeMergeBtn').classList.add('active');
    $('#modeSignBtn').classList.remove('active');
    $('#mergeMode').style.display = 'block';
    $('#signMode').style.display = 'none';
    $('#modeSub').textContent = 'Merge PDFs via secure backend API';
    // Hide signature overlay when in merge mode
    $('#sigDraggable').style.display = 'none';
    // Restore viewer to empty state if no merge result
    if (!mergedBlobUrl) {
      viewerDiv.style.display = 'none';
      viewerEmpty.style.display = 'flex';
    }
  } else {
    $('#modeSignBtn').classList.add('active');
    $('#modeMergeBtn').classList.remove('active');
    $('#signMode').style.display = 'block';
    $('#mergeMode').style.display = 'none';
    $('#modeSub').textContent = 'Digitally sign a single PDF';
    // If a PDF is loaded for signing, show its preview + overlay
    if (signPdfBlobUrl) {
      showInViewer(signPdfBlobUrl);
      $('#sigDraggable').style.display = 'block';
    }
  }
  updateUI();
}

// ===== Sign Mode Logic =====
$('#signPdfDropzone').onclick = () => $('#signPdfInput').click();
$('#signPdfInput').onchange = e => handleSignPdfDrop(e.target.files[0]);

$('#signPdfDropzone').ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; $('#signPdfDropzone').classList.add('drag-over'); };
$('#signPdfDropzone').ondragleave = e => { e.preventDefault(); $('#signPdfDropzone').classList.remove('drag-over'); };
$('#signPdfDropzone').ondrop = e => { e.preventDefault(); $('#signPdfDropzone').classList.remove('drag-over'); if (e.dataTransfer.files[0]) handleSignPdfDrop(e.dataTransfer.files[0]); };
let signPdfBlobUrl = null;

function handleSignPdfDrop(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return toast('Target must be a PDF.');
  signTargetPdf = file;
  $('#signPdfDropzone').style.display = 'none';
  $('#signPdfInfo').style.display = 'block';
  $('#signPdfName').textContent = file.name + ' (' + fmtSize(file.size) + ')';
  
  // Show PDF in the right viewer using native browser rendering
  if (signPdfBlobUrl) URL.revokeObjectURL(signPdfBlobUrl);
  signPdfBlobUrl = URL.createObjectURL(file);
  showInViewer(signPdfBlobUrl);
  
  // Show draggable signature overlay
  const dragBox = $('#sigDraggable');
  dragBox.style.display = 'block';
  dragBox.style.width = '20%';
  dragBox.style.height = '6%';
  dragBox.style.left = '60%';
  dragBox.style.top = '80%';
  updateSignaturePreview();
  updateHiddenPositionFields();
  
  updateUI();
}

$('#clearSignPdfBtn').onclick = () => {
  signTargetPdf = null;
  if (signPdfBlobUrl) { URL.revokeObjectURL(signPdfBlobUrl); signPdfBlobUrl = null; }
  $('#sigDraggable').style.display = 'none';
  viewerDiv.style.display = 'none';
  viewerEmpty.style.display = 'flex';
  $('#signPdfDropzone').style.display = 'block';
  $('#signPdfInfo').style.display = 'none';
  $('#signPdfInput').value = '';
  updateUI();
};

// ===== Draggable Signature Overlay =====
const dragBox = $('#sigDraggable');
const viewer = document.querySelector('.viewer');
let isDragging = false, isResizing = false;
let startX, startY, startLeft, startTop, startWidth, startHeight;

dragBox.addEventListener('mousedown', (e) => {
  if (e.target.id === 'sigResizeHandle') isResizing = true;
  else isDragging = true;
  startX = e.clientX;
  startY = e.clientY;
  startLeft = dragBox.offsetLeft;
  startTop = dragBox.offsetTop;
  startWidth = dragBox.offsetWidth;
  startHeight = dragBox.offsetHeight;
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging && !isResizing) return;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  
  if (isDragging) {
    let newLeft = startLeft + dx;
    let newTop = startTop + dy;
    newLeft = Math.max(0, Math.min(newLeft, viewer.clientWidth - dragBox.offsetWidth));
    newTop = Math.max(0, Math.min(newTop, viewer.clientHeight - dragBox.offsetHeight));
    dragBox.style.left = newLeft + 'px';
    dragBox.style.top = newTop + 'px';
  } else if (isResizing) {
    let newWidth = Math.max(30, Math.min(startWidth + dx, viewer.clientWidth - dragBox.offsetLeft));
    let newHeight = Math.max(20, Math.min(startHeight + dy, viewer.clientHeight - dragBox.offsetTop));
    dragBox.style.width = newWidth + 'px';
    dragBox.style.height = newHeight + 'px';
  }
  updateHiddenPositionFields();
});

window.addEventListener('mouseup', () => { isDragging = false; isResizing = false; });

function updateHiddenPositionFields() {
  const cWidth = viewer.clientWidth;
  const cHeight = viewer.clientHeight;
  if (!cWidth || !cHeight) return;
  $('#signX').value = ((dragBox.offsetLeft / cWidth) * 100).toFixed(2);
  $('#signY').value = ((dragBox.offsetTop / cHeight) * 100).toFixed(2);
  $('#signWidth').value = ((dragBox.offsetWidth / cWidth) * 100).toFixed(2);
}

function updateSignaturePreview() {
  if (sigMode === 'draw' && hasDrawn) {
    dragBox.style.backgroundImage = 'url(' + sigCanvas.toDataURL('image/png') + ')';
  } else if (sigMode === 'upload' && sigImageFile) {
    dragBox.style.backgroundImage = 'url(' + URL.createObjectURL(sigImageFile) + ')';
  } else {
    dragBox.style.backgroundImage = 'none';
  }
}

// Signature mode switcher
$('#sigDrawBtn').onclick = () => setSigMode('draw');
$('#sigUploadBtn').onclick = () => setSigMode('upload');
function setSigMode(m) {
  sigMode = m;
  if (m === 'draw') {
    $('#sigDrawBtn').classList.add('active'); $('#sigUploadBtn').classList.remove('active');
    $('#sigDrawArea').style.display = 'block'; $('#sigUploadArea').style.display = 'none';
  } else {
    $('#sigUploadBtn').classList.add('active'); $('#sigDrawBtn').classList.remove('active');
    $('#sigUploadArea').style.display = 'block'; $('#sigDrawArea').style.display = 'none';
  }
  updateUI();
}

// Signature Canvas
const sigCanvas = $('#sigCanvas');
const ctx = sigCanvas.getContext('2d');
let drawing = false;
let hasDrawn = false;
ctx.lineWidth = 3;
ctx.lineCap = 'round';
ctx.strokeStyle = '#000';

function getPos(e) {
  const rect = sigCanvas.getBoundingClientRect();
  const cX = e.clientX || (e.touches && e.touches[0].clientX);
  const cY = e.clientY || (e.touches && e.touches[0].clientY);
  const scaleX = sigCanvas.width / rect.width;
  const scaleY = sigCanvas.height / rect.height;
  return { x: (cX - rect.left) * scaleX, y: (cY - rect.top) * scaleY };
}
sigCanvas.onmousedown = sigCanvas.ontouchstart = e => { e.preventDefault(); drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
sigCanvas.onmousemove = sigCanvas.ontouchmove = e => { if (!drawing) return; e.preventDefault(); const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasDrawn = true; updateUI(); };
window.addEventListener('mouseup', () => drawing = false);
window.addEventListener('touchend', () => drawing = false);

$('#clearSigBtn').onclick = () => { ctx.clearRect(0,0,sigCanvas.width,sigCanvas.height); hasDrawn = false; updateUI(); };
function isCanvasDrawn() { return hasDrawn; }

// Signature Upload
$('#sigImgDropzone').onclick = () => $('#sigImgInput').click();
$('#sigImgInput').onchange = e => handleSigImgDrop(e.target.files[0]);
$('#sigImgDropzone').ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; $('#sigImgDropzone').classList.add('drag-over'); };
$('#sigImgDropzone').ondragleave = e => { e.preventDefault(); $('#sigImgDropzone').classList.remove('drag-over'); };
$('#sigImgDropzone').ondrop = e => { e.preventDefault(); $('#sigImgDropzone').classList.remove('drag-over'); if(e.dataTransfer.files[0]) handleSigImgDrop(e.dataTransfer.files[0]); };

function handleSigImgDrop(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('Signature must be an image.');
  sigImageFile = file;
  $('#sigImgInfo').style.display = 'block';
  $('#sigImgInfo').innerHTML = 'Selected: <strong>' + file.name + '</strong>';
  updateUI();
}

// ===== PDF Viewer (native browser) =====
function showInViewer(blobUrl) {
  viewerDiv.innerHTML = '<object data="' + blobUrl + '" type="application/pdf"><iframe src="' + blobUrl + '"></iframe></object>';
  viewerDiv.style.display = 'block';
  viewerEmpty.style.display = 'none';
}

// ===== Download =====
dlBtn.addEventListener('click', async () => {
  if (!mergedBlob) return;
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: 'merged_document.pdf', types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
      const w = await h.createWritable();
      await w.write(mergedBlob);
      await w.close();
    } catch (e) {
      if (e.name !== 'AbortError') toast('Download failed: ' + e.message);
    }
  } else {
    const r = new FileReader();
    r.onload = function () {
      const a = document.createElement('a'); a.href = r.result; a.download = 'merged_document.pdf';
      a.style.display = 'none'; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1e3);
    };
    r.readAsDataURL(mergedBlob);
  }
});

function showSummary(n, sz) {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `
    <div class="modal">
      <h3>✅ Merge Complete</h3>
      <p class="modal-sub">Your merged PDF is ready to preview and download</p>
      <div class="modal-stats" style="grid-template-columns: 1fr 1fr;">
        <div class="modal-stat"><div class="val">${n}</div><div class="lbl">Files</div></div>
        <div class="modal-stat"><div class="val">${fmtSize(sz)}</div><div class="lbl">Size</div></div>
      </div>
      <button class="modal-close" id="mc">Done</button>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#mc').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
}

// ===== API Call (Merge / Sign) =====
actionBtn.addEventListener('click', async () => {
  if (currentMode === 'merge' && files.length < 2) return;
  if (currentMode === 'sign' && !signTargetPdf) return;
  if (merging) return;

  merging = true;
  actionBtn.disabled = true;
  actionBtnText.innerHTML = '<span class="spinner"></span>Preparing upload...';
  progressWrap.classList.add('active');
  progressBar.style.width = '0%';
  progressText.textContent = 'Starting...';

  try {
    const formData = new FormData();
    let endpoint = '';

    if (currentMode === 'merge') {
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i].file, files[i].name);
      }
      endpoint = `${API_URL}/merge`;
    } else {
      // Sign mode
      formData.append('pdf', signTargetPdf);
      formData.append('signature_mode', sigMode);
      formData.append('page', $('#signPage').value);
      formData.append('width', $('#signWidth').value);
      formData.append('x', $('#signX').value);
      formData.append('y', $('#signY').value);

      if (sigMode === 'draw') {
        const dataUrl = sigCanvas.toDataURL('image/png');
        formData.append('signature_data', dataUrl);
      } else {
        formData.append('signature_file', sigImageFile);
      }
      endpoint = `${PYTHON_API_URL}/sign-pdf`;
    }

    // DEBUGGING: Show the exact endpoint we are hitting
    toast(`Attempting to contact: ${endpoint}`, 'warn');
    console.log("Endpoint called:", endpoint);

    // Use XMLHttpRequest for upload progress tracking
    const xhr = new XMLHttpRequest();
    
    const promise = new Promise((resolve, reject) => {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const pct = Math.round((event.loaded / event.total) * 80);
          progressBar.style.width = pct + '%';
          progressText.textContent = 'Uploading... ' + pct + '%';
          actionBtnText.innerHTML = '<span class="spinner"></span>Uploading ' + pct + '%';
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response);
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || 'Server error'));
          } catch(e) {
            reject(new Error(`Server returned ${xhr.status} ${xhr.statusText}`));
          }
        }
      });

      xhr.addEventListener("error", () => reject(new Error("Network error occurred")));
      xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
      
      xhr.open("POST", endpoint);
      xhr.responseType = "blob";
      xhr.send(formData);
      
      progressBar.style.width = '90%';
      progressText.textContent = 'Processing...';
      actionBtnText.innerHTML = '<span class="spinner"></span>Processing';
    });

    const outBlob = await promise;
    
    progressBar.style.width = '100%';
    actionBtnText.innerHTML = '✓ Done!';

    if (mergedBlobUrl) URL.revokeObjectURL(mergedBlobUrl);
    
    mergedBlob = new Blob([outBlob], { type: 'application/pdf' });
    mergedBlobUrl = URL.createObjectURL(mergedBlob);
    
    dlBtn.style.display = 'flex';
    showInViewer(mergedBlobUrl);
    
    const title = currentMode === 'merge' ? 'Merge complete!' : 'Signing complete!';
    toast(title, 'success');
    
    if (currentMode === 'merge') {
      showSummary(files.length, outBlob.size);
    } else {
      showSummary(1, outBlob.size);
      $('#signPage').value = 1; // reset page just in case
    }

  } catch (e) {
    console.error(e);
    toast((currentMode==='merge'?'Merge':'Sign') + ' failed: ' + e.message);
  } finally {
    merging = false;
    updateUI();
    setTimeout(() => {
      progressWrap.classList.remove('active');
      progressBar.style.width = '0%';
    }, 1500);
  }
});

// ===== Restore session =====
async function restore() {
  try {
    const saved = await loadSession();
    if (!saved || !saved.length) return;
    let count = 0;
    for (const s of saved) {
      try {
        const blob = new Blob([s.buf], { type: 'application/pdf' });
        const file = new File([blob], s.name, { type: 'application/pdf' });
        files.push({ file, name: s.name, size: s.size });
        count++;
      } catch (e) { console.error('Restore file error:', s.name, e); }
    }
    if (count) {
      renderList();
      toast('Session restored — ' + count + ' file' + (count > 1 ? 's' : '') + ' loaded.', 'success');
    }
  } catch (e) { console.error('Restore failed', e); }
}

restore();
updateUI();
