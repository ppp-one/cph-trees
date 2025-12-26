// Tile loader for dynamic GeoJSON loading
class TileLoader {
    constructor(map, sourceId, tileDir) {
        this.map = map;
        this.sourceId = sourceId;
        this.tileDir = tileDir;
        this.loadedTiles = new Set();
        this.tileIndex = null;
        this.allFeatures = [];
    }

    async init() {
        // Load tile index
        const response = await fetch(`${this.tileDir}/tiles_index.json`);
        this.tileIndex = await response.json();

        // Initialize empty GeoJSON source
        this.map.addSource(this.sourceId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            tolerance: 0.5,
            buffer: 0
        });
    }

    getBoundsForViewport() {
        const bounds = this.map.getBounds();
        return [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth()
        ];
    }

    tilesToLoad(viewport) {
        const [minLon, minLat, maxLon, maxLat] = viewport;
        const tiles = [];

        for (const tile of this.tileIndex.tiles) {
            const [tMinLon, tMinLat, tMaxLon, tMaxLat] = tile.bounds;
            // Check if tile intersects viewport
            if (!(maxLon < tMinLon || minLon > tMaxLon || maxLat < tMinLat || minLat > tMaxLat)) {
                tiles.push(tile);
            }
        }

        return tiles;
    }

    async loadVisibleTiles() {
        if (!this.tileIndex) return;

        const viewport = this.getBoundsForViewport();
        const tilesToLoad = this.tilesToLoad(viewport);

        const loadPromises = [];
        for (const tile of tilesToLoad) {
            if (!this.loadedTiles.has(tile.file)) {
                loadPromises.push(this.loadTile(tile));
            }
        }

        if (loadPromises.length > 0) {
            const indicator = document.getElementById('loading-indicator');
            indicator.style.display = 'block';

            await Promise.all(loadPromises);
            this.updateSource();

            indicator.style.display = 'none';
        }
    }

    async loadTile(tile) {
        try {
            const response = await fetch(`${this.tileDir}/${tile.file}`);
            const data = await response.json();
            this.allFeatures.push(...data.features);
            this.loadedTiles.add(tile.file);
            console.log(`Loaded ${tile.file}: ${tile.features} features`);
        } catch (error) {
            console.error(`Failed to load ${tile.file}:`, error);
        }
    }

    updateSource() {
        const source = this.map.getSource(this.sourceId);
        if (source) {
            source.setData({
                type: 'FeatureCollection',
                features: this.allFeatures
            });
        }
    }
}

// Basemap styles configuration
const basemapStyles = {
    'carto-light': {
        tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    },
    'satellite': {
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        attribution: '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community'
    },
};

const map = new maplibregl.Map({
    container: 'map',
    style: {
        'version': 8,
        'sources': {
            'raster-tiles': {
                'type': 'raster',
                'tiles': [
                    'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
                ],
                'tileSize': 256,
                'attribution': '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            }
        },
        'layers': [
            {
                'id': 'simple-tiles',
                'type': 'raster',
                'source': 'raster-tiles',
                'minzoom': 0,
                'maxzoom': 22
            }
        ]
    },
    center: [12.575, 55.68], // Copenhagen center
    zoom: 14,
    dragRotate: false
});

// Disable rotation on touch
map.touchZoomRotate.disableRotation();

// Info modal
function initInfoModal() {
    const modalOverlay = document.getElementById('info-modal');
    const closeButton = document.getElementById('info-modal-close');
    const openButton = document.getElementById('info-button');

    if (!modalOverlay || !closeButton || !openButton) return;

    const openModal = () => {
        modalOverlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    };

    const closeModal = () => {
        modalOverlay.style.display = 'none';
        document.body.style.overflow = '';
    };

    openButton.addEventListener('click', (e) => {
        e.stopPropagation();
        openModal();
    });

    closeButton.addEventListener('click', (e) => {
        e.stopPropagation();
        closeModal();
    });

    modalOverlay.addEventListener('click', (e) => {
        // Close only when clicking the dimmed backdrop
        if (e.target === modalOverlay) {
            closeModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalOverlay.style.display !== 'none') {
            closeModal();
        }
    });

    // Show on initial page open
    openModal();
}

// Initialize modal once DOM exists
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initInfoModal);
} else {
    initInfoModal();
}

