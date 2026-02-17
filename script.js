document.addEventListener('DOMContentLoaded', () => {
  // --- Common Elements ---
  const tabBtns = document.querySelectorAll('.tab-btn');
  const subtitle = document.getElementById('subtitle');
  const calcPanel = document.getElementById('calc-panel');
  const imagePanel = document.getElementById('image-panel');
  const videoPanel = document.getElementById('video-panel');
  const clampPanel = document.getElementById('clamp-panel');

  // --- Calc Mode Elements ---
  const parentInput = document.getElementById('parent-px');
  const targetInput = document.getElementById('target-px');
  const resultValue = document.getElementById('result-value');
  const resultUnit = document.getElementById('result-unit');
  const parentLabel = document.getElementById('parent-label');
  const targetLabel = document.querySelector('label[for="target-px"]');
  const copyBtn = document.getElementById('copy-btn');
  const resultArea = document.querySelector('.result-area');

  // --- Clamp Mode Elements ---
  const clampMinSize = document.getElementById('clamp-min-size');
  const clampMaxSize = document.getElementById('clamp-max-size');
  const clampMinVw = document.getElementById('clamp-min-vw');
  const clampMaxVw = document.getElementById('clamp-max-vw');
  const clampValue = document.getElementById('clamp-value');
  const clampCopyBtn = document.getElementById('clamp-copy-btn');
  const clampResultArea = document.getElementById('clamp-result-area');

  // --- WebP Mode Elements ---
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const previewSection = document.getElementById('preview-section');
  const fileList = document.getElementById('file-list');
  const startConversionBtn = document.getElementById('start-conversion');
  const downloadAllBtn = document.getElementById('download-all');
  const qualityRange = document.getElementById('quality-range');
  const qualityVal = document.getElementById('quality-val');
  const losslessCheck = document.getElementById('lossless-check');

  // --- Video Mode Elements ---
  const videoDropZone = document.getElementById('video-drop-zone');
  const videoFileInput = document.getElementById('video-file-input');
  const videoPreviewSection = document.getElementById('video-preview-section');
  const convertVideo = document.getElementById('convert-video');
  const startVideoBtn = document.getElementById('start-video-conversion');
  const videoResultLink = document.getElementById('video-result-link');
  const videoDownloadBtn = document.getElementById('video-download-btn');
  const bitrateRange = document.getElementById('video-bitrate-range');
  const bitrateVal = document.getElementById('video-bitrate-val');
  const videoLosslessCheck = document.getElementById('video-lossless-check');
  const videoMuteCheck = document.getElementById('video-mute-check');
  const convertOverlay = document.getElementById('convert-overlay');
  const convertPercent = document.getElementById('convert-percent');

  let currentMode = 'percentage';
  let pendingFiles = [];
  let convertedFiles = [];
  let videoSource = null;

  // --- Math Helpers ---
  function getGCD(a, b) {
    return b === 0 ? a : getGCD(b, a % b);
  }

  // --- Navigation ---
  function switchMode(mode) {
    currentMode = mode;
    tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));

    calcPanel.classList.add('hidden');
    imagePanel.classList.add('hidden');
    videoPanel.classList.add('hidden');
    clampPanel.classList.add('hidden');

    if (mode === 'video') {
      videoPanel.classList.remove('hidden');
      subtitle.textContent = 'MP4動画をWebM形式に変換（圧縮・ミュート対応）';
    } else if (mode === 'webp') {
      imagePanel.classList.remove('hidden');
      subtitle.textContent = '画像をドロップしてWebP形式に一括変換';
    } else if (mode === 'clamp') {
      clampPanel.classList.remove('hidden');
      subtitle.textContent = '最小・最大サイズを入力して流体タイポグラフィを生成';
    } else {
      calcPanel.classList.remove('hidden');
      targetLabel.textContent = 'ターゲットのサイズ (px)';
      if (mode === 'percentage') {
        parentLabel.textContent = '親要素のサイズ (px)';
        subtitle.textContent = '親要素とターゲットの値を入力して即座に変換';
        resultUnit.textContent = '%';
      } else if (mode === 'vw') {
        parentLabel.textContent = '全体の画面幅 (px)';
        subtitle.textContent = '画面幅とターゲットの値を入力してvwに変換';
        resultUnit.textContent = 'vw';
      } else if (mode === 'ratio') {
        parentLabel.textContent = '幅 (Width px)';
        targetLabel.textContent = '高さ (Height px)';
        subtitle.textContent = '幅と高さを入力してアスペクト比を算出';
        resultUnit.textContent = '';
      }
      calculate();
    }
  }

  // --- Calculation Logic ---
  function calculate() {
    if (currentMode === 'webp' || currentMode === 'video') return;

    if (currentMode === 'clamp') {
      const minSize = parseFloat(clampMinSize.value);
      const maxSize = parseFloat(clampMaxSize.value);
      const minVw = parseFloat(clampMinVw.value);
      const maxVw = parseFloat(clampMaxVw.value);

      if (isNaN(minSize) || isNaN(maxSize) || isNaN(minVw) || isNaN(maxVw) || maxVw === minVw) {
        clampValue.textContent = '全ての項目を正しく入力してください';
        return;
      }

      // Linear Interpolation Formula for clamp()
      // slope = (max_size - min_size) / (max_viewport - min_viewport)
      // intersection = (-min_viewport * slope) + min_size
      const slope = (maxSize - minSize) / (maxVw - minVw);
      const intersection = (-minVw * slope) + minSize;

      const slopeVw = (slope * 100).toFixed(3);
      const interceptRem = (intersection / 16).toFixed(3);
      const minRem = (minSize / 16).toFixed(3);
      const maxRem = (maxSize / 16).toFixed(3);

      clampValue.textContent = `clamp(${minRem}rem, ${interceptRem}rem + ${slopeVw}vw, ${maxRem}rem)`;
      return;
    }

    const a = parseFloat(parentInput.value);
    const b = parseFloat(targetInput.value);
    if (isNaN(a) || a <= 0 || isNaN(b)) {
      resultValue.textContent = '0';
      return;
    }

    if (currentMode === 'ratio') {
      if (b <= 0) { resultValue.textContent = '0'; return; }
      const gcd = getGCD(Math.round(a), Math.round(b));
      resultValue.textContent = `${Math.round(a) / gcd} / ${Math.round(b) / gcd}`;
    } else {
      const result = (b / a) * 100;
      resultValue.textContent = Number(result.toFixed(3));
    }
  }

  // --- WebP Logic ---
  function handleFiles(files) {
    const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (validFiles.length === 0) return;
    pendingFiles = validFiles;
    fileList.innerHTML = '';
    previewSection.classList.remove('hidden');
    startConversionBtn.classList.remove('hidden');
    downloadAllBtn.classList.add('hidden');
    pendingFiles.forEach(file => {
      const item = createPreviewItem(file);
      fileList.appendChild(item);
    });
  }

  function createPreviewItem(file) {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.innerHTML = `
      <img class="thumbnail" src="${URL.createObjectURL(file)}" alt="preview">
      <div class="file-info">
        <div class="file-name">${file.name}</div>
        <div class="file-meta"><span>${(file.size / (1024 * 1024)).toFixed(2)} MB</span><span class="status-tag pending">待機中</span></div>
      </div>
    `;
    return div;
  }

  async function convertAllWebP() {
    startConversionBtn.classList.add('hidden');
    const quality = qualityRange.value / 100;
    const lossless = losslessCheck.checked;
    convertedFiles = [];
    for (let i = 0; i < pendingFiles.length; i++) {
      const file = pendingFiles[i];
      const item = fileList.children[i];
      const statusTag = item.querySelector('.status-tag');
      statusTag.textContent = '変換中...';
      try {
        const webpBlob = await convertToWebP(file, quality, lossless);
        const url = URL.createObjectURL(webpBlob);
        const newName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
        statusTag.textContent = '完了';
        statusTag.className = 'status-tag success';
        const dlBtn = document.createElement('a');
        dlBtn.href = url; dlBtn.download = newName; dlBtn.className = 'btn-download'; dlBtn.textContent = '保存';
        item.appendChild(dlBtn);
        convertedFiles.push({ url, name: newName });
      } catch (err) { statusTag.textContent = 'エラー'; }
    }
    if (convertedFiles.length > 0) downloadAllBtn.classList.remove('hidden');
  }

  async function convertToWebP(file, quality, lossless) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(), 'image/webp', lossless ? 1.0 : quality);
      };
      img.src = URL.createObjectURL(file);
    });
  }

  // --- Video Logic ---
  function handleVideoFile(file) {
    if (!file || !file.type.startsWith('video/')) return;
    videoSource = file;
    videoResultLink.classList.add('hidden');
    videoPreviewSection.classList.remove('hidden');
    startVideoBtn.classList.remove('hidden');
    convertVideo.src = URL.createObjectURL(file);
    convertVideo.load();
  }

  async function convertVideoToWebM() {
    startVideoBtn.classList.add('hidden');
    convertOverlay.classList.remove('hidden');
    const stream = convertVideo.captureStream();
    if (videoMuteCheck.checked) {
      stream.getAudioTracks().forEach(track => { track.stop(); stream.removeTrack(track); });
    }
    const bitrate = videoLosslessCheck.checked ? 100000000 : bitrateRange.value * 200000;
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: bitrate });
    const chunks = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      videoDownloadBtn.href = URL.createObjectURL(blob);
      videoDownloadBtn.download = videoSource.name.replace(/\.[^/.]+$/, "") + ".webm";
      videoResultLink.classList.remove('hidden');
      convertOverlay.classList.add('hidden');
    };
    convertVideo.currentTime = 0;
    convertVideo.muted = true;
    const duration = convertVideo.duration;
    const progressInterval = setInterval(() => {
      convertPercent.textContent = Math.min(99, Math.round((convertVideo.currentTime / duration) * 100));
    }, 100);
    recorder.start();
    await convertVideo.play();
    convertVideo.onended = () => {
      clearInterval(progressInterval);
      convertPercent.textContent = '100';
      recorder.stop();
    };
  }

  // --- Events ---
  tabBtns.forEach(btn => btn.addEventListener('click', () => switchMode(btn.dataset.mode)));

  // Calc & Clamp Inputs
  [parentInput, targetInput, clampMinSize, clampMaxSize, clampMinVw, clampMaxVw].forEach(el => {
    el.addEventListener('input', calculate);
  });

  // Copy Functions
  resultArea.addEventListener('click', async () => {
    if (currentMode === 'webp' || currentMode === 'video' || currentMode === 'clamp') return;
    navigator.clipboard.writeText(`${resultValue.textContent}${resultUnit.textContent}`);
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'コピー済み！';
    setTimeout(() => copyBtn.textContent = originalText, 2000);
  });

  clampResultArea.addEventListener('click', async () => {
    if (clampValue.textContent.includes('ください')) return;
    navigator.clipboard.writeText(clampValue.textContent);
    const originalText = clampCopyBtn.textContent;
    clampCopyBtn.textContent = 'コピー済み！';
    setTimeout(() => clampCopyBtn.textContent = originalText, 2000);
  });

  // WebP Events
  qualityRange.addEventListener('input', () => qualityVal.textContent = `${qualityRange.value}%`);
  losslessCheck.addEventListener('change', () => qualityRange.disabled = losslessCheck.checked);
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => handleFiles(e.target.files));
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
  startConversionBtn.addEventListener('click', convertAllWebP);
  downloadAllBtn.addEventListener('click', () => {
    convertedFiles.forEach((f, i) => setTimeout(() => { const a = document.createElement('a'); a.href = f.url; a.download = f.name; a.click(); }, i * 200));
  });

  // Video Events
  function updateBitrateDisplay() {
    const bps = videoLosslessCheck.checked ? 100000000 : bitrateRange.value * 200000;
    const mbps = bps / 1_000_000;
    bitrateVal.textContent = mbps >= 10 ? `${Math.round(mbps)} Mbps` : `${mbps.toFixed(1)} Mbps`;
  }
  bitrateRange.addEventListener('input', updateBitrateDisplay);
  videoLosslessCheck.addEventListener('change', () => {
    bitrateRange.disabled = videoLosslessCheck.checked;
    updateBitrateDisplay();
  });
  updateBitrateDisplay();
  videoDropZone.addEventListener('click', () => videoFileInput.click());
  videoFileInput.addEventListener('change', e => handleVideoFile(e.target.files[0]));
  videoDropZone.addEventListener('dragover', e => { e.preventDefault(); videoDropZone.classList.add('dragover'); });
  videoDropZone.addEventListener('dragleave', () => videoDropZone.classList.remove('dragover'));
  videoDropZone.addEventListener('drop', e => { e.preventDefault(); videoDropZone.classList.remove('dragover'); handleVideoFile(e.dataTransfer.files[0]); });
  startVideoBtn.addEventListener('click', convertVideoToWebM);
});
