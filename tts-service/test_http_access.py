"""Actual FastAPI/ASGI routes. Configuration and provider are fictional; no .env or network."""
import importlib
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
config = types.ModuleType("app.config")
for name, value in {
    "ALLOWED_ORIGINS": ["http://localhost:5173"], "DEFAULT_VOICE_ID": "voz-ficticia",
    "ELEVENLABS_VOICE_ID": "voz-ficticia", "ELEVENLABS_VOICE_SETTINGS": {},
    "TTS_ENGINE": "elevenlabs", "VOICE_MAP": {}, "get_active_model_name": lambda: "modelo-ficticio",
    "has_configured_voice_id": lambda: True,
}.items():
    setattr(config, name, value)
sys.modules["app.config"] = config
provider = types.ModuleType("app.elevenlabs_service")
provider.synthesize_to_bytes = lambda **_kwargs: b"ID3FICTICIO"
sys.modules["app.elevenlabs_service"] = provider
from fastapi.testclient import TestClient
main = importlib.import_module("app.main")
security = importlib.import_module("app.access_control")


class HttpAccessTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict("os.environ", {
            "TTS_SERVICE_ACCESS_TOKEN": "servicio-ficticio-" * 4, "TTS_MAX_CHARACTERS": "5000",
            "TTS_MAX_CONCURRENT_REQUESTS": "1", "TTS_MAX_REQUESTS_PER_MINUTE": "2",
            "TTS_MAX_CHARACTERS_PER_MINUTE": "20000",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.headers = {"Authorization": "Bearer " + "servicio-ficticio-" * 4}
        main.admission = security.Admission()
        self.calls = 0
        self.fail_provider = False

        def synthesize(**_kwargs):
            self.calls += 1
            if self.fail_provider:
                raise RuntimeError("MARCADOR_PRIVADO_FICTICIO")
            return b"ID3FICTICIO"

        self.provider_patch = patch.object(main, "synthesize_to_bytes", synthesize)
        self.provider_patch.start()
        self.addCleanup(self.provider_patch.stop)
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)

    def test_unauthorized_and_missing_config_never_dispatch(self):
        self.assertEqual(self.client.get("/health").status_code, 200)
        for path in ["/configuration", "/voices", "/docs"]:
            self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.client.post("/synthesize", json={"text": "FICTICIO"}).status_code, 401)
        with patch.dict("os.environ", {"TTS_SERVICE_ACCESS_TOKEN": ""}):
            self.assertEqual(self.client.post("/synthesize", json={"text": "FICTICIO"}, headers=self.headers).status_code, 503)
        self.assertEqual(self.calls, 0)

    def test_authorized_contract_and_uncertain_failure_count(self):
        configuration = self.client.get("/configuration", headers=self.headers)
        self.assertEqual(configuration.status_code, 200)
        self.assertEqual(configuration.json()["contract"], 1)
        first = self.client.post("/synthesize", json={"text": "FICTICIO"}, headers=self.headers)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.content, b"ID3FICTICIO")
        self.assertTrue(first.headers.get("x-tts-configuration"))
        self.fail_provider = True
        failure = self.client.post("/synthesize", json={"text": "FICTICIO"}, headers=self.headers)
        self.assertEqual(failure.status_code, 503)
        self.assertNotIn("MARCADOR_PRIVADO", failure.text)
        self.assertEqual(self.client.post("/synthesize", json={"text": "FICTICIO"}, headers=self.headers).status_code, 429)
        self.assertEqual(self.calls, 2)

    def test_invalid_payload_voice_and_limits_never_dispatch(self):
        self.assertEqual(self.client.post("/synthesize", json={"text": "x" * 5001}, headers=self.headers).status_code, 413)
        self.assertEqual(self.client.post("/synthesize", json={"text": "FICTICIO", "voice_id": "otra-voz"}, headers=self.headers).status_code, 400)
        invalid = self.client.post("/synthesize", json={"text": {"dato": "PRIVADO_FICTICIO"}}, headers=self.headers)
        self.assertEqual(invalid.status_code, 422)
        self.assertNotIn("PRIVADO_FICTICIO", invalid.text)
        self.assertEqual(self.client.post("/synthesize", content=b"{}", headers={**self.headers, "Content-Length": "70000"}).status_code, 413)
        self.assertEqual(self.client.post("/synthesize", content=iter([b"{}"]), headers=self.headers).status_code, 411)
        self.assertEqual(self.calls, 0)


if __name__ == "__main__":
    unittest.main()
