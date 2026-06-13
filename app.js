// Global State
let observer = {
    latitude: 51.5074,  // Default: London, UK
    longitude: -0.1278,
    height: 0.0        // km above sea level
};

let satellites = [];         // Array of all loaded satellites
let selectedSat = null;      // Currently selected satellite
let isTracking = false;      // Camera tracking mode state
let showPath = true;        // Show orbit path state

let globe = null;            // Globe.gl instance
let updateTimer = null;      // Regular interval timer for UI updates
let animationFrameId = null; // requestAnimationFrame ID

// DOM Elements
const elTotalSat = document.getElementById('stat-total');
const elAboveSat = document.getElementById('stat-above');
const elDisplayLat = document.getElementById('display-lat');
const elDisplayLng = document.getElementById('display-lng');
const elBtnGPS = document.getElementById('btn-gps');
const elBtnToggleManual = document.getElementById('btn-toggle-manual');
const elManualForm = document.getElementById('manual-coords-form');
const elInputLat = document.getElementById('input-lat');
const elInputLng = document.getElementById('input-lng');
const elBtnApplyCoords = document.getElementById('btn-apply-coords');
const elSelectGroup = document.getElementById('select-group');
const elSearchInput = document.getElementById('search-input');
const elSatList = document.getElementById('satellite-list');
const elLocationStatus = document.getElementById('location-status');

// Details Panel DOM Elements
const elDetailsPanel = document.getElementById('details-panel');
const elDetailsName = document.getElementById('details-name');
const elDetailsId = document.getElementById('details-id');
const elDetailsVisibility = document.getElementById('details-visibility');
const elDetailsElevation = document.getElementById('details-elevation');
const elDetailsAzimuth = document.getElementById('details-azimuth');
const elDetailsAltitude = document.getElementById('details-altitude');
const elDetailsVelocity = document.getElementById('details-velocity');
const elDetailsRange = document.getElementById('details-range');
const elDetailsLat = document.getElementById('details-lat');
const elDetailsLng = document.getElementById('details-lng');
const elDetailsPeriod = document.getElementById('details-period');
const elBtnCloseDetails = document.getElementById('btn-close-details');
const elBtnFlyTo = document.getElementById('btn-flyto');
const elBtnTrack = document.getElementById('btn-track');
const elBtnOrbitPath = document.getElementById('btn-orbit-path');

// Toast Notification
const elToast = document.getElementById('toast');
const elToastIcon = document.getElementById('toast-icon');
const elToastMessage = document.getElementById('toast-message');

// Loading Overlay
const elLoadingOverlay = document.getElementById('loading-overlay');
const elLoadingStatus = document.getElementById('loading-status');

/* Toast Message Handler */
function showToast(message, type = 'info') {
    elToastMessage.textContent = message;
    elToast.className = 'toast';
    
    if (type === 'error') {
        elToast.classList.add('toast-error');
        elToastIcon.className = 'fa-solid fa-triangle-exclamation';
    } else if (type === 'success') {
        elToast.classList.add('toast-success');
        elToastIcon.className = 'fa-solid fa-circle-check';
    } else {
        elToastIcon.className = 'fa-solid fa-circle-info';
    }
    
    elToast.classList.remove('hidden');
    
    // Auto hide after 4 seconds
    setTimeout(() => {
        elToast.classList.add('hidden');
    }, 4000);
}

/* Format Coordinates for observer display */
function formatCoordinates(lat, lng) {
    const latStr = Math.abs(lat).toFixed(4) + '° ' + (lat >= 0 ? 'N' : 'S');
    const lngStr = Math.abs(lng).toFixed(4) + '° ' + (lng >= 0 ? 'E' : 'W');
    return { latStr, lngStr };
}

