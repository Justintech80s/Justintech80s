#!/usr/bin/env python3
import math
import os
import struct
import subprocess
import tempfile
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "audio")
os.makedirs(OUT, exist_ok=True)

SR = 44100
DURATION = 2.4
N = int(SR * DURATION)

unit = 0.11
seq = [1, 1, 1, 3, 3, 3, 1, 1, 1]
segments = []
offset = 0.0
for idx, length in enumerate(seq):
    segments.append((offset, offset + length * unit))
    offset += length * unit + unit
    if idx in (2, 5):
        offset += 2 * unit
sos_period = offset

def make_wav(kind, path):
    phase = 0.0
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()

        for i in range(N):
            t = i / SR

            if kind == "siren":
                cycle = (t % 1.2) / 1.2
                tri = cycle * 2 if cycle < 0.5 else (1 - cycle) * 2
                freq = 760 + 900 * tri
                amp = 0.82
            elif kind == "high":
                freq = 1850 if int(t / 0.17) % 2 == 0 else 2350
                amp = 0.80
            elif kind == "pulse":
                freq = 1050
                m = t % 0.68
                amp = 0.84 if (m < 0.20 or 0.34 <= m < 0.54) else 0.0
            else:
                freq = 950
                m = t % sos_period
                amp = 0.82 if any(a <= m < b for a, b in segments) else 0.0

            phase += 2 * math.pi * freq / SR
            sample = amp * (
                math.sin(phase)
                + 0.22 * math.sin(2 * phase)
                + 0.08 * math.sin(3 * phase)
            )
            sample = math.tanh(sample * 1.15)
            value = max(-32768, min(32767, int(sample * 32767)))
            frames += struct.pack("<h", value)

        w.writeframes(frames)

def encode(kind):
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = os.path.join(tmp, kind + ".wav")
        make_wav(kind, wav_path)

        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", wav_path,
            "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "1",
            "-movflags", "+faststart",
            os.path.join(OUT, f"{kind}-ios-v3.m4a"),
        ], check=True)

        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", wav_path,
            "-c:a", "libmp3lame", "-b:a", "160k", "-ar", "44100", "-ac", "1",
            os.path.join(OUT, f"{kind}-fallback-v3.mp3"),
        ], check=True)

for pattern in ("siren", "high", "pulse", "sos"):
    encode(pattern)

print("Generated iOS AAC/M4A and MP3 fallback assets.")
