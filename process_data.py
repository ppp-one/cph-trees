import geopandas as gpd
import osmnx as ox
import pandas as pd

# 1. Define the place or bounding box
# Using a larger bbox for Greater Copenhagen area
# North, South, East, West
north, south, east, west = 55.75, 55.41, 12.75, 12.40

# Configure osmnx to retrieve the 'surface' tag
ox.settings.useful_tags_way = list(ox.settings.useful_tags_way) + ["surface"]

print("Fetching data...")

# 2. Fetch Streets (Graph)
# We use 'drive' network type to get main streets, or 'all' for everything including paths.
# 'all' is better for trees which might be on pedestrian paths.
try:
    # osmnx 2.0+ expects bbox as a tuple (left, bottom, right, top) -> (west, south, east, north)
    bbox = (west, south, east, north)
    G = ox.graph_from_bbox(bbox, network_type="all")
    # Convert graph to GeoDataFrame (nodes and edges)
    gdf_nodes, gdf_edges = ox.graph_to_gdfs(G)
    print(f"Fetched {len(gdf_edges)} street segments.")
except Exception as e:
    print(f"Error fetching streets: {e}")
    exit()

# Ensure 'surface' column exists (fill 'unknown' if missing)
if "surface" not in gdf_edges.columns:
    gdf_edges["surface"] = "unknown"
else:
    gdf_edges["surface"] = gdf_edges["surface"].fillna("unknown")

# 3. Fetch Trees
tags = {"natural": ["tree", "tree_row"]}
try:
    # osmnx 2.0+ expects bbox as a tuple
    gdf_features = ox.features_from_bbox(bbox, tags)
    print(f"Fetched {len(gdf_features)} tree features.")
except Exception as e:
    print(f"Error fetching trees: {e}")
    # Create empty gdf if no trees found to prevent crash
    gdf_features = gpd.GeoDataFrame(
        columns=["geometry"], geometry="geometry", crs="EPSG:4326"
    )

# 4. Project to UTM (meters) for accurate distance calculation
# EPSG:25832 is ETRS89 / UTM zone 32N, suitable for Denmark
target_crs = "EPSG:25832"
gdf_edges_proj = gdf_edges.to_crs(target_crs)
gdf_features_proj = gdf_features.to_crs(target_crs)

# Separate Points (trees) and LineStrings (tree_rows)
gdf_trees_points = gdf_features_proj[gdf_features_proj.geometry.type == "Point"].copy()
gdf_tree_rows = gdf_features_proj[
    gdf_features_proj.geometry.type == "LineString"
].copy()

print(
    f"Found {len(gdf_trees_points)} individual trees and {len(gdf_tree_rows)} tree rows."
)

# Interpolate tree rows into points (approx 1 tree every 10m)
new_tree_points = []
for idx, row in gdf_tree_rows.iterrows():
    length = row.geometry.length
    if length > 0:
        # Assume 1 tree every 10 meters, at least 1
        num_trees = max(1, int(length / 10))
        for i in range(num_trees + 1):
            # Distribute evenly
            dist = (length / num_trees) * i
            point = row.geometry.interpolate(dist)
            new_tree_points.append(
                {"geometry": point, "natural": "tree_generated_from_row"}
            )

if new_tree_points:
    gdf_generated_trees = gpd.GeoDataFrame(new_tree_points, crs=target_crs)
    gdf_trees_proj = pd.concat(
        [gdf_trees_points, gdf_generated_trees], ignore_index=True
    )
else:
    gdf_trees_proj = gdf_trees_points

print(f"Total tree points after processing rows: {len(gdf_trees_proj)}")

# 5. Associate Trees with Nearest Street
print("Associating trees with streets...")
# sjoin_nearest finds the closest edge for each tree.
# 'max_distance' sets the 20m threshold.
joined = gpd.sjoin_nearest(
    gdf_trees_proj,
    gdf_edges_proj,
    how="left",
    distance_col="dist_to_street",
    max_distance=20,
)

