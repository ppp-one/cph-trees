#!/usr/bin/env python3
"""
Split large GeoJSON files into geographic tiles for faster loading.
"""

import json
import os
from pathlib import Path


def get_bounds(feature):
    """Get bounding box of a feature."""
    coords = feature["geometry"]["coordinates"]
    geom_type = feature["geometry"]["type"]

    if geom_type == "Point":
        return coords[0], coords[1], coords[0], coords[1]
    elif geom_type == "LineString":
        lons = [c[0] for c in coords]
        lats = [c[1] for c in coords]
        return min(lons), min(lats), max(lons), max(lats)
    elif geom_type == "Polygon":
        lons = [c[0] for c in coords[0]]
        lats = [c[1] for c in coords[0]]
        return min(lons), min(lats), max(lons), max(lats)
    return None


def feature_intersects_tile(feature, tile_bounds):
    """Check if feature intersects with tile bounds."""
    feat_bounds = get_bounds(feature)
    if not feat_bounds:
        return False

    min_lon, min_lat, max_lon, max_lat = feat_bounds
    tile_min_lon, tile_min_lat, tile_max_lon, tile_max_lat = tile_bounds

    # Check for intersection
    return not (
        max_lon < tile_min_lon
        or min_lon > tile_max_lon
        or max_lat < tile_min_lat
        or min_lat > tile_max_lat
    )


def split_geojson(input_file, output_dir, grid_size=0.05):
    """
    Split GeoJSON into a grid of tiles.

    Args:
        input_file: Path to input GeoJSON
        output_dir: Directory to save tiles
        grid_size: Size of each tile in degrees (default: 0.05 = ~5km at Copenhagen latitude)
    """
    print(f"Loading {input_file}...")
    with open(input_file, "r") as f:
        data = json.load(f)

    features = data["features"]
    print(f"Loaded {len(features)} features")

    # Find overall bounds
    print("Calculating bounds...")
    all_bounds = [get_bounds(f) for f in features if get_bounds(f)]
    min_lon = min(b[0] for b in all_bounds)
    min_lat = min(b[1] for b in all_bounds)
    max_lon = max(b[2] for b in all_bounds)
    max_lat = max(b[3] for b in all_bounds)

    print(f"Bounds: {min_lon:.4f}, {min_lat:.4f}, {max_lon:.4f}, {max_lat:.4f}")

    # Create grid
    tiles = {}
    lon = min_lon
    tile_x = 0
    while lon < max_lon:
        lat = min_lat
        tile_y = 0
        while lat < max_lat:
            tile_bounds = (lon, lat, lon + grid_size, lat + grid_size)
            tiles[(tile_x, tile_y)] = {"bounds": tile_bounds, "features": []}
            lat += grid_size
            tile_y += 1
        lon += grid_size
        tile_x += 1

    print(f"Created {len(tiles)} tiles ({tile_x} x {tile_y} grid)")

    # Assign features to tiles
    print("Assigning features to tiles...")
    for i, feature in enumerate(features):
        if i % 10000 == 0:
            print(f"  Processed {i}/{len(features)} features")

        for tile_key, tile_data in tiles.items():
            if feature_intersects_tile(feature, tile_data["bounds"]):
                tile_data["features"].append(feature)

    # Write tiles
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)

    print(f"Writing tiles to {output_dir}...")
    tile_info = []

    for tile_key, tile_data in tiles.items():
        if len(tile_data["features"]) > 0:
            tile_x, tile_y = tile_key
            filename = f"tile_{tile_x}_{tile_y}.json"
            filepath = output_path / filename

            tile_geojson = {
                "type": "FeatureCollection",
                "features": tile_data["features"],
            }

            with open(filepath, "w") as f:
                json.dump(tile_geojson, f, separators=(",", ":"))

            file_size = filepath.stat().st_size / 1024  # KB
            bounds = tile_data["bounds"]

            tile_info.append(
                {
                    "file": filename,
                    "x": tile_x,
                    "y": tile_y,
                    "bounds": bounds,
                    "features": len(tile_data["features"]),
                    "size_kb": round(file_size, 1),
                }
            )

            print(
                f"  {filename}: {len(tile_data['features'])} features, {file_size:.1f} KB"
            )

    # Write tile index
    index_path = output_path / "tiles_index.json"
    with open(index_path, "w") as f:
        json.dump(
            {
                "grid_size": grid_size,
                "bounds": [min_lon, min_lat, max_lon, max_lat],
                "tiles": tile_info,
            },
            f,
            indent=2,
        )

    print(f"\nDone! Created {len(tile_info)} tiles")
    print(f"Tile index saved to {index_path}")

    total_size = sum(t["size_kb"] for t in tile_info)
    print(f"Total size: {total_size:.1f} KB ({total_size / 1024:.1f} MB)")


if __name__ == "__main__":
    # Split streets.geojson into tiles
    split_geojson("streets.geojson", "website/tiles/streets", grid_size=0.05)

    # Split trees.geojson into tiles (optional, it's smaller)
    if os.path.exists("trees.geojson"):
        split_geojson("trees.geojson", "website/tiles/trees", grid_size=0.05)
