import unittest

from motion_profile import (
    analog_velocity,
    remote_control_axes,
    speed_gain,
    velocity_limits,
)


class MotionProfileTest(unittest.TestCase):
    def test_full_stick_matches_go2_edu_native_limits(self):
        self.assertEqual(analog_velocity(1, 1, 1, 100), (3.7, 1.0, 4.0))
        self.assertEqual(analog_velocity(-1, -1, -1, 100), (-2.5, -1.0, -4.0))

    def test_levels_use_linear_control_curve(self):
        self.assertAlmostEqual(speed_gain(20), 0.2)
        for actual, expected in zip(
            analog_velocity(1, 1, 1, 20), (0.74, 0.2, 0.8)
        ):
            self.assertAlmostEqual(actual, expected)
        for actual, expected in zip(
            analog_velocity(-1, -1, -1, 20), (-0.5, -0.2, -0.8)
        ):
            self.assertAlmostEqual(actual, expected)

    def test_written_levels_have_exact_forward_limits(self):
        expected = {
            10: 0.37,
            20: 0.74,
            30: 1.11,
            40: 1.48,
            50: 1.85,
            60: 2.22,
            70: 2.59,
            80: 2.96,
            90: 3.33,
            100: 3.70,
        }
        for percent, forward_mps in expected.items():
            with self.subTest(percent=percent):
                self.assertAlmostEqual(
                    velocity_limits(percent)["forward"], forward_mps
                )

    def test_remote_transport_never_saturates_intermediate_levels(self):
        for percent in range(10, 101, 10):
            velocity = analog_velocity(1, 1, 1, percent)
            remote = remote_control_axes(*velocity)
            expected = speed_gain(percent)
            with self.subTest(percent=percent):
                self.assertAlmostEqual(remote[0], expected)
                self.assertAlmostEqual(remote[1], expected)
                self.assertAlmostEqual(remote[2], expected)

        self.assertEqual(remote_control_axes(3.7, 1, 4), (1.0, 1.0, 1.0))
        self.assertEqual(remote_control_axes(-2.5, -1, -4), (-1.0, -1.0, -1.0))

    def test_invalid_axis_is_rejected(self):
        for value in (None, True, float("nan"), 1.01, -1.01):
            with self.subTest(value=value), self.assertRaises(ValueError):
                analog_velocity(value, 0, 0, 100)

    def test_invalid_speed_is_rejected(self):
        for value in (None, True, float("nan"), -1, 101):
            with self.subTest(value=value), self.assertRaises(ValueError):
                speed_gain(value)


if __name__ == "__main__":
    unittest.main()