print(f"Joined columns: {joined.columns}")

# Trees with no street within 20m will have NaN in index_right
# We want to tag trees with the street name (if available) or ID
# 'name' might be in the edge data.
if "name" in joined.columns:
    # Handle cases where name is a list
    joined["street_name"] = joined["name"].apply(
        lambda x: x[0] if isinstance(x, list) else x
    )
else:
    joined["street_name"] = "Unnamed Street"

# Filter for valid matches for density calculation
# When joining with a MultiIndex right dataframe, the index columns (u, v, key) are added as columns
# If no match, these will be NaN. We can check 'dist_to_street' or 'u'.
valid_trees = joined.dropna(subset=["dist_to_street"])
print(f"Matched {len(valid_trees)} trees to streets within 20m.")

# 6. Calculate Density
# Count trees per street edge. The unique identifier for an edge is (u, v, key).
tree_counts = valid_trees.groupby(["u", "v", "key"]).size().rename("tree_count")

# Join counts back to the edges GeoDataFrame
# gdf_edges_proj has (u, v, key) as index
gdf_edges_proj = gdf_edges_proj.join(tree_counts)
gdf_edges_proj["tree_count"] = gdf_edges_proj["tree_count"].fillna(0)

# Calculate density: Trees per 100 meters
# geometry.length is in meters, so divide by 100
gdf_edges_proj["density_per_100m"] = gdf_edges_proj["tree_count"] / (
    gdf_edges_proj.geometry.length / 100
)

# Handle potential division by zero or very short segments if necessary (though length shouldn't be 0)
gdf_edges_proj["density_per_100m"] = gdf_edges_proj["density_per_100m"].fillna(0)

# 7. Export for Frontend
print("Exporting to GeoJSON...")
# Reproject back to WGS84 (EPSG:4326) for web mapping
final_data = gdf_edges_proj.to_crs(epsg=4326)


# Clean up columns for smaller file size
# We need to handle list columns (like 'name', 'highway') which GeoJSON drivers might struggle with
def clean_column(val):
    if isinstance(val, list):
        return ", ".join([str(v) for v in val])
    return val


columns_to_keep = [
    "geometry",
    "name",
    "surface",
    "density_per_100m",
    "tree_count",
    "highway",
]
# Ensure columns exist
for col in columns_to_keep:
    if col not in final_data.columns:
        final_data[col] = None

final_data = final_data[columns_to_keep].copy()

for col in final_data.columns:
    if col != "geometry":
        final_data[col] = final_data[col].apply(clean_column)


# Simplify surface categories into broader groups
def simplify_surface(s):
    if not s or s == "unknown":
        return "Unknown"
    s = str(s).lower()
    if "asphalt" in s or "chipseal" in s:
        return "Asphalt"
    if (
        "paving_stones" in s
        or "sett" in s
        or "cobblestone" in s
        or "stone" in s
        or "rock" in s
        or "concrete" in s
        or "paved" in s
    ):
        return "Stone/Paving"
    if (
        "dirt" in s
        or "earth" in s
        or "ground" in s
        or "grass" in s
        or "mud" in s
        or "sand" in s
        or "unpaved" in s
        or "gravel" in s
        or "compacted" in s
        or "pebblestone" in s
    ):
        return "Unpaved/Natural"
    return "Other"


final_data["surface"] = final_data["surface"].apply(simplify_surface)

final_data.to_file("streets.geojson", driver="GeoJSON")
print("Done! Saved to streets.geojson")
# Export Trees
print("Exporting trees to GeoJSON...")
final_trees = gdf_trees_proj.to_crs(epsg=4326)
# Keep only geometry and maybe 'natural'
final_trees = final_trees[["geometry", "natural"]]
final_trees.to_file("trees.geojson", driver="GeoJSON")
print("Done! Saved to trees.geojson")