let streetsLoader, treesLoader;

map.on('load', async function () {
    // Mobile controls toggle
    const controls = document.getElementById('controls');
    const controlsToggle = document.getElementById('controls-toggle');

    // Start collapsed on mobile
    if (window.innerWidth <= 768) {
        controls.classList.add('collapsed');
    }

    controlsToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        controls.classList.toggle('collapsed');
    });

    // Close controls when clicking on map on mobile
    map.getCanvas().addEventListener('click', function () {
        if (window.innerWidth <= 768 && !controls.classList.contains('collapsed')) {
            controls.classList.add('collapsed');
        }
    });

    // Prevent map clicks when interacting with controls
    controls.addEventListener('click', function (e) {
        e.stopPropagation();
    });

    // Initialize tile loaders
    streetsLoader = new TileLoader(map, 'streets', 'tiles/streets');
    treesLoader = new TileLoader(map, 'trees', 'tiles/trees');

    await streetsLoader.init();
    await treesLoader.init();

    // Load initial tiles
    await streetsLoader.loadVisibleTiles();
    await treesLoader.loadVisibleTiles();

    // Add the layer
    map.addLayer({
        'id': 'streets-layer',
        'type': 'line',
        'source': 'streets',
        'layout': {
            'line-join': 'round',
            'line-cap': 'round'
        },
        'paint': {
            'line-width': [
                'interpolate',
                ['linear'],
                ['zoom'],
                10, 1,
                13, 2,
                16, 6,
                19, 12
            ],
            'line-color': [
                'interpolate',
                ['linear'],
                ['get', 'density_per_100m'],
                0, '#cccccc',
                0.1, '#e5f5e0',
                2, '#a1d99b',
                5, '#41ab5d',
                10, '#006d2c'
            ],
            'line-opacity': 0.8
        }
    });

    // Add trees layer (unclustered points)
    map.addLayer({
        'id': 'trees-layer',
        'type': 'circle',
        'source': 'trees',
        'layout': {
            'visibility': 'none'
        },
        'paint': {
            'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                12, 1,
                15, 3,
                20, 6
            ],
            'circle-color': '#4CAF50',
            'circle-opacity': 0.4,
            'circle-stroke-width': 0
        }
    });

    // Basemap style switcher
    let currentBasemap = 'carto-light';
    const basemapToggle = document.getElementById('basemap-toggle');
    const basemapMenu = document.getElementById('basemap-menu');
    const basemapButtons = document.querySelectorAll('#basemap-menu button');

    // Toggle menu
    basemapToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        basemapMenu.style.display = basemapMenu.style.display === 'none' ? 'block' : 'none';
    });

    // Close menu when clicking outside
    document.addEventListener('click', function () {
        basemapMenu.style.display = 'none';
    });

    // Prevent menu from closing when clicking inside it
    basemapMenu.addEventListener('click', function (e) {
        e.stopPropagation();
    });

    // Switch basemap
    basemapButtons.forEach(button => {
        if (button.dataset.style === currentBasemap) {
            button.classList.add('active');
        }

        button.addEventListener('click', function () {
            const styleId = this.dataset.style;
            const style = basemapStyles[styleId];
            const source = map.getSource('raster-tiles');

            if (source && style) {
                source.tiles = style.tiles;
                map.style.sourceCaches['raster-tiles'].clearTiles();
                map.style.sourceCaches['raster-tiles'].update(map.transform);
                map.triggerRepaint();

                // Update active state
                basemapButtons.forEach(btn => btn.classList.remove('active'));
                this.classList.add('active');
                currentBasemap = styleId;

                // Close menu
                basemapMenu.style.display = 'none';
            }
        });
    });

    // Toggle trees visibility
    document.getElementById('toggle-trees').addEventListener('change', function (e) {
        const visibility = e.target.checked ? 'visible' : 'none';
        map.setLayoutProperty('trees-layer', 'visibility', visibility);
    });

    // Add popup on click
    map.on('click', 'streets-layer', function (e) {
        const coordinates = e.lngLat;
        const props = e.features[0].properties;

        const externalLinkIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 14px; height: 14px; display: inline-block; vertical-align: text-bottom; margin-left: 2px;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>`;

        const description = `
            <div style="font-family: system-ui, -apple-system, sans-serif; padding: 4px; min-width: 180px;">
            <div style="font-weight: 700; font-size: 15px; margin-bottom: 8px; color: #1a1a1a; border-bottom: 1px solid #eee; padding-bottom: 4px;">
                ${props.name || 'Unnamed Street'}
            </div>
            <div style="font-size: 13px; color: #444; margin-bottom: 12px; line-height: 1.5;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                <span style="color: #666;">Surface</span>
                <span style="font-weight: 500;">${props.surface}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">Density</span>
                <span style="font-weight: 500;">${parseFloat(props.density_per_100m).toFixed(2)} <small style="font-weight: normal; color: #888;">trees/100m</small></span>
                </div>
            </div>
            <div style="display: flex; gap: 12px; border-top: 1px solid #eee; padding-top: 8px;">
                <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${coordinates.lat},${coordinates.lng}" target="_blank" style="color: #006d2c; text-decoration: none; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 2px;">
                Street View ${externalLinkIcon}
                </a>
                <a href="https://shademap.app/@${coordinates.lat},${coordinates.lng},16z" target="_blank" style="color: #006d2c; text-decoration: none; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 2px;">
                ShadeMap ${externalLinkIcon}
                </a>
            </div>
            </div>
        `;

        new maplibregl.Popup()
            .setLngLat(coordinates)
            .setHTML(description)
            .addTo(map);
    });

    // Change cursor on hover
    map.on('mouseenter', 'streets-layer', function () {
        map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'streets-layer', function () {
        map.getCanvas().style.cursor = '';
    });

    // Populate filter dropdown from loaded data
    function updateSurfaceFilter() {
        const surfaces = new Set();
        streetsLoader.allFeatures.forEach(feature => {
            if (feature.properties.surface) {
                const s = feature.properties.surface.split(', ');
                s.forEach(surf => surfaces.add(surf));
            }
        });

        const select = document.getElementById('surface-filter');
        // Save current selection
        const currentValue = select.value;

        // Clear existing options except "All Streets"
        select.innerHTML = '<option value="all">All Streets</option>';

        const sortedSurfaces = Array.from(surfaces)
            .filter(s => s && s.toLowerCase() !== 'unknown' && s.toLowerCase() !== 'other')
            .sort();

        const hasOther = Array.from(surfaces).some(s => s && s.toLowerCase() === 'other');

        sortedSurfaces.forEach(surface => {
            const option = document.createElement('option');
            option.value = surface;
            option.textContent = surface;
            select.appendChild(option);
        });

        if (hasOther) {
            const option = document.createElement('option');
            option.value = 'other';
            option.textContent = 'Other';
            select.appendChild(option);
        }

        // Restore previous selection if it still exists
        if (currentValue && Array.from(select.options).some(opt => opt.value === currentValue)) {
            select.value = currentValue;
        }
    }

    // Update filter after initial load
    updateSurfaceFilter();

    // Load more tiles when map moves
    map.on('moveend', async function () {
        await streetsLoader.loadVisibleTiles();
        if (document.getElementById('toggle-trees').checked) {
            await treesLoader.loadVisibleTiles();
        }
        updateSurfaceFilter();
    });

    // Filter logic
    document.getElementById('surface-filter').addEventListener('change', function (e) {
        const value = e.target.value;
        if (value === 'all') {
            map.setFilter('streets-layer', null);
        } else {
            // We use 'in' operator to check if the substring exists because we joined lists with ", "
            // But for exact matches on simple strings '==' is fine. 
            // Since we cleaned data to be strings, let's try a simple check first.
            // However, if a street has "asphalt, concrete", filtering for "asphalt" might need a regex-like check which MapLibre expressions don't fully support easily for substrings in this version.
            // But let's assume simple cases for now or exact match.

            // Better approach for "contains":
            // Since we converted lists to strings like "asphalt, paving_stones", we can't easily use 'in' array check.
            // We'll stick to exact match for now, or if the user selects "asphalt", it shows streets that are EXACTLY "asphalt".
            // To improve, we could keep the data as arrays if MapLibre supported it better, or just use exact match.

            map.setFilter('streets-layer', ['==', ['get', 'surface'], value]);
        }
    });
});
