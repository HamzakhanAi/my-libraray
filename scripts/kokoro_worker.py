import base64
import io
import json
import sys
import traceback
from typing import Dict

import numpy as np
import soundfile as sf
from kokoro import KPipeline

SAMPLE_RATE = 24000
DEFAULT_VOICE = "af_sarah"
VALID_LANG_CODES = {"a", "b", "e", "f", "h", "i", "j", "p", "z"}

pipelines: Dict[str, KPipeline] = {}


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def resolve_lang_code(voice_name: str) -> str:
    prefix = (voice_name or DEFAULT_VOICE).split("_", 1)[0][:1].lower()
    return prefix if prefix in VALID_LANG_CODES else "a"


def get_pipeline(voice_name: str) -> KPipeline:
    lang_code = resolve_lang_code(voice_name)
    if lang_code not in pipelines:
        pipelines[lang_code] = KPipeline(lang_code=lang_code)
    return pipelines[lang_code]


def synthesize_segment(text: str, voice_name: str, speed: float) -> str:
    normalized_text = text.strip()
    if not normalized_text:
        raise ValueError("Segment text is required")

    pipeline = get_pipeline(voice_name)
    chunks = []

    for _, _, audio in pipeline(normalized_text, voice=voice_name, speed=speed, split_pattern=r"\n+"):
        if audio is None:
            continue
        chunks.append(np.asarray(audio, dtype=np.float32))

    if not chunks:
        raise RuntimeError("Kokoro returned no audio for the requested text")

    merged = np.concatenate(chunks)
    buffer = io.BytesIO()
    sf.write(buffer, merged, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def handle_request(payload: dict) -> dict:
    request_id = payload.get("requestId")
    voice_name = str(payload.get("voiceName") or DEFAULT_VOICE)
    speed = float(payload.get("speed") or 1.0)
    segments = payload.get("segments") or []

    if not request_id:
        raise ValueError("requestId is required")
    if not isinstance(segments, list) or len(segments) == 0:
        raise ValueError("At least one segment is required")

    results = []
    for segment in segments:
        segment_id = str(segment.get("id", "")).strip()
        segment_text = str(segment.get("text", "")).strip()
        if not segment_id:
            raise ValueError("Each segment requires an id")
        if not segment_text:
            raise ValueError(f"Segment '{segment_id}' is missing text")
        results.append({
            "id": segment_id,
            "audio": synthesize_segment(segment_text, voice_name, speed),
        })

    return {
        "requestId": request_id,
        "ok": True,
        "results": results,
    }


def main() -> None:
    emit({"event": "ready", "engine": "hexgrad/kokoro"})

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        request_id = None
        try:
            payload = json.loads(line)
            request_id = payload.get("requestId")
            emit(handle_request(payload))
        except Exception as exc:  # pragma: no cover - surfaced to Node caller
            emit({
                "requestId": request_id,
                "ok": False,
                "error": str(exc),
                "traceback": traceback.format_exc(limit=2),
            })


if __name__ == "__main__":
    main()
