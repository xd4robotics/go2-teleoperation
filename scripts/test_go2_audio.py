#!/usr/bin/env python3
"""Envia um tom curto ao alto-falante do Go2 pelo gateway DDS local."""

import argparse
import base64
import io
import json
import math
import os
import struct
import time
import urllib.request
import wave


SAMPLE_RATE = 44_100
CLIP_SECONDS = 0.32
AUDIOHUB_BLOCK_SIZE = 4_096


def wav_tone(frequency, duration, volume):
    output = io.BytesIO()
    frame_count = round(SAMPLE_RATE * duration)
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for index in range(frame_count):
            sample = math.sin(2 * math.pi * frequency * index / SAMPLE_RATE)
            frames += struct.pack("<h", round(sample * volume * 32767))
        wav.writeframes(frames)
    return output.getvalue()


def post(url, key, payload):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["X-Gateway-Key"] = key
    request = urllib.request.Request(
        url.rstrip("/") + "/api/audio/megaphone",
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--gateway-url",
        default=os.environ.get("ROBOT_GATEWAY_URL", "http://127.0.0.1:8081"),
    )
    parser.add_argument(
        "--gateway-key",
        default=os.environ.get("ROBOT_GATEWAY_API_KEY", ""),
    )
    parser.add_argument("--frequency", type=float, default=880)
    parser.add_argument("--duration", type=float, default=0.64)
    parser.add_argument("--volume", type=float, default=0.18)
    args = parser.parse_args()

    duration = max(0.1, min(3.0, args.duration))
    volume = max(0.01, min(0.5, args.volume))
    post(args.gateway_url, args.gateway_key, {"action": "start"})
    try:
        remaining = duration
        while remaining > 0:
            clip_duration = min(CLIP_SECONDS, remaining)
            wav = wav_tone(args.frequency, clip_duration, volume)
            encoded = base64.b64encode(wav).decode("ascii")
            blocks = [
                encoded[offset : offset + AUDIOHUB_BLOCK_SIZE]
                for offset in range(0, len(encoded), AUDIOHUB_BLOCK_SIZE)
            ]
            for index, block in enumerate(blocks, 1):
                post(
                    args.gateway_url,
                    args.gateway_key,
                    {
                        "action": "chunk",
                        "data": block,
                        "current_block_index": index,
                        "total_block_number": len(blocks),
                    },
                )
            remaining -= clip_duration
            time.sleep(clip_duration)
    finally:
        post(
            args.gateway_url,
            args.gateway_key,
            {"action": "stop", "delay_seconds": 0.45},
        )
    print("Tom de teste enviado ao AudioHub do Go2.", flush=True)


if __name__ == "__main__":
    main()
