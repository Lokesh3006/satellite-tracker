# AETHER // 3D Satellite & Radar Tracker

AETHER is a high-fidelity, real-time 3D web application designed to track artificial satellites orbiting Earth. It calculates and displays exactly which satellites are passing directly above your location in real-time, complete with orbital pathways, coverage footprints, and live telemetry.

## 🛰️ Key Features

- **Pulsing Observer Beacon:** Standard GPS location alignment or manual overrides.
- **Passing Overhead Radar:** Lists only the satellites passing above the observer's horizon, sorted by peak elevation.
- **Dynamic 3D Orbit Tracks:** Visualizes full-orbit trajectories with animated dashed paths showing orbit direction.
- **Radio Coverage Footprint:** Overlays translucent circles representing the line-of-sight visual coverage of selected satellites.
- **Live Telemetry Dashboard:** Renders real-time Altitude, Speed, Azimuth, Elevation, Range, and coordinates.
- **Lock-On Tracking:** Click to fly to and lock the camera target onto any orbiting satellite.
- **Zero-Dependency Python Proxy & Server:** Exposes a static file server and proxies Celestrak TLE queries, caching responses locally to bypass CORS and limit API requests.

## 🚀 Getting Started

### Prerequisites
- Python 3.x (Standard library only; no external package installations required)

### Run Locally

1. Clone or download this repository.
2. Open a terminal in the project directory.
3. Start the local server:
   ```bash
   python server.py
   ```
4. Open your web browser and visit:
   ```
   http://localhost:8000
   ```

## 🛠️ Built With

- **[Globe.gl](https://globe.gl/)** (Globe renderer)
- **[Three.js](https://threejs.org/)** (Underlying 3D engine)
- **[satellite.js](https://github.com/shashwatak/satellite-js)** (SGP4 orbital propagation)
- **Python Standard Library** (`http.server` & `urllib.request` backend)
- **Vanilla CSS** (High-tech glassmorphism overlays and radar-sweep styling)
