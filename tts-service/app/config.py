from pathlib import Path
import os

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
SERVICE_DIR = BASE_DIR.parent

load_dotenv(SERVICE_DIR / ".env")

CACHE_DIR = SERVICE_DIR / "tts_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
os.environ["TTS_HOME"] = str(CACHE_DIR)

TTS_ENGINE = os.getenv("TTS_ENGINE", "elevenlabs").strip().lower()
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]

MODEL_NAME = os.getenv("MODEL_NAME", "tts_models/multilingual/multi-dataset/xtts_v2")
DEFAULT_LANGUAGE = os.getenv("DEFAULT_LANGUAGE", "es")
DEFAULT_VOICE_ID = os.getenv("DEFAULT_VOICE_ID", "innomedic_male_01")

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "").strip()
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "").strip()
ELEVENLABS_MODEL_ID = os.getenv("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5").strip()


def _get_float_env(name: str, default: float) -> float:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        return default
    try:
        return float(raw_value)
    except ValueError:
        return default


def _get_bool_env(name: str, default: bool) -> bool:
    raw_value = os.getenv(name, "").strip().lower()
    if not raw_value:
        return default
    return raw_value in {"1", "true", "yes", "y", "on"}


ELEVENLABS_VOICE_SETTINGS = {
    "stability": _get_float_env("ELEVENLABS_STABILITY", 0.70),
    "similarity_boost": _get_float_env("ELEVENLABS_SIMILARITY_BOOST", 0.85),
    "style": _get_float_env("ELEVENLABS_STYLE", 0.10),
    "use_speaker_boost": _get_bool_env("ELEVENLABS_USE_SPEAKER_BOOST", True),
    "speed": _get_float_env("ELEVENLABS_SPEED", 0.90),
}

VOICE_MAP = {
    "innomedic_male_01": BASE_DIR / "voices" / "innomedic_male_01.wav",
}


def get_active_model_name() -> str:
    if TTS_ENGINE == "elevenlabs":
        return ELEVENLABS_MODEL_ID
    return MODEL_NAME


def has_configured_voice_id() -> bool:
    if TTS_ENGINE == "elevenlabs":
        return bool(ELEVENLABS_VOICE_ID)
    return bool(DEFAULT_VOICE_ID)
