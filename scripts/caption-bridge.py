"""Local Sherpa-ONNX streaming ASR. stdin EOF/stop owns the capture lifetime.

stdout is JSONL only; no audio is written to disk or sent to a server.
"""
import argparse
import json
import queue
import platform
import signal
import sys
import threading
import time
import wave
from pathlib import Path


def emit(kind, **values):
    print(json.dumps({"type": kind, **values}, ensure_ascii=False), flush=True)


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--source", choices=["system", "mic"], default="system")
    parser.add_argument("--wav", help="Offline fixture using the same streaming decoder")
    parser.add_argument("--audiotee", help="Native macOS system-audio capture executable")
    args = parser.parse_args()
    import numpy as np
    import sherpa_onnx

    model = Path(args.model)
    recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=str(model / "tokens.txt"),
        encoder=str(model / "encoder-epoch-99-avg-1.int8.onnx"),
        decoder=str(model / "decoder-epoch-99-avg-1.onnx"),
        joiner=str(model / "joiner-epoch-99-avg-1.int8.onnx"),
        num_threads=2, sample_rate=16000, feature_dim=80,
        decoding_method="greedy_search", provider="cpu",
        enable_endpoint_detection=True,
        rule1_min_trailing_silence=2.4, rule2_min_trailing_silence=1.2,
        rule3_min_utterance_length=20,
    )
    stream = recognizer.create_stream()
    sequence, offset, sentence_start, last = 0, 0.0, 0.0, ""

    def feed(samples, rate, finish=False):
        nonlocal sequence, offset, sentence_start, last
        stream.accept_waveform(rate, samples)
        offset += len(samples) / rate
        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)
        text = recognizer.get_result(stream).strip()
        endpoint = recognizer.is_endpoint(stream) or finish
        if text and (text != last or endpoint):
            emit("final" if endpoint else "partial", id=sequence,
                 start=round(sentence_start, 3), end=round(offset, 3), text=text)
        last = text
        if endpoint:
            recognizer.reset(stream)
            sequence += 1
            sentence_start, last = offset, ""

    if args.wav:
        with wave.open(args.wav, "rb") as audio:
            if audio.getsampwidth() != 2:
                raise ValueError("Fixture must be PCM16 WAV")
            rate, channels = audio.getframerate(), audio.getnchannels()
            emit("ready", device="WAV fixture", source=args.source)
            while raw := audio.readframes(int(rate * 0.1)):
                samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
                feed(samples.reshape(-1, channels).mean(axis=1), rate)
            feed(np.zeros(int(rate * 1.3), dtype=np.float32), rate, finish=True)
        emit("stopped")
        return

    stop = threading.Event()
    if sys.platform == "darwin":
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
    frames = queue.Queue(maxsize=100)
    overflow = threading.Event()

    def commands():
        for line in sys.stdin:
            if line.strip() == "stop":
                break
        stop.set()  # also stops when Obsidian exits / closes the pipe

    threading.Thread(target=commands, daemon=True).start()

    if sys.platform == "darwin":
        if tuple(map(int, platform.mac_ver()[0].split(".")[:2])) < (14, 2):
            raise RuntimeError("字幕墙的原生系统声音采集需要 macOS 14.2 或更新版本")
        from caption_audio_macos import SystemAudio, Microphone
        if args.source == "system" and not args.audiotee:
            raise RuntimeError("未安装 Mac 系统声音采集器，请运行 bash scripts/setup-captions.sh")
        with (SystemAudio(args.audiotee) if args.source == "system" else Microphone()) as audio:
            if audio.wait_ready(stop):
                rate = audio.sample_rate
                emit("ready", device=audio.device, source=args.source)

                def decode(raw):
                    samples = np.frombuffer(raw, dtype=audio.dtype).astype(np.float32)
                    return samples / 32768 if audio.dtype == "<i2" else samples

                while not stop.is_set():
                    raw = audio.read()
                    feed(decode(raw) if raw else np.zeros(int(rate * 0.1), dtype=np.float32), rate)
                # Only drain the snapshot: callbacks may still enqueue until context exit.
                for _ in range(audio.frames.qsize()):
                    feed(decode(audio.frames.get_nowait()), rate)
                feed(np.zeros(int(rate * 0.4), dtype=np.float32), rate, finish=True)
        emit("stopped")
        return

    import pyaudiowpatch as pa

    def capture(data, count, timing, status):
        if status:
            overflow.set()
        try:
            frames.put_nowait(data)
        except queue.Full:
            overflow.set()
        return (None, pa.paComplete if stop.is_set() else pa.paContinue)

    with pa.PyAudio() as audio:
        if args.source == "system":
            device = audio.get_default_wasapi_loopback()
        else:
            api = audio.get_host_api_info_by_type(pa.paWASAPI)
            if int(api["defaultInputDevice"]) < 0:
                raise RuntimeError("没有可用的默认麦克风；请检查 Windows 输入设备及远程桌面录音重定向")
            device = audio.get_device_info_by_index(int(api["defaultInputDevice"]))
        rate, channels = int(device["defaultSampleRate"]), int(device["maxInputChannels"])
        if channels < 1:
            raise RuntimeError("No available audio input channels")
        with audio.open(format=pa.paFloat32, channels=channels, rate=rate,
                        input=True, input_device_index=int(device["index"]),
                        frames_per_buffer=int(rate * 0.1), stream_callback=capture):
            emit("ready", device=device["name"], source=args.source)
            while not stop.is_set():
                if overflow.is_set():
                    raise RuntimeError("Audio capture overflow; restart transcription")
                try:
                    data = frames.get(timeout=0.1)
                    samples = np.frombuffer(data, dtype=np.float32).reshape(-1, channels).mean(axis=1)
                except queue.Empty:
                    # WASAPI loopback can emit no packets when every app is silent.
                    samples = np.zeros(int(rate * 0.1), dtype=np.float32)
                feed(samples, rate)
            while not frames.empty():
                data = frames.get_nowait()
                feed(np.frombuffer(data, dtype=np.float32).reshape(-1, channels).mean(axis=1), rate)
            feed(np.zeros(int(rate * 0.4), dtype=np.float32), rate, finish=True)
    emit("stopped")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        run()
    except Exception as error:
        emit("error", message=str(error))
        sys.exit(1)
