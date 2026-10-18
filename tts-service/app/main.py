import hashlib
import json
from urllib.parse import quote
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.exceptions import RequestValidationError
from .access_control import AccessError, require_service_access, admission

from .config import (
    ALLOWED_ORIGINS,
    DEFAULT_VOICE_ID,
    ELEVENLABS_VOICE_ID,
    ELEVENLABS_VOICE_SETTINGS,
    TTS_ENGINE,
    VOICE_MAP,
    get_active_model_name,
    has_configured_voice_id,
)
from .elevenlabs_service import synthesize_to_bytes
from .schemas import SynthesizeRequest

app = FastAPI(title="AudioEvaluaciones TTS")


@app.middleware("http")
async def protect_service(request, call_next):
    if request.url.path != "/health" and request.method != "OPTIONS":
        try:
            require_service_access(request.headers.get("authorization"))
            if request.method == "POST":
                length = request.headers.get("content-length")
                if length is None:
                    raise AccessError(411, "TTS_LENGTH_REQUIRED")
                if not length.isdigit() or int(length) > 65536:
                    raise AccessError(413, "TTS_BODY_TOO_LARGE")
        except AccessError as error:
            return JSONResponse({"error": error.code}, status_code=error.status, headers={"Cache-Control": "no-store"})
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(RequestValidationError)
async def safe_validation_error(_request, _error):
    return JSONResponse({"error": "TTS_REQUEST_INVALID"}, status_code=422)


@app.get("/configuration")
def configuration():
    voice = ELEVENLABS_VOICE_ID if TTS_ENGINE == "elevenlabs" else DEFAULT_VOICE_ID
    return {
        "provider": TTS_ENGINE,
        "model": get_active_model_name(),
        "voice_ref": hashlib.sha256(voice.encode()).hexdigest(),
        "settings": ELEVENLABS_VOICE_SETTINGS if TTS_ENGINE == "elevenlabs" else {},
        "language": "es", "format": "mp3" if TTS_ENGINE == "elevenlabs" else "wav",
        "contract": 1,
    }

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": TTS_ENGINE,
        "model": get_active_model_name(),
        "voice_id_configured": has_configured_voice_id(),
        "voices": list(VOICE_MAP.keys()),
    }


@app.get("/voices")
def voices():
    return [
        {"id": voice_id, "label": voice_id}
        for voice_id in VOICE_MAP.keys()
    ]


@app.post("/synthesize")
def synthesize(payload: SynthesizeRequest):
    try:
        voice = ELEVENLABS_VOICE_ID if TTS_ENGINE == "elevenlabs" else DEFAULT_VOICE_ID
        with admission.slot(payload.text, payload.voice_id, voice):
            return synthesize_authorized(payload)
    except AccessError as error:
        raise HTTPException(status_code=error.status, detail=error.code) from None


def synthesize_authorized(payload: SynthesizeRequest):
    try:
        if TTS_ENGINE == "elevenlabs":
            audio = synthesize_to_bytes(
                text=payload.text,
                voice_id=payload.voice_id or ELEVENLABS_VOICE_ID,
            )
            return Response(
                content=audio,
                media_type="audio/mpeg",
                headers={
                    "Content-Disposition": 'attachment; filename="audio-evaluacion.mp3"',
                    "X-TTS-Configuration": quote(json.dumps(configuration(), sort_keys=True)),
                },
            )

        if TTS_ENGINE != "coqui":
            raise ValueError(f"TTS_ENGINE no soportado: {TTS_ENGINE}")

        from .tts_service import synthesize_to_file

        output_path = synthesize_to_file(
            text=payload.text,
            language=payload.language,
            voice_id=payload.voice_id or DEFAULT_VOICE_ID,
        )

        return FileResponse(
            path=output_path,
            media_type="audio/wav",
            filename="audio-evaluacion.wav",
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Configuración o solicitud TTS no válida.") from None
    except Exception:
        raise HTTPException(status_code=503, detail="No se pudo completar TTS. El resultado puede ser incierto; no reintentar automáticamente.") from None
