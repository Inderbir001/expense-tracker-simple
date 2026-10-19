'use strict';
// Taking and shrinking photos, shared by the expense form and the messages page.
// Full-size phone photos (12-50 megapixels) crash low-memory phones, so everything is kept small:
//   Camera.take()      live in-app camera (the page is never left, so it is never closed by the phone)
//   Camera.fromFile()  a photo picked from the gallery / phone camera app, decoded already shrunk
// Both give { photo, thumb } (JPEG data URLs) ready to send to the server.

const Camera = (() => {
  const MAX_SIDE = 1600;

  function toJpeg(src, maxSide, quality) {
    const w = src.videoWidth || src.width || src.naturalWidth;
    const hgt = src.videoHeight || src.height || src.naturalHeight;
    const scale = Math.min(1, maxSide / Math.max(w, hgt));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(hgt * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return { url: c.toDataURL('image/jpeg', quality), canvas: c };
  }

  function makePhotoData(src) {
    const big = toJpeg(src, MAX_SIDE, 0.82);
    const small = toJpeg(big.canvas, 240, 0.7);
    big.canvas.width = big.canvas.height = 0; // give the memory back
    return { photo: big.url, thumb: small.url };
  }

  async function loadBitmap(file) {
    if (window.createImageBitmap) {
      try {
        const opts = { imageOrientation: 'from-image' };
        if (file.size > 700 * 1024) Object.assign(opts, { resizeWidth: MAX_SIDE, resizeQuality: 'medium' });
        return await createImageBitmap(file, opts);
      } catch { /* fall back */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  async function fromFile(file) {
    const bmp = await loadBitmap(file);
    const data = makePhotoData(bmp);
    if (bmp.close) bmp.close();
    return data;
  }

  // Resolves { photo, thumb }, or null if she cancels. Throws an Error with code 'unavailable' or 'blocked'.
  async function take() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw Object.assign(new Error('Camera not available'), { code: 'unavailable' });
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch {
      throw Object.assign(new Error('Camera blocked'), { code: 'blocked' });
    }

    return new Promise((resolve) => {
      const video = App.h('video', { autoplay: true, playsinline: true, muted: true });
      video.muted = true;
      video.srcObject = stream;
      let closed = false;

      function close(result) {
        if (closed) return;
        closed = true;
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('pagehide', onLeave);
        resolve(result);
      }
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      const onHide = () => { if (document.hidden) close(null); };
      const onLeave = () => close(null);

      const overlay = App.h('div', { class: 'cam', role: 'dialog', 'aria-label': 'Camera' },
        video,
        App.h('div', { class: 'cam-bar' },
          App.h('button', { type: 'button', class: 'cam-cancel', onclick: () => close(null) }, 'Cancel'),
          App.h('button', {
            type: 'button', class: 'cam-shutter', 'aria-label': 'Take photo',
            onclick: () => {
              if (!video.videoWidth) return; // camera not ready yet
              close(makePhotoData(video));
            },
          }),
          App.h('span', { class: 'cam-spacer' })));
      document.body.append(overlay);
      document.addEventListener('keydown', onKey);
      document.addEventListener('visibilitychange', onHide);
      window.addEventListener('pagehide', onLeave);
      video.play().catch(() => { /* autoplay is already on */ });
    });
  }

  return { take, fromFile, makePhotoData };
})();