/* Parse Mean Motion to Orbital Period */
function getPeriodFromTle(tleLine2) {
    try {
        // TLE mean motion field is columns 53-63 (0-indexed 52 to 63)
        const meanMotionStr = tleLine2.substring(52, 63).trim();
        const meanMotion = parseFloat(meanMotionStr);
        if (!isNaN(meanMotion) && meanMotion > 0) {
            return (1440 / meanMotion); // Minutes in a day divided by revolutions per day
        }
    } catch (e) {
        console.error("Failed to parse period from TLE", e);
    }
    return 90; // Fallback to 90 minutes (typical LEO)
}

/* Earth Radius in km */
const EARTH_RADIUS_KM = 6371.0;

/* Calculate Coverage Angle in Radians */
function calculateCoverageAngle(altKm) {
    // theta = acos(R_earth / (R_earth + alt))
    if (altKm <= 0) return 0;
    return Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altKm));
}

/* Initialize 3D Globe */
function initGlobe() {
    globe = Globe()
        (document.getElementById('globe-container'))
        .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
        .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
        .backgroundColor('rgba(0,0,0,0)') // Transparent to reveal CSS background radial gradient
        .showAtmosphere(true)
        .atmosphereColor('#00e5ff')
        .atmosphereAltitude(0.18)
        .onCustomLayerHover(hoverObj => {
            // Can add custom hover effects if desired
        })
        .onCustomLayerClick(d => {
            selectSatellite(d);
        });

    // Custom Layer for Satellites (Render as 3D spheres)
    globe.customLayerData([])
        .customThreeObject(d => {
            const isStation = d.name.includes('ISS') || d.name.includes('CSS') || d.name.includes('TIANGONG') || d.name.includes('SPACE STATION');
            const size = isStation ? 1.0 : 0.45;
            const color = isStation ? '#ff007f' : '#00e5ff'; // Stations = magenta, satellites = cyan

            // Sphere geometry
            const geometry = new THREE.SphereGeometry(size, 8, 8);
            const material = new THREE.MeshBasicMaterial({ 
                color: new THREE.Color(color),
                transparent: true,
                opacity: 0.9
            });
            const mesh = new THREE.Mesh(geometry, material);
            
            // Subtle glow shell
            const glowGeom = new THREE.SphereGeometry(size * 1.5, 8, 8);
            const glowMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(color),
                transparent: true,
                opacity: 0.2,
                blending: THREE.AdditiveBlending
            });
            const glowMesh = new THREE.Mesh(glowGeom, glowMat);

            const group = new THREE.Group();
            group.add(mesh);
            group.add(glowMesh);
            return group;
        })
        .customThreeObjectUpdate((obj, d) => {
            if (d.lat === undefined || d.lng === undefined || d.alt === undefined) return;
            const { x, y, z } = globe.getCoords(d.lat, d.lng, d.alt);
            obj.position.set(x, y, z);
            
            // Dynamically colour if selected
            const isSelected = selectedSat && selectedSat.noradId === d.noradId;
            const mainMesh = obj.children[0];
            const glowMesh = obj.children[1];
            if (isSelected) {
                mainMesh.material.color.setHex(0xffe600); // Yellow highlight
                glowMesh.material.color.setHex(0xffe600);
                glowMesh.scale.setScalar(2.0); // Make glow bigger
            } else {
                const isStation = d.name.includes('ISS') || d.name.includes('CSS') || d.name.includes('TIANGONG') || d.name.includes('SPACE STATION');
                const defaultColor = isStation ? 0xff007f : 0x00e5ff;
                mainMesh.material.color.setHex(defaultColor);
                glowMesh.material.color.setHex(defaultColor);
                glowMesh.scale.setScalar(1.0);
            }
        });

    // Handle breaks in camera tracking mode when user drags the globe
    const controls = globe.controls();
    if (controls) {
        controls.addEventListener('start', () => {
            if (isTracking) {
                isTracking = false;
                elBtnTrack.classList.remove('active');
                elBtnTrack.innerHTML = '<i class="fa-solid fa-lock"></i> Track Orbit';
                showToast("Orbital camera tracking disabled.", "info");
            }
        });
    }

    // Set initial position
    updateObserverMarker();
    
    // Zoom to observer location
    globe.pointOfView({ lat: observer.latitude, lng: observer.longitude, altitude: 2.2 }, 1500);
}

