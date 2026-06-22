---
title: AudioEvaluaciones TTS
sdk: docker
app_port: 7860
pinned: false
---

# AudioEvaluaciones TTS

FastAPI microservice for AudioEvaluaciones text-to-speech generation using ElevenLabs.

## Required environment variables

Configure these in the Hugging Face Space settings. Do not commit `.env` files or real secrets.

```env
TTS_ENGINE=elevenlabs
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ELEVENLABS_MODEL_ID=eleven_flash_v2_5
ELEVENLABS_STABILITY=0.70
ELEVENLABS_SIMILARITY_BOOST=0.85
ELEVENLABS_STYLE=0.10
ELEVENLABS_USE_SPEAKER_BOOST=true
ELEVENLABS_SPEED=0.90
ALLOWED_ORIGINS=http://localhost:5173,https://your-vercel-domain.vercel.app
```

## API

- `GET /health`
- `POST /synthesize`

`POST /synthesize` returns MP3 audio with `audio/mpeg`.
