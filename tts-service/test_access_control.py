import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("access_control_under_test", Path(__file__).parent / "app" / "access_control.py")
security = importlib.util.module_from_spec(spec)
spec.loader.exec_module(security)


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "TTS_SERVICE_ACCESS_TOKEN": "ficticio-" * 8, "TTS_MAX_CHARACTERS": "5000",
            "TTS_MAX_CONCURRENT_REQUESTS": "1", "TTS_MAX_REQUESTS_PER_MINUTE": "2",
            "TTS_MAX_CHARACTERS_PER_MINUTE": "10",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_authorization_fails_closed(self):
        with self.assertRaises(security.AccessError):
            security.require_service_access(None)
        security.require_service_access("Bearer " + "ficticio-" * 8)
        del os.environ["TTS_SERVICE_ACCESS_TOKEN"]
        with self.assertRaises(security.AccessError) as error:
            security.require_service_access("Bearer cualquiera")
        self.assertEqual(error.exception.status, 503)

    def test_concurrency_and_failed_attempts_count(self):
        limiter = security.Admission()
        with self.assertRaises(RuntimeError):
            with limiter.slot("1234", "", "voz"):
                with self.assertRaises(security.AccessError):
                    with limiter.slot("1", "", "voz"):
                        self.fail("No debe despachar")
                raise RuntimeError("resultado incierto ficticio")
        with limiter.slot("1234", "", "voz"):
            pass
        with self.assertRaises(security.AccessError):
            with limiter.slot("1", "", "voz"):
                self.fail("No debe reembolsar intentos fallidos")

    def test_voice_length_and_minute_character_budget(self):
        limiter = security.Admission()
        for text, voice in [("x" * 5001, ""), ("texto", "otra-voz")]:
            with self.assertRaises(security.AccessError):
                with limiter.slot(text, voice, "voz"):
                    self.fail("Solicitud no válida")
        with limiter.slot("123456", "", "voz"):
            pass
        with self.assertRaises(security.AccessError):
            with limiter.slot("12345", "", "voz"):
                self.fail("Presupuesto superado")

    def test_window_expiry_and_bad_configuration(self):
        now = [0]
        limiter = security.Admission(clock=lambda: now[0])
        with limiter.slot("1234567890", "", "voz"):
            pass
        now[0] = 61
        with limiter.slot("1", "", "voz"):
            pass
        os.environ["TTS_MAX_CONCURRENT_REQUESTS"] = "0"
        with self.assertRaises(security.AccessError):
            with limiter.slot("1", "", "voz"):
                self.fail("Configuración inválida")


if __name__ == "__main__":
    unittest.main()
