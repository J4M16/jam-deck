function jamDeckCreateIslandOptics(win, canvas, reportFailure) {
  const context = canvas.getContext("2d", { alpha: false });
  const sample = win.document.createElement("canvas");
  sample.width = 128; sample.height = 6;
  const pixels = sample.getContext("2d", { willReadFrequently: true });
  const engine = jamDeckCreateGlassEngine(win);
  // Gate the entire filter output: an SVG filter can emit opaque pixels even
  // while its source canvas is hidden and has never received a desktop frame.
  const material = canvas.parentElement;
  material.style.opacity = "0";
  let config = null, state = null, disposed = false;
  let generation = 0, attached = false, opticalKey = "", decoding = false, sampledAt = -Infinity, sampledPixels = null;
  const stop = () => {
    generation++;
    sampledAt = -Infinity;
    sampledPixels = null;
    material.style.opacity = "0";
    canvas.style.visibility = "hidden";
  };
  const adaptText = (refresh = false) => {
    const now = win.performance.now();
    if (now - sampledAt < 1000 && !refresh) return;
    if (!refresh && now - sampledAt >= 1000) {
      sampledAt = now;
      pixels.drawImage(canvas, 0, 0, sample.width, sample.height);
      sampledPixels = pixels.getImageData(0, 0, sample.width, sample.height).data;
    }
    if (!sampledPixels) return;
    const data = sampledPixels;
    const bounds = canvas.getBoundingClientRect();
    for (const control of win.document.querySelectorAll(".brand, .chip, .timer, .restore, .empty")) {
      const rect = control.getBoundingClientRect();
      const left = Math.max(0, Math.floor((rect.left - bounds.left) / bounds.width * sample.width));
      const right = Math.min(sample.width, Math.ceil((rect.right - bounds.left) / bounds.width * sample.width));
      if (right <= left) continue;
      let brightness = 0, count = 0;
      for (let y = 0; y < sample.height; y++) for (let x = left; x < right; x++) {
        const offset = (y * sample.width + x) * 4;
        brightness += .2126 * data[offset] + .7152 * data[offset + 1] + .0722 * data[offset + 2]; count++;
      }
      brightness /= count * 255;
      const previous = control.dataset.glassTone;
      // A dead band prevents animated desktops from flickering between palettes.
      control.dataset.glassTone = previous === "dark" ? (brightness > .60 ? "light" : "dark")
        : previous === "light" ? (brightness < .44 ? "dark" : "light") : brightness >= .52 ? "light" : "dark";
    }
  };
  const paint = image => {
    if (disposed || !state?.active || !config) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    adaptText();
    canvas.style.visibility = "visible";
    material.style.opacity = "1";
  };
  const update = next => {
    if (disposed) return;
    state = next;
    if (!state.active) { stop(); return; }
    const blur = Math.max(0, Math.min(16, Number(state.blur) || 0));
    const balanced = state.quality !== "light";
    const key = `${blur}:${balanced}`;
    if (key !== opticalKey) {
      opticalKey = key;
      if (balanced) {
        const options = { bevel: 18, thickness: 40, slope: 1.8, shape: "squircle", blur,
          dispersion: 0, sat: 1, shade: 0.14, rim: 0.22, edge: 0, edgeW: 4, smooth: 0,
          materialize: 0, settle: 180, light: -35 };
        if (attached) void engine.setOpts(options);
        else { engine.attach(canvas, options); attached = true; }
        canvas.style.filter = "var(--hyalite)";
      } else {
        if (attached) { engine.detach(canvas); attached = false; }
        canvas.style.filter = `blur(${blur}px)`;
      }
    }
  };
  return {
    configure(value) {
      config = value;
      canvas.width = Math.round(value.bounds.width);
      canvas.height = Math.round(value.bounds.height);
      if (state) update(state);
    },
    update,
    refreshText() { if (!disposed && state?.active) adaptText(true); },
    async frame(bytes) {
      if (disposed || !state?.active || decoding) return;
      const token = generation;
      decoding = true;
      let image;
      try {
        image = await win.createImageBitmap(new win.Blob([bytes], { type: "image/jpeg" }));
        if (token === generation) paint(image);
      } catch (error) {
        if (!disposed && token === generation) reportFailure(error.message || String(error));
      } finally { image?.close(); decoding = false; }
    },
    dispose() { if (disposed) return; disposed = true; stop(); engine.dispose(); },
  };
}
