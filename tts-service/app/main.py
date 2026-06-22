from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from .config import (
    ALLOWED_ORIGINS,
    DEFAULT_VOICE_ID,
    ELEVENLABS_VOICE_ID,
    TTS_ENGINE,
    VOICE_MAP,
    get_active_model_name,
    has_configured_voice_id,
)
from .elevenlabs_service import synthesize_to_bytes
from .schemas import SynthesizeRequest

app = FastAPI(title="AudioEvaluaciones TTS")

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
        if TTS_ENGINE == "elevenlabs":
            audio = synthesize_to_bytes(
                text=payload.text,
                voice_id=payload.voice_id or ELEVENLABS_VOICE_ID,
            )
            return Response(
                content=audio,
                media_type="audio/mpeg",
                headers={"Content-Disposition": 'attachment; filename="audio-evaluacion.mp3"'},
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
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al sintetizar audio: {e}")
