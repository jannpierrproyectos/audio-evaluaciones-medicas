from pydantic import BaseModel, Field


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Texto a sintetizar")
    language: str = Field(default="es", description="Idioma de síntesis")
    voice_id: str = Field(default="", description="ID de la voz")
    format: str = Field(default="mp3", description="Formato de salida")
