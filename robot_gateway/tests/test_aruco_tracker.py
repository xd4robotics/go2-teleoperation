import unittest

import cv2
import numpy as np

from robot_gateway.aruco_tracker import ArucoTracker


class ArucoTrackerTest(unittest.TestCase):
    def test_detects_generated_marker_and_normalizes_geometry(self):
        tracker = ArucoTracker(("DICT_4X4_50",), max_width=640)
        dictionary = cv2.aruco.getPredefinedDictionary(
            cv2.aruco.DICT_4X4_50
        )
        marker = cv2.aruco.drawMarker(dictionary, 7, 180)
        canvas = np.full((360, 640), 255, dtype=np.uint8)
        canvas[90:270, 230:410] = marker
        frame = cv2.cvtColor(canvas, cv2.COLOR_GRAY2BGR)

        observation = tracker.detect(frame)

        self.assertEqual(observation["dictionary"], "DICT_4X4_50")
        self.assertEqual(observation["marker_id"], 7)
        self.assertEqual(observation["frame_width"], 640)
        self.assertEqual(observation["frame_height"], 360)
        self.assertAlmostEqual(observation["center_x"], 0.5, places=2)
        self.assertGreater(observation["side_ratio"], 0.25)
        self.assertAlmostEqual(
            observation["bounding_box"]["left"], 230 / 640, places=2
        )
        self.assertAlmostEqual(
            observation["bounding_box"]["top"], 90 / 360, places=2
        )
        self.assertGreater(observation["bounding_box"]["width"], 0.27)
        self.assertGreater(observation["bounding_box"]["height"], 0.49)
        self.assertTrue(tracker.status()["docking_marker_visible"])

    def test_blank_frame_has_no_marker(self):
        tracker = ArucoTracker(("DICT_4X4_50",))
        frame = np.full((240, 320, 3), 255, dtype=np.uint8)
        self.assertIsNone(tracker.detect(frame))
        self.assertIsNone(tracker.latest())


if __name__ == "__main__":
    unittest.main()
