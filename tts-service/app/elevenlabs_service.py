import requests

from .config import (
    ELEVENLABS_API_KEY,
    ELEVENLABS_MODEL_ID,
    ELEVENLABS_VOICE_ID,
    ELEVENLABS_VOICE_SETTINGS,
)

ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"


def synthesize_to_bytes(text: str, voice_id: str | None = None) -> bytes:
    if not ELEVENLABS_API_KEY:
        raise ValueError("ELEVENLABS_API_KEY no esta configurada")

    selected_voice_id = (voice_id or ELEVENLABS_VOICE_ID or "").strip()
    if not selected_voice_id:
        raise ValueError("voice_id no configurado para ElevenLabs")

    response = requests.post(
        ELEVENLABS_TTS_URL.format(voice_id=selected_voice_id),
        headers={
            "xi-api-key": ELEVENLABS_API_KEY,
            "accept": "audio/mpeg",
            "content-type": "application/json",
        },
        json={
            "text": text,
            "model_id": ELEVENLABS_MODEL_ID,
            "voice_settings": ELEVENLABS_VOICE_SETTINGS,
        },
        timeout=60,
    )

    if response.status_code >= 400:
        detail = response.text
        try:
            detail = response.json().get("detail", detail)
        except ValueError:
            pass
        raise RuntimeError(f"ElevenLabs respondio con error {response.status_code}: {detail}")

    return response.content
