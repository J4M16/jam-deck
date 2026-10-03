function jamDeckCreateIslandOptics(win, canvas, reportFailure) {
  const context = canvas.getContext("2d", { alpha: false });
  const video = win.document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  const engine = jamDeckCreateGlassEngine(win);
  // Gate the entire filter output: an SVG filter can emit opaque pixels even
  // while its source canvas is hidden and has never received a desktop frame.
  const material = canvas.parentElement;
  material.style.opacity = "0";
  let config = null, state = null, stream = null, starting = false, disposed = false;
  let generation = 0, callback = 0, attached = false, opticalKey = "", decoding = false;
  const stop = () => {
    generation++;
    starting = false;
    if (callback) video.cancelVideoFrameCallback(callback);
    callback = 0;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    video.pause(); video.srcObject = null;
    material.style.opacity = "0";
    canvas.style.visibility = "hidden";
  };
  const paint = image => {
    if (disposed || !state?.active || !config) return;
    const { bounds, display } = config;
    if (config.platform === "win32") {
      const scaleX = video.videoWidth / display.width, scaleY = video.videoHeight / display.height;
      context.drawImage(image, (bounds.x - display.x) * scaleX, (bounds.y - display.y) * scaleY,
        bounds.width * scaleX, bounds.height * scaleY, 0, 0, canvas.width, canvas.height);
    } else context.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.style.visibility = "visible";
    material.style.opacity = "1";
  };
  const startVideo = async () => {
    if (starting || stream || disposed || !state?.active || !config || config.platform !== "win32") return;
    starting = true;
    const token = generation;
    let incoming = null;
    try {
      incoming = await win.navigator.mediaDevices.getUserMedia({ audio: false, video: {
        mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: config.sourceId,
          maxFrameRate: 30, maxWidth: config.display.width, maxHeight: config.display.height }
      } });
      if (disposed || token !== generation || !state?.active) { incoming.getTracks().forEach(track => track.stop()); return; }
      stream = incoming;
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        if (!disposed && token === generation && state?.active) reportFailure("桌面采样已停止");
      }, { once: true });
      video.srcObject = stream;
      await video.play();
      if (disposed || token !== generation || !state?.active) return;
      const draw = () => {
        if (disposed || token !== generation || !state?.active) return;
        try {
          paint(video);
          callback = video.requestVideoFrameCallback(draw);
        } catch (error) { stop(); reportFailure(error.message || String(error)); }
      };
      callback = video.requestVideoFrameCallback(draw);
    } catch (error) {
      if (incoming && incoming !== stream) incoming.getTracks().forEach(track => track.stop());
      if (!disposed && token === generation && state?.active) { stop(); reportFailure(error.message || String(error)); }
    } finally { if (token === generation) starting = false; }
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
    void startVideo();
  };
  return {
    configure(value) {
      config = value;
      canvas.width = Math.round(value.bounds.width);
      canvas.height = Math.round(value.bounds.height);
      if (state) update(state);
    },
    update,
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