/* Update Observer Marker (Rings at current observer site) */
function updateObserverMarker() {
    if (!globe) return;
    
    // Set ring representing observer
    globe.ringsData([
        {
            latitude: observer.latitude,
            longitude: observer.longitude,
            maxRadius: 2.5,
            propagationSpeed: 1.5,
            repeatPeriod: 1500
        }
    ])
    .ringColor(() => '#00e5ff')
    .ringMaxRadius('maxRadius')
    .ringPropagationSpeed('propagationSpeed')
    .ringRepeatPeriod('repeatPeriod');

    // Update coordinates display
    const formatted = formatCoordinates(observer.latitude, observer.longitude);
    elDisplayLat.textContent = formatted.latStr;
    elDisplayLng.textContent = formatted.lngStr;
    
    // Update inputs
    elInputLat.value = observer.latitude.toFixed(4);
    elInputLng.value = observer.longitude.toFixed(4);
}

/* Fetch Satellite TLEs via local proxy */
async function fetchGroupData(group) {
    elLoadingOverlay.classList.remove('fade-out');
    elLoadingStatus.textContent = `Connecting to server and retrieving ${group} data...`;
    
    try {
        const response = await fetch(`/api/tle?group=${group}`);
        if (!response.ok) {
            throw new Error(`Server returned HTTP error ${response.status}`);
        }
        
        const data = await response.ok ? await response.json() : [];
        if (data.error) {
            throw new Error(data.error);
        }
        
        // Convert plain data to SGP4 satrec objects
        satellites = data.map(item => {
            try {
                const satrec = window.satellite.twoline2satrec(item.line1, item.line2);
                const period = getPeriodFromTle(item.line2);
                return {
                    ...item,
                    satrec,
                    period
                };
            } catch (err) {
                console.error(`Error parsing TLE for ${item.name}:`, err);
                return null;
            }
        }).filter(item => item !== null);

        elTotalSat.textContent = satellites.length;
        showToast(`Loaded ${satellites.length} satellites successfully!`, "success");
        
        // Reset selected sat since we changed group
        deselectSatellite();
        
    } catch (error) {
        console.error("Error fetching TLE data:", error);
        showToast(`Failed to load satellite data: ${error.message}`, "error");
    } finally {
        elLoadingOverlay.classList.add('fade-out');
    }
}

/* Core calculations: Propagate positions and Look Angles */
function propagateSatellites(time = new Date()) {
    if (satellites.length === 0) return;
    
    const gmst = window.satellite.gstime(time);
    
    const observerGd = {
        latitude: window.satellite.degreesToRadians(observer.latitude),
        longitude: window.satellite.degreesToRadians(observer.longitude),
        height: observer.height
    };
    
    satellites.forEach(sat => {
        try {
            const positionAndVelocity = window.satellite.propagate(sat.satrec, time);
            const positionEci = positionAndVelocity.position;
            
            if (positionEci && !isNaN(positionEci.x)) {
                // Compute Geodetic coords (lat, lng, height)
                const positionGd = window.satellite.eciToGeodetic(positionEci, gmst);
                sat.lat = window.satellite.radiansToDegrees(positionGd.latitude);
                sat.lng = window.satellite.radiansToDegrees(positionGd.longitude);
                sat.alt = positionGd.height / EARTH_RADIUS_KM; // altitude in Earth radii (for globe.gl coords)
                sat.altitudeKm = positionGd.height;
                
                // Velocity/Speed calculation
                const vel = positionAndVelocity.velocity;
                if (vel && !isNaN(vel.x)) {
                    sat.speed = Math.sqrt(vel.x*vel.x + vel.y*vel.y + vel.z*vel.z); // km/s
                } else {
                    sat.speed = 0;
                }

                // Look Angles (relative to observer)
                const positionEcf = window.satellite.eciToEcf(positionEci, gmst);
                const lookAngles = window.satellite.ecfToLookAngles(observerGd, positionEcf);
                
                sat.elevation = window.satellite.radiansToDegrees(lookAngles.elevation);
                sat.azimuth = window.satellite.radiansToDegrees(lookAngles.azimuth);
                sat.range = lookAngles.rangeSat; // distance in km
            } else {
                sat.lat = undefined;
                sat.lng = undefined;
                sat.alt = undefined;
                sat.altitudeKm = 0;
                sat.speed = 0;
                sat.elevation = -90;
                sat.azimuth = 0;
                sat.range = 999999;
            }
        } catch (e) {
            // Fail silently on single calculations
            sat.lat = undefined;
        }
    });
}

