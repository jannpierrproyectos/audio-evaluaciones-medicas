from pathlib import Path
import tempfile

from TTS.api import TTS

from .config import MODEL_NAME, DEFAULT_LANGUAGE, VOICE_MAP

_tts_model = None


def get_tts_model():
    global _tts_model
    if _tts_model is None:
        _tts_model = TTS(MODEL_NAME)
    return _tts_model


def synthesize_to_file(text: str, language: str, voice_id: str) -> str:
    if voice_id not in VOICE_MAP:
        raise ValueError(f"voice_id no válido: {voice_id}")

    speaker_wav = VOICE_MAP[voice_id]
    if not Path(speaker_wav).exists():
        raise FileNotFoundError(f"No existe archivo de voz: {speaker_wav}")

    tts = get_tts_model()

    output_dir = Path(tempfile.mkdtemp())
    output_path = output_dir / "output.wav"

    tts.tts_to_file(
        text=text,
        file_path=str(output_path),
        speaker_wav=str(speaker_wav),
        language=language or DEFAULT_LANGUAGE,
    )

    return str(output_path)