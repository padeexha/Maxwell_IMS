import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import print_server


class FakeWin32Crypt:
    @staticmethod
    def CryptProtectData(data, description, entropy, reserved, prompt, flags):
        assert description == "Maxwell Printer Server"
        return b"encrypted:" + data

    @staticmethod
    def CryptUnprotectData(data, entropy, reserved, prompt, flags):
        assert data.startswith(b"encrypted:")
        return "Maxwell Printer Server", data[len(b"encrypted:"):]


class PrinterServerDpapiTests(unittest.TestCase):
    def test_agent_config_dpapi_round_trip_uses_bytes_payload(self):
        config = {"supabase_url": "https://example.supabase.co", "agent_token": "t" * 64}
        with patch.dict(sys.modules, {"win32crypt": FakeWin32Crypt}), patch.object(print_server.os, "name", "nt"):
            encrypted = print_server._protect_agent_config(config)
            self.assertIsInstance(encrypted, bytes)
            self.assertGreater(len(encrypted), 16)
            self.assertEqual(print_server._unprotect_agent_config(encrypted), config)


if __name__ == "__main__":
    unittest.main()