/* Render loop */
function renderTick() {
    const now = new Date();
    
    // Propagate all satellites to current time
    propagateSatellites(now);
    
    // Update Globe data
    if (globe) {
        // Exclude failed propagations
        const activeSats = satellites.filter(s => s.lat !== undefined);
        globe.customLayerData(activeSats);
        
        // Camera Lock/Track logic
        if (isTracking && selectedSat) {
            const liveSat = satellites.find(s => s.noradId === selectedSat.noradId);
            if (liveSat && liveSat.lat !== undefined) {
                // Get current camera distance
                const currentPov = globe.pointOfView();
                globe.pointOfView({
                    lat: liveSat.lat,
                    lng: liveSat.lng,
                    altitude: currentPov.altitude
                }, 0); // instantly align
            }
        }
    }
    
    animationFrameId = requestAnimationFrame(renderTick);
}

/* Generate 3D orbit line coordinates */
function generateOrbitPath(sat, time = new Date()) {
    const points = [];
    const periodMin = sat.period || 90;
    const gmst = window.satellite.gstime(time);
    
    // Generate 120 points for 1 orbit period to make a smooth line
    const numPoints = 120;
    const stepMin = periodMin / numPoints;
    
    for (let i = 0; i <= numPoints; i++) {
        const propTime = new Date(time.getTime() + i * stepMin * 60000);
        const positionAndVelocity = window.satellite.propagate(sat.satrec, propTime);
        const positionEci = positionAndVelocity.position;
        
        if (positionEci && !isNaN(positionEci.x)) {
            const positionGd = window.satellite.eciToGeodetic(positionEci, window.satellite.gstime(propTime));
            const lat = window.satellite.radiansToDegrees(positionGd.latitude);
            const lng = window.satellite.radiansToDegrees(positionGd.longitude);
            const alt = positionGd.height / EARTH_RADIUS_KM;
            
            points.push({ lat, lng, alt });
        }
    }
    return points;
}

