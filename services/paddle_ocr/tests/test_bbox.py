"""Pure unit tests for bbox normalization -- no model loading, runs fast."""
import numpy as np

from main import to_bbox


def test_passes_through_axis_aligned_four_values():
    assert to_bbox([10, 20, 110, 60]) == [10.0, 20.0, 110.0, 60.0]


def test_normalizes_numpy_scalar_types():
    arr = np.array([np.int16(10), np.int64(20), np.int32(110), np.int16(60)])
    assert to_bbox(arr) == [10.0, 20.0, 110.0, 60.0]


def test_collapses_four_point_polygon_to_bounding_box():
    # [x,y] x4 corners, not already axis-aligned -- defensive fallback path.
    polygon = [[10, 20], [110, 22], [108, 60], [12, 58]]
    assert to_bbox(polygon) == [10.0, 20.0, 110.0, 60.0]
