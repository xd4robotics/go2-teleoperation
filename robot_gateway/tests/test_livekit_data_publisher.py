import json
import math
import unittest

from robot_gateway.livekit_data_publisher import json_safe, normalized_status


class LiveKitDockingStatusTest(unittest.TestCase):
    def test_replaces_non_finite_sensor_values_with_null(self):
        payload = json_safe(
            {"pose": {"x": 0.0, "y": math.nan, "z": math.inf}, "values": [1, -math.inf]}
        )

        self.assertEqual(
            json.dumps(payload, allow_nan=False),
            '{"pose": {"x": 0.0, "y": null, "z": null}, "values": [1, null]}',
        )

    def test_forwards_docking_state_to_dashboard(self):
        payload = normalized_status(
            {
                "robot_connected": True,
                "docking_station_calibrated": True,
                "docking_active": True,
                "docking_state": "navigating",
                "docking_distance_m": 1.25,
                "docking_adjustment_count": 2,
                "docking_next_adjustment_seconds": 8.0,
                "docking_marker_visible": True,
            }
        )

        self.assertTrue(payload["robot_online"])
        self.assertTrue(payload["docking_station_calibrated"])
        self.assertEqual(payload["docking_state"], "navigating")
        self.assertEqual(payload["docking_distance_m"], 1.25)
        self.assertTrue(payload["docking_marker_visible"])


if __name__ == "__main__":
    unittest.main()