/* Highlight Selected Satellite on Earth (Draw Orbit & Coverage cone) */
function drawSelectedSatelliteFeatures() {
    if (!globe || !selectedSat) {
        globe.pathsData([]);
        return;
    }
    
    // 1. Draw Orbit Line
    if (showPath) {
        const orbitPoints = generateOrbitPath(selectedSat);
        globe.pathsData([orbitPoints])
            .pathColor(() => '#9d4edd') // neon purple path
            .pathDashLength(0.01)
            .pathDashGap(0.005)
            .pathDashAnimateTime(9000) // Animated dashes showing satellite direction!
            .pathStroke(2.0);
    } else {
        globe.pathsData([]);
    }
    
    // 2. Draw footprint & satellite sub-point rings
    const coverageAngle = calculateCoverageAngle(selectedSat.altitudeKm);
    const coverageDeg = window.satellite.radiansToDegrees(coverageAngle);
    
    // Include observer ring + satellite sub-point ring + coverage footprint ring
    const rings = [
        // Observer location pulsing ring
        {
            latitude: observer.latitude,
            longitude: observer.longitude,
            maxRadius: 2.5,
            propagationSpeed: 1.5,
            repeatPeriod: 1500,
            color: '#00e5ff'
        }
    ];
    
    if (selectedSat.lat !== undefined) {
        // Satellite subpoint dot
        rings.push({
            latitude: selectedSat.lat,
            longitude: selectedSat.lng,
            maxRadius: 1.0,
            propagationSpeed: 0,
            repeatPeriod: 0,
            color: 'rgba(255, 230, 0, 0.8)' // Yellow subpoint dot
        });
        
        // Satellite radio footprint (coverage area)
        rings.push({
            latitude: selectedSat.lat,
            longitude: selectedSat.lng,
            maxRadius: coverageDeg,
            propagationSpeed: 0,
            repeatPeriod: 0,
            color: 'rgba(157, 78, 221, 0.25)' // Translucent neon purple cone footprint
        });
    }
    
    globe.ringsData(rings)
        .ringColor(r => r.color)
        .ringMaxRadius(r => r.maxRadius)
        .ringPropagationSpeed(r => r.propagationSpeed)
        .ringRepeatPeriod(r => r.repeatPeriod);
}

