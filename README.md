# Copenhagen Tree Density 🌳

A visualization of street-tree density across Copenhagen, helping you find greener routes and see where street-tree coverage varies across the city.

**[Live Demo](https://cphtrees.netlify.app/)**

## Overview

This project analyzes the density of street trees in Copenhagen by calculating the number of trees per 100 meters for each street segment. The data is sourced from OpenStreetMap and visualized using MapLibre GL JS.

Studies have shown that higher street-tree density is associated with better mental health indicators and improved thermal comfort through shade and cooling.

## Features

- **Tree Density Heatmap**: Streets are colored based on trees per 100m.
- **Surface Filtering**: Filter streets by surface type (asphalt, cobblestone, etc.).
- **Individual Trees**: Toggle the visibility of individual tree points.
- **Street View Integration**: Click any street segment to open it in Google Street View.
- **Tiled Loading**: Large GeoJSON datasets are split into geographic tiles for performance.

## Project Structure

- `process_data.py`: Python script using `osmnx` and `geopandas` to fetch OSM data and calculate tree density.
- `split_geojson.py`: Utility to split large GeoJSON files into a grid of tiles for the web.
- `website/`: The frontend visualization built with MapLibre GL JS.
- `trees.geojson` & `streets.geojson`: Processed data files (not included in repo if large).

## Getting Started

### Data Processing

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Run the data processing script:
   ```bash
   python process_data.py
   ```
3. Split the data into tiles for the website:
   ```bash
   python split_geojson.py
   ```

### Local Development

To view the map locally, serve the `website` directory:

```bash
cd website
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

## Data Sources

- **OpenStreetMap**: Street and tree data.
- **Copenhagen Municipality**: Urban nature guidelines and data.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.

---
Made with ❤️ by [Peter Pihlmann Pedersen](https://www.ppp.one/)
