import math
import unittest

from go2_native_ws.go2_slam.docking import (
    calibration_is_usable,
    marker_correction,
    navigation_command,
    normalize_angle,
)


def pose(x=0.0, y=0.0, yaw=0.0):
    return {
        "x": x,
        "y": y,
        "z": 0.0,
        "qx": 0.0,
        "qy": 0.0,
        "qz": math.sin(yaw / 2.0),
        "qw": math.cos(yaw / 2.0),
    }


class DockingTest(unittest.TestCase):
    def test_navigation_uses_robot_reference_and_stops_at_goal(self):
        command = navigation_command(pose(), pose(x=1.0, y=0.5))
        self.assertGreater(command["velocity"][0], 0.0)
        self.assertGreater(command["velocity"][1], 0.0)
        self.assertFalse(command["arrived"])

        arrived = navigation_command(pose(), pose(x=0.05, y=0.02))
        self.assertTrue(arrived["arrived"])
        self.assertEqual(arrived["velocity"], (0.0, 0.0, 0.0))

    def test_navigation_normalizes_yaw_across_pi(self):
        error = normalize_angle(math.radians(-358.0))
        self.assertAlmostEqual(error, math.radians(2.0))

    def test_marker_adjustment_is_small_and_matches_calibrated_tag(self):
        reference = {
            "dictionary": "DICT_4X4_50",
            "marker_id": 7,
            "center_x": 0.5,
            "side_ratio": 0.2,
        }
        observation = {
            "dictionary": "DICT_4X4_50",
            "marker_id": 7,
            "center_x": 0.62,
            "side_ratio": 0.15,
        }
        correction = marker_correction(observation, reference)
        self.assertGreater(correction["velocity"][0], 0.0)
        self.assertLess(correction["velocity"][1], 0.0)
        self.assertLessEqual(abs(correction["velocity"][0]), 0.08)
        self.assertIsNone(
            marker_correction(
                {**observation, "marker_id": 8},
                reference,
            )
        )

    def test_rejects_old_or_distant_calibration(self):
        calibration = {
            "frame": "odom",
            "pose": pose(x=2.0),
            "odom_stamp_seconds": 100.0,
        }
        usable, _ = calibration_is_usable(
            calibration,
            pose(),
            current_odom_stamp=120.0,
        )
        self.assertTrue(usable)

        usable, reason = calibration_is_usable(
            calibration,
            pose(),
            current_odom_stamp=10.0,
        )
        self.assertFalse(usable)
        self.assertIn("odometria reiniciada", reason)

        usable, reason = calibration_is_usable(
            {**calibration, "pose": pose(x=30.0)},
            pose(),
            current_odom_stamp=120.0,
        )
        self.assertFalse(usable)
        self.assertIn("25 metros", reason)


if __name__ == "__main__":
    unittest.main()