/* Select Satellite */
function selectSatellite(sat) {
    selectedSat = sat;
    
    // Add active styling in the sidebar list
    const items = elSatList.querySelectorAll('.sat-list-item');
    items.forEach(item => {
        if (item.dataset.id === sat.noradId) {
            item.classList.add('selected');
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });

    // Populate Details Panel
    elDetailsName.textContent = sat.name;
    elDetailsId.textContent = sat.noradId;
    
    // Draw features on globe
    drawSelectedSatelliteFeatures();
    
    // Open details sidebar
    elDetailsPanel.classList.remove('hidden');
    
    // Trigger instant UI update for telemetry
    updateTelemetryDetails();
}

/* Deselect Satellite */
function deselectSatellite() {
    selectedSat = null;
    isTracking = false;
    
    // Reset buttons
    elBtnTrack.classList.remove('active');
    elBtnTrack.innerHTML = '<i class="fa-solid fa-lock"></i> Track Orbit';
    
    // Reset rings to observer only
    updateObserverMarker();
    
    // Remove lines
    if (globe) {
        globe.pathsData([]);
    }
    
    // Hide panel
    elDetailsPanel.classList.add('hidden');
    
    // Clear selections in lists
    const items = elSatList.querySelectorAll('.sat-list-item');
    items.forEach(item => item.classList.remove('selected'));
}

/* Update Telemetry values in right details panel */
function updateTelemetryDetails() {
    if (!selectedSat) return;
    
    // Retrieve live computed object
    const liveSat = satellites.find(s => s.noradId === selectedSat.noradId);
    if (!liveSat || liveSat.lat === undefined) return;
    
    const isAbove = liveSat.elevation > 0;
    
    elDetailsVisibility.textContent = isAbove ? "PASSING OVERHEAD" : "BELOW HORIZON";
    elDetailsVisibility.className = "tel-value font-mono " + (isAbove ? "neon-green" : "text-muted");
    
    elDetailsElevation.textContent = liveSat.elevation.toFixed(1) + '°';
    elDetailsElevation.className = "tel-value font-mono " + (isAbove ? "neon-blue" : "text-primary");
    
    elDetailsAzimuth.textContent = liveSat.azimuth.toFixed(1) + '°';
    elDetailsAltitude.textContent = Math.round(liveSat.altitudeKm) + ' km';
    elDetailsVelocity.textContent = liveSat.speed.toFixed(2) + ' km/s';
    elDetailsRange.textContent = Math.round(liveSat.range) + ' km';
    
    const latFormatted = Math.abs(liveSat.lat).toFixed(3) + '° ' + (liveSat.lat >= 0 ? 'N' : 'S');
    const lngFormatted = Math.abs(liveSat.lng).toFixed(3) + '° ' + (liveSat.lng >= 0 ? 'E' : 'W');
    elDetailsLat.textContent = latFormatted;
    elDetailsLng.textContent = lngFormatted;
    
    elDetailsPeriod.textContent = liveSat.period ? liveSat.period.toFixed(1) + ' min' : '--.- min';
    
    // Redraw coverage rings and nadir points real-time
    drawSelectedSatelliteFeatures();
}

/* Update Dashboard Sidebar Lists (Run every 1s) */
function updateUILists() {
    // 1. Identify above satellites
    const searchVal = elSearchInput.value.toLowerCase().trim();
    
    // Propagate already run, just filter
    let filteredSats = satellites.filter(s => {
        const matchesSearch = s.name.toLowerCase().includes(searchVal) || s.noradId.includes(searchVal);
        return matchesSearch;
    });

    // Check which are above the observer's horizon
    const aboveSats = filteredSats.filter(s => s.elevation > 0);
    
    // Sort above satellites by elevation (highest first)
    aboveSats.sort((a, b) => b.elevation - a.elevation);
    
    elAboveSat.textContent = aboveSats.length;

    // Render list
    if (aboveSats.length === 0) {
        elSatList.innerHTML = `
            <div class="empty-list-message">
                <i class="fa-solid fa-satellite fa-fade"></i>
                <p>${filteredSats.length === 0 ? 'No matching satellites found.' : 'No satellites overhead at this location.'}</p>
            </div>`;
    } else {
        let html = '';
        aboveSats.forEach(sat => {
            const isSelected = selectedSat && selectedSat.noradId === sat.noradId;
            const isStation = sat.name.includes('ISS') || sat.name.includes('CSS') || sat.name.includes('TIANGONG') || sat.name.includes('SPACE STATION');
            const elevationColor = sat.elevation > 45 ? 'neon-green' : (sat.elevation > 15 ? 'neon-blue' : 'neon-orange');
            const typeIcon = isStation ? '🛸' : '🛰️';
            
            html += `
                <div class="sat-list-item ${isSelected ? 'selected' : ''}" data-id="${sat.noradId}">
                    <div class="sat-item-info">
                        <span class="sat-item-name">${typeIcon} ${sat.name}</span>
                        <span class="sat-item-sub">NORAD: ${sat.noradId} | Rng: ${Math.round(sat.range)}km</span>
                    </div>
                    <div class="sat-item-elevation ${elevationColor}">
                        ${sat.elevation.toFixed(1)}°
                    </div>
                </div>`;
        });
        elSatList.innerHTML = html;
        
        // Re-attach click listeners to items
        const items = elSatList.querySelectorAll('.sat-list-item');
        items.forEach(item => {
            item.addEventListener('click', () => {
                const satId = item.dataset.id;
                const found = satellites.find(s => s.noradId === satId);
                if (found) selectSatellite(found);
            });
        });
    }

    // Update Telemetry Panel if active
    if (selectedSat) {
        updateTelemetryDetails();
    }
}

/* Setup Event Handlers */
function setupEventHandlers() {
    // Group Selection Change
    elSelectGroup.addEventListener('change', (e) => {
        fetchGroupData(e.target.value);
    });

    // Search Box Change
    elSearchInput.addEventListener('input', () => {
        updateUILists();
    });

    // Toggle Manual Coords Form
    elBtnToggleManual.addEventListener('click', () => {
        elManualForm.classList.toggle('collapsed');
        elBtnToggleManual.classList.toggle('active');
    });

    // Apply Manual Coordinates
    elBtnApplyCoords.addEventListener('click', () => {
        const lat = parseFloat(elInputLat.value);
        const lng = parseFloat(elInputLng.value);
        
        if (isNaN(lat) || lat < -90 || lat > 90) {
            showToast("Invalid Latitude (-90 to 90)", "error");
            return;
        }
        if (isNaN(lng) || lng < -180 || lng > 180) {
            showToast("Invalid Longitude (-180 to 180)", "error");
            return;
        }
        
        observer.latitude = lat;
        observer.longitude = lng;
        
        elLocationStatus.textContent = "MANUAL SITE";
        elLocationStatus.className = "status-badge manual";
        
        updateObserverMarker();
        deselectSatellite();
        
        // Recompute lists instantly
        propagateSatellites();
        updateUILists();
        
        showToast("Observer site updated manually.", "success");
        
        // Smoothly fly camera to user location
        globe.pointOfView({ lat: observer.latitude, lng: observer.longitude, altitude: 2.2 }, 1200);
    });

    // Geolocation Request (GPS)
    elBtnGPS.addEventListener('click', () => {
        if (!navigator.geolocation) {
            showToast("Geolocation is not supported by your browser.", "error");
            return;
        }
        
        elLocationStatus.textContent = "LOCATING...";
        elLocationStatus.className = "status-badge manual";
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                observer.latitude = position.coords.latitude;
                observer.longitude = position.coords.longitude;
                
                elLocationStatus.textContent = "GPS ACTIVE";
                elLocationStatus.className = "status-badge gps-on";
                
                updateObserverMarker();
                deselectSatellite();
                
                // Recompute lists instantly
                propagateSatellites();
                updateUILists();
                
                showToast("GPS coordinates acquired!", "success");
                
                // Smoothly fly camera to user location
                globe.pointOfView({ lat: observer.latitude, lng: observer.longitude, altitude: 2.2 }, 1200);
            },
            (error) => {
                console.error("GPS Error:", error);
                elLocationStatus.textContent = "GPS FAILED";
                elLocationStatus.className = "status-badge gps-off";
                showToast(`GPS Access Denied: ${error.message}. Using default location.`, "error");
            },
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
    });

    // Details Panel Buttons
    elBtnCloseDetails.addEventListener('click', () => {
        deselectSatellite();
    });

    elBtnFlyTo.addEventListener('click', () => {
        if (!selectedSat || selectedSat.lat === undefined) return;
        globe.pointOfView({
            lat: selectedSat.lat,
            lng: selectedSat.lng,
            altitude: 1.0  // Zoom in closer (altitude = 1.0)
        }, 1500); // 1.5s fly time
        showToast(`Focusing camera on ${selectedSat.name}`, "info");
    });

    elBtnTrack.addEventListener('click', () => {
        isTracking = !isTracking;
        
        if (isTracking) {
            elBtnTrack.classList.add('active');
            elBtnTrack.innerHTML = '<i class="fa-solid fa-unlock"></i> Unlock Camera';
            showToast(`Camera locked to ${selectedSat.name}. Drag globe to unlock.`, "success");
        } else {
            elBtnTrack.classList.remove('active');
            elBtnTrack.innerHTML = '<i class="fa-solid fa-lock"></i> Track Orbit';
            showToast(`Camera unlocked from satellite.`, "info");
        }
    });

    elBtnOrbitPath.addEventListener('click', () => {
        showPath = !showPath;
        elBtnOrbitPath.classList.toggle('active', showPath);
        drawSelectedSatelliteFeatures();
    });
}

/* App Initialization Entry Point */
async function startApp() {
    console.log("Initializing AETHER Tracker...");
    
    // Initialize 3D View
    initGlobe();
    
    // Set event handlers
    setupEventHandlers();
    
    // Load initial group (Visible / Brightest)
    await fetchGroupData('visual');
    
    // Start propagating values
    renderTick();
    
    // Start regular interface update timer (every 1 sec)
    updateTimer = setInterval(updateUILists, 1000);
    
    // Remove loading overlay
    elLoadingOverlay.classList.add('fade-out');
}

// Start app once document is ready
window.addEventListener('DOMContentLoaded', () => {
    // Delay slightly to allow fonts to load and animations to set
    setTimeout(startApp, 500);
});
