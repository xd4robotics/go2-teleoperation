import math
import base64
import struct
import unittest
from uuid import uuid4

from robot_gateway.livekit_command_receiver import gateway_action, validate_audio_message


class GatewayActionTest(unittest.TestCase):
    def test_maps_recovery_stand_to_posture_route(self):
        path, body = gateway_action("recovery_stand", {})

        self.assertEqual(path, "/api/control/posture")
        self.assertEqual(body, {"command": "recovery_stand"})

    def test_maps_analog_move_to_joystick_route(self):
        path, body = gateway_action(
            "move_analog",
            {"forward": 1, "lateral": -0.5, "yaw": 0.25},
        )

        self.assertEqual(path, "/api/control/joystick")
        self.assertEqual(
            body,
            {"forward": 1.0, "lateral": -0.5, "yaw": 0.25},
        )

    def test_rejects_invalid_analog_axes(self):
        invalid_payloads = (
            {},
            {"forward": 1.1, "lateral": 0, "yaw": 0},
            {"forward": 0, "lateral": math.nan, "yaw": 0},
            {"forward": 0, "lateral": False, "yaw": 0},
        )

        for payload in invalid_payloads:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                gateway_action("move_analog", payload)

    def test_maps_docking_commands_to_dedicated_routes(self):
        self.assertEqual(
            gateway_action("calibrate_docking_station", {}),
            ("/api/docking/calibrate", {}),
        )
        self.assertEqual(
            gateway_action("start_docking", {}),
            ("/api/docking/start", {}),
        )
        self.assertEqual(
            gateway_action("cancel_docking", {}),
            ("/api/docking/cancel", {}),
        )

    def test_validates_authenticated_wav_audio_packet(self):
        user_id = str(uuid4())
        wav = b"RIFF" + struct.pack("<I", 36) + b"WAVEfmt " + (b"\0" * 28)
        message = {
            "type": "go2.audio",
            "version": 1,
            "request_id": str(uuid4()),
            "stream_id": str(uuid4()),
            "robot_id": "primary",
            "user_id": user_id,
            "state": "chunk",
            "sequence": 2,
            "data": base64.b64encode(wav).decode("ascii"),
            "clip_id": str(uuid4()),
            "current_block_index": 1,
            "total_block_number": 1,
            "issued_at": 10_000,
            "expires_at": 15_000,
        }

        result = validate_audio_message(
            message,
            user_id + "-browser",
            now_ms=12_000,
        )

        self.assertEqual(result[2:4], ("chunk", 2))

    def test_rejects_audio_from_another_participant(self):
        user_id = str(uuid4())
        message = {
            "type": "go2.audio",
            "version": 1,
            "request_id": str(uuid4()),
            "stream_id": str(uuid4()),
            "robot_id": "primary",
            "user_id": user_id,
            "state": "start",
            "mode": "call",
            "sequence": 0,
            "data": "",
            "issued_at": 10_000,
            "expires_at": 15_000,
        }

        with self.assertRaisesRegex(ValueError, "identidade"):
            validate_audio_message(message, str(uuid4()) + "-browser", now_ms=12_000)

    def test_accepts_authenticated_audio_waiting_in_reliable_queue(self):
        user_id = str(uuid4())
        message = {
            "type": "go2.audio",
            "version": 1,
            "request_id": str(uuid4()),
            "stream_id": str(uuid4()),
            "robot_id": "primary",
            "user_id": user_id,
            "state": "start",
            "mode": "call",
            "sequence": 0,
            "data": "",
            "issued_at": 10_000,
            "expires_at": 18_000,
        }

        result = validate_audio_message(
            message,
            user_id + "-browser",
            now_ms=55_000,
        )

        self.assertEqual(result[2], "start")
        self.assertEqual(result[-1], "call")

    def test_accepts_immediate_authenticated_audio_stop(self):
        user_id = str(uuid4())
        message = {
            "type": "go2.audio",
            "version": 1,
            "request_id": str(uuid4()),
            "stream_id": str(uuid4()),
            "robot_id": "primary",
            "user_id": user_id,
            "state": "stop",
            "sequence": 3,
            "data": "",
            "immediate": True,
            "issued_at": 10_000,
            "expires_at": 15_000,
        }

        result = validate_audio_message(
            message,
            user_id + "-browser",
            now_ms=12_000,
        )

        self.assertEqual(result[2], "stop")
        self.assertIs(result[-2], True)

    def test_rejects_unknown_audio_mode(self):
        user_id = str(uuid4())
        message = {
            "type": "go2.audio",
            "version": 1,
            "request_id": str(uuid4()),
            "stream_id": str(uuid4()),
            "robot_id": "primary",
            "user_id": user_id,
            "state": "start",
            "mode": "speakerphone",
            "sequence": 0,
            "data": "",
            "issued_at": 10_000,
            "expires_at": 15_000,
        }

        with self.assertRaisesRegex(ValueError, "modo de áudio"):
            validate_audio_message(message, user_id + "-browser", now_ms=12_000)


if __name__ == "__main__":
    unittest.main()
