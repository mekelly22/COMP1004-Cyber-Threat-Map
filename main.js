/*

  Sources:
  - Canvas API: https://www.w3schools.com/tags/ref_canvas.asp
  - requestAnimationFrame: https://www.w3schools.com/jsref/met_win_requestanimationframe.asp
  - Map: https://www.w3schools.com/jsref/obj_map.asp
  - Array methods: https://www.w3schools.com/js/js_array_methods.asp
*/

//call DOM refernces
const canvas = document.getElementById('map');
const context = canvas.getContext('2d'); 

const receiverCountriesListElement = document.getElementById('receiver-countries-list');
const attackListElement = document.getElementById('attack-list');

const receiverCountriesHeader = document.getElementById('receiver-countries-header');
const receiverCountriesList = document.getElementById('receiver-countries-list');
const receiverCountriesToggleIcon = document.getElementById('receiver-countries-toggle-icon');
const receiverCountriesSidebar = document.getElementById('receiver-countries-sidebar');

const attackSidebarHeader = document.getElementById('attack-sidebar-header');
const attackList = document.getElementById('attack-list');
const attackToggleIcon = document.getElementById('attack-toggle-icon');
const attackSidebar = document.getElementById('attack-sidebar');

const settingsButton = document.getElementById('settings-button');
const settingsPanel = document.getElementById('settings-panel');
const themeToggle = document.getElementById('theme-toggle');
const body = document.body;

//modal DOM references
const countryAttackDetailModal = document.getElementById('country-attack-detail-modal');
const modalCountryName = document.getElementById('modal-country-name');
const countryIncidentsList = document.getElementById('country-incidents-list');
const modalCloseBtn = document.getElementById('modal-close-btn');
const exportJsonBtn = document.getElementById('export-json-btn');

//define colours for the attck types
const ATTACK_TYPE_COLOURS = {
    'Hijacking with Misuse': '#ff8700',
    'Hijacking without Misuse': '#6610f2',
    'Disruption': '#04e762',
    'Data theft': '#ffea00',
    'Ransomware': '#ff0000',
    'Data theft & Doxing': '#ff0f80',
    'Unknown': '#A0A0A0'
}
//define settings for the map animation/ appearance
const THREAT_MAP_SETTINGS = { 
    curveOverflowPadding: 120,
    timelineSecondsPerDay: 0.5,
    routeRevealDurationSeconds: 0.7,
    routeVisibleDurationSeconds: 3.8, 
    routeStrokeWidth: 2.2,
    routeGlowWidth: 4.2,
    maxVisibleRoutes: 200,
};

const BACKGROUND_MAP_ASPECT_RATIO = 2000 / 1039; //map image size

//variables
let canvasWidth = 0;
let canvasHeight = 0;
let pixelRatio = 1;
let animationFrameId = null;
let activeThemePalette = null;
let mapProjectionBounds = { x: 0, y: 0, width: 0, height: 0 };

let SIMULATION_DAYS = 1; 

let combinedThreatRoutes = [];
let projectedThreatRoutes = [];
let projectedNodes = [];

let lastSidebarUpdateTimestamp = -1;
let simulationStartTimestamp = null;
let simulationCompleted = false;

let countryToIncidentsMap = {}; // Map of country names to all incidents affecting that country
let currentSelectedCountry = null; // Currently displayed country in the modal
let currentSelectedIncidents = []; // All incidents for the currently selected country

//Functions
// Convert hex color to RGBA format 
function hexToRgba(hexColor, alpha) {
    const normalizedHex = hexColor.replace('#', '');
    const fullHex = normalizedHex.length === 3
        ? normalizedHex.split('').map(c => c + c).join('')
        : normalizedHex;
    const red = Number.parseInt(fullHex.slice(0, 2), 16);
    const green = Number.parseInt(fullHex.slice(2, 4), 16);
    const blue = Number.parseInt(fullHex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
} 

//parse the date string into a timestamp
function safeTimestampFromDate(dateString) {
    const timestamp = Date.parse(dateString);
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

// Check if a geo point has valid coordinates
function isValidGeoPoint(geoPoint) {
    if (!geoPoint) return false;
    const { latitude, longitude } = geoPoint;
    return Number.isFinite(latitude) && Number.isFinite(longitude);
}

// Parse incident types from semicolon-separated string
function parseIncidentTypes(incidentType) {
    return (incidentType || '').split(';').map(t => t.trim()).filter(Boolean);
}

//Computes how many days the simulation will run 
function computeSimulationDaysFromData(incidents) {
    const timestamps = incidents
        .map(i => Date.parse(i.start_date))
        .filter(t => !Number.isNaN(t));

    if (timestamps.length === 0) return 1;

    const earliest = Math.min(...timestamps);
    const latest = Math.max(...timestamps);

    const msPerDay = 24 * 60 * 60 * 1000;
    const days = Math.ceil((latest - earliest) / msPerDay);

    return Math.max(1, days);
} 

//tts
function speak(text) {
    if (!ttsEnabled) return;

    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1; 
    utter.pitch = 1;
    utter.volume = 1;

    speechSynthesis.speak(utter);
}

// Build a map of receiver countries and their frequencies
function buildCountryFrequencyMap(incidents) {
    const countryAttackCount = {};
    incidents.forEach(incident => {
        incident.receiver_country.forEach(country => {
            countryAttackCount[country] = (countryAttackCount[country] || 0) + 1;
        });
    });
    return countryAttackCount;
}

// Build a map of attack types and their frequencies
function buildAttackTypeFrequencyMap(incidents) {
    const attackTypeCount = {};
    incidents.forEach(incident => {
        parseIncidentTypes(incident.incident_type).forEach(attackType => {
            attackTypeCount[attackType] = (attackTypeCount[attackType] || 0) + 1;
        });
    });
    return attackTypeCount;
}

// Render the list of receiver countries in the sidebar
function renderReceiverCountriesListFromMap(countryFrequencyMap) {
    const sortedCountries = Object.entries(countryFrequencyMap)
        .sort((a, b) => b[1] - a[1]);
    receiverCountriesListElement.innerHTML = '';

    if (sortedCountries.length === 0) {
        const item = document.createElement('div');
        item.className = 'country-item';
        item.innerHTML = `<span class="country-name">No receiver countries yet</span><span class="attack-count">0</span>`;
        receiverCountriesListElement.appendChild(item);
        return;
    }

    sortedCountries.forEach(([country, count]) => {
        const item = document.createElement('div');
        item.className = 'country-item';
        item.innerHTML = `<span class="country-name">${country}</span><span class="attack-count">${count}</span>`;
        
        item.addEventListener('click', () => {
            displayCountryIncidents(country);
        });
        
        receiverCountriesListElement.appendChild(item);
    });
}

// Render the list of attack types in the sidebar
function renderAttackListFromMap(attackTypeFrequencyMap) {
    const sortedAttackTypes = Object.entries(attackTypeFrequencyMap)
        .sort((a, b) => b[1] - a[1]);
    const reversedAttackTypes = [...sortedAttackTypes].reverse()
        .filter(([type, count]) => type && type.trim() && count > 0);
    attackListElement.innerHTML = '';

    if (reversedAttackTypes.length === 0) {
        const item = document.createElement('div');
        item.className = 'attack-item';
        item.innerHTML = `<span class="attack-name">No attack types yet</span><span class="attack-count">0</span>`;
        attackListElement.appendChild(item);
        return;
    }

    reversedAttackTypes.forEach(([attackType, count]) => {
        const item = document.createElement('div');
        item.className = 'attack-item';
        const color = ATTACK_TYPE_COLOURS[attackType] || ATTACK_TYPE_COLOURS['Unknown'] || '#A0A0A0';
        item.innerHTML = `
            <span class="attack-color-indicator" style="background-color: ${color}"></span>
            <span class="attack-name">${attackType}</span>
            <span class="attack-count">${count}</span>
        `;

        //tts
  item.addEventListener('click', () => {
        speak(`${attackType} selected`);
    });
        attackListElement.appendChild(item);
    });
}

//Contry attack detail modal func
function buildCountryToIncidentsMap() {
    const map = {};

    incidentData.forEach(incident => {
        incident.receiver_country.forEach(country => {
            // If this is the first time we're seeing this country, create an empty array
            if (!map[country]) {
                map[country] = [];
            }
            // Add this incident to the country's list
            map[country].push(incident);
        });
    });
    
    return map;
}
// Display the incidents for a selected country in the modal
function displayCountryIncidents(selectedCountry) {
    const incidents = countryToIncidentsMap[selectedCountry] || [];
    
    currentSelectedCountry = selectedCountry;
    currentSelectedIncidents = incidents;
    countryIncidentsList.innerHTML = '';
    
    //country has no incidents
    if (incidents.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'incident-detail';
        emptyMsg.innerHTML = '<p>No incidents found for this country.</p>';
        countryIncidentsList.appendChild(emptyMsg);
        showCountryDetailsModal(selectedCountry, 0);
        return;
    }

    incidents.forEach(incident => {
        const incidentDiv = document.createElement('div');
        incidentDiv.className = 'incident-detail';
        const type = incident.incident_type || 'Unknown';
        const from = (incident.initiator_country || []).join(', ') || 'Unknown';
        const to = (incident.receiver_country || []).join(', ') || 'Unknown';
        
        //create html structure
        incidentDiv.innerHTML = `
            <div class="incident-header">
                <strong>Incident ID: ${incident.ID}</strong>
                <span class="incident-date">${incident.start_date}</span>
            </div>
            <div class="incident-info">
                <p><strong>Attack Type:</strong> ${type}</p>
                <p><strong>Attacker Country:</strong> ${from}</p>
                <p><strong>Affected Countries:</strong> ${to}</p>
            </div>
        `;
        
        countryIncidentsList.appendChild(incidentDiv);
    });
    
    // Display the modal with the incident details
    showCountryDetailsModal(selectedCountry, incidents.length);
}
function showCountryDetailsModal(country, incidentCount) {
    // Update the modal header to show country name and incident count
    modalCountryName.textContent = `${country} — ${incidentCount} Attack${incidentCount !== 1 ? 's' : ''}`;
    
    speak(`Displaying details for ${country}`);
    countryAttackDetailModal.classList.remove('hidden');
}

//export JSON
function exportIncidentsAsJSON(country, incidents) {
    const exportData = {
        country: country,
        exportDate: new Date().toISOString(), // Current date/time in ISO 8601 format
        totalIncidents: incidents.length,
        incidents: incidents.map(incident => ({
            id: incident.ID,
            date: incident.start_date,
            type: incident.incident_type || 'Unknown',
            attackerCountries: incident.initiator_country || [],
            affectedCountries: incident.receiver_country || [],
        }))
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    downloadFile(blob, `${country}_incidents.json`);
}

function downloadFile(blob, filename) {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Toggle receiver countries sidebar
receiverCountriesHeader.addEventListener('click', () => {
    const isExpanded = receiverCountriesList.classList.contains('expanded');

    speak(isExpanded ? "Collapsing receiver countries list" : "Expanding receiver countries list");

    if (isExpanded) {
        receiverCountriesList.classList.remove('expanded');
        receiverCountriesSidebar.classList.remove('expanded');
        receiverCountriesToggleIcon.style.transform = 'rotate(0deg)'; // Reset icon rotation when collapsed
    } else {
        receiverCountriesList.classList.add('expanded');
        receiverCountriesSidebar.classList.add('expanded');
        receiverCountriesToggleIcon.style.transform = 'rotate(180deg)'; // Rotate icon to indicate expanded state
    }

    
});

// Toggle attack types sidebar
attackSidebarHeader.addEventListener('click', () => {
    const isExpanded = attackList.classList.contains('expanded');

    speak(isExpanded ? "Collapsing attack types list" : "Expanding attack types list");
    if (isExpanded) {
        attackList.classList.remove('expanded');
        attackSidebar.classList.remove('expanded');
        attackToggleIcon.style.transform = 'rotate(0deg)'; // Reset icon rotation when collapsed
    } else {
        attackList.classList.add('expanded');
        attackSidebar.classList.add('expanded');
        attackToggleIcon.style.transform = 'rotate(180deg)';
        setTimeout(() => {
            attackList.scrollTop = attackList.scrollHeight - attackList.clientHeight;
        }, 300);
    } 
});

//theme for the glows of routes
function buildThemePalette() {
    const isLightMode = body.classList.contains('light-mode');
    return {
        routeTimeline: 'rgba(255, 255, 255, 0.92)',  
        routeTimelineGlow: 'rgba(255, 255, 255, 0.28)', 
        sourceNode: 'rgba(255, 255, 255, 0.88)',        
        targetNode: 'rgba(255, 255, 255, 0.92)',        
        labelText: isLightMode
            ? 'rgba(0, 0, 0, 0.9)'     
            : 'rgba(255, 255, 255, 0.9)', 
        transparentAccent: 'rgba(255, 255, 255, 0)'    
    };
}

// Refresh the active theme palette
function refreshThemePalette() {
    activeThemePalette = buildThemePalette();
}

// Toggle between light and dark themes
function toggleTheme() {
    body.classList.toggle('light-mode');
    themeToggle.classList.toggle('active');
    const isLightMode = body.classList.contains('light-mode');
    themeToggle.setAttribute('aria-pressed', isLightMode ? 'true' : 'false');
    refreshThemePalette();

    speak(isLightMode ? "Light mode enabled" : "Dark mode enabled");

}

//setting button toggle
settingsButton.addEventListener('click', () => settingsPanel.classList.toggle('active'));
themeToggle.addEventListener('click', toggleTheme);

//tts toggle
const ttsToggle = document.getElementById('tts-toggle');
let ttsEnabled = false;

ttsToggle.addEventListener('click', () => {
    ttsEnabled = !ttsEnabled;
    ttsToggle.classList.toggle('active');
    ttsToggle.setAttribute('aria-pressed', ttsEnabled ? 'true' : 'false');

    speak(ttsEnabled ? "Text to speech enabled" : "Text to speech disabled");
});

//initial setup on load
window.addEventListener('DOMContentLoaded', () => {
    const speedButtons = document.querySelectorAll('.speed-button');

    speedButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const speed = parseFloat(btn.dataset.speed);

            THREAT_MAP_SETTINGS.timelineSecondsPerDay = speed;
            simulationStartTimestamp = performance.now();

            speedButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            speak(`Speed set to ${speed} times`);
        });
    });

    const defaultBtn = document.querySelector('.speed-button[data-speed="1"]');
    if (defaultBtn) defaultBtn.classList.add('active');
});

//modal close event listener
modalCloseBtn.addEventListener('click', () => {
    countryAttackDetailModal.classList.add('hidden');

        speak(`Closed details for ${currentSelectedCountry}`);
});

//json button event listener
exportJsonBtn.addEventListener('click', () => {
    // Only proceed if we have a valid country and incidents selected
    if (currentSelectedCountry && currentSelectedIncidents.length > 0) {
        exportIncidentsAsJSON(currentSelectedCountry, currentSelectedIncidents);
    }

    speak(`Exporting incidents for ${currentSelectedCountry}`);
});

// Build combined threat routes from incident data
function buildCombinedThreatRoutes() {
    const routeMap = new Map();
    incidentData.forEach(incident => {
        const sourceGeo = (incident.initiator_country_geo || []).find(isValidGeoPoint) || null;
        if (!sourceGeo) return;

        (incident.receiver_country_geo || []).forEach(targetGeo => {
            if (!isValidGeoPoint(targetGeo)) return;
            const routeKey = `${sourceGeo.country}__${targetGeo.country}`;
            const existingRoute = routeMap.get(routeKey);
            const incidentTimestamp = safeTimestampFromDate(incident.start_date);

            if (existingRoute) {
                existingRoute.count += 1;
                existingRoute.latestTimestamp = Math.max(existingRoute.latestTimestamp, incidentTimestamp);
                existingRoute.latestDate = existingRoute.latestTimestamp === incidentTimestamp
                    ? incident.start_date : existingRoute.latestDate;
                parseIncidentTypes(incident.incident_type).forEach(attackType => existingRoute.incidentTypes.add(attackType));
                existingRoute.incidentIds.add(incident.ID);
                return;
            }

            routeMap.set(routeKey, {
                key: routeKey,
                sourceCountry: sourceGeo.country,
                sourceLatitude: sourceGeo.latitude,
                sourceLongitude: sourceGeo.longitude,
                targetCountry: targetGeo.country,
                targetLatitude: targetGeo.latitude,
                targetLongitude: targetGeo.longitude,
                count: 1,
                latestTimestamp: incidentTimestamp,
                latestDate: incident.start_date,
                incidentTypes: new Set(parseIncidentTypes(incident.incident_type).length > 0
                    ? parseIncidentTypes(incident.incident_type) : ['Unknown']),
                incidentIds: new Set([incident.ID])
            });
        });
    });

    const combinedRoutes = [...routeMap.values()]
        .map(route => ({
            ...route,
            incidentTypeSummary: [...route.incidentTypes].join(' | '),
            uniqueIncidentCount: route.incidentIds.size
        }))
        .sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return b.latestTimestamp - a.latestTimestamp;
        })
        .slice(0, THREAT_MAP_SETTINGS.maxVisibleRoutes);

    const timestamps = combinedRoutes.map(r => r.latestTimestamp).filter(t => Number.isFinite(t) && t > 0);
    earliestIncidentTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : 0;
    latestIncidentTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : 0;
    const timelineSpan = Math.max(latestIncidentTimestamp - earliestIncidentTimestamp, 1);

    return combinedRoutes
        .sort((a, b) => a.latestTimestamp - b.latestTimestamp)
        .map(route => ({
            ...route,
            timelineProgress: timelineSpan === 0 ? 0 : (route.latestTimestamp - earliestIncidentTimestamp) / timelineSpan
        }));
}

// Get incidents that should be visible at a given timestamp
function getIncidentsUpToSimulatedTimestamp(simulatedTimestamp) {
    return incidentData.filter(incident => safeTimestampFromDate(incident.start_date) <= simulatedTimestamp);
}

// Update sidebars based on current simulation timestamp
function updateSidebarsForSimulation(simulatedTimestamp) {
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const normalizedDayTimestamp = Math.floor(simulatedTimestamp / millisecondsPerDay) * millisecondsPerDay;
    if (normalizedDayTimestamp === lastSidebarUpdateTimestamp) return;
    lastSidebarUpdateTimestamp = normalizedDayTimestamp;

    const visibleIncidents = getIncidentsUpToSimulatedTimestamp(simulatedTimestamp);
    renderReceiverCountriesListFromMap(buildCountryFrequencyMap(visibleIncidents));
    renderAttackListFromMap(buildAttackTypeFrequencyMap(visibleIncidents));
}

// Project a geo point (latitude, longitude) to canvas coordinates
function projectGeoPoint(latitude, longitude) {
    return {
        x: mapProjectionBounds.x + ((longitude + 180) / 360) * mapProjectionBounds.width,
        y: mapProjectionBounds.y + ((90 - latitude) / 180) * mapProjectionBounds.height
    };
}

// Handle wrapping for routes that cross the date line
function getWrappedTargetX(startX, targetX) {
    let adjustedTargetX = targetX;
    const projectionWidth = mapProjectionBounds.width;
    const distance = adjustedTargetX - startX;
    if (distance > projectionWidth / 2) {
        adjustedTargetX -= projectionWidth;
    } else if (distance < -projectionWidth / 2) {
        adjustedTargetX += projectionWidth;
    }
    return adjustedTargetX;
}

// Calculate map projection bounds based on canvas size
function rebuildMapProjectionBounds() {
    if (canvasWidth === 0 || canvasHeight === 0) {
        mapProjectionBounds = { x: 0, y: 0, width: 0, height: 0 };
        return;
    }

    const canvasAspectRatio = canvasWidth / canvasHeight;
    if (canvasAspectRatio > BACKGROUND_MAP_ASPECT_RATIO) {
        const mapHeight = canvasHeight;
        const mapWidth = mapHeight * BACKGROUND_MAP_ASPECT_RATIO;
        mapProjectionBounds = {
            x: (canvasWidth - mapWidth) / 2,
            y: 0,
            width: mapWidth,
            height: mapHeight
        };
        return;
    }

    const mapWidth = canvasWidth;
    const mapHeight = mapWidth / BACKGROUND_MAP_ASPECT_RATIO;
    mapProjectionBounds = {
        x: 0,
        y: (canvasHeight - mapHeight) / 2,
        width: mapWidth,
        height: mapHeight
    };
}

// Build control point for quadratic Bezier curve
function buildCurveControlPoint(startPoint, endPoint) {
    const deltaX = endPoint.x - startPoint.x;
    const deltaY = endPoint.y - startPoint.y;
    const length = Math.hypot(deltaX, deltaY) || 1;
    const midpointX = startPoint.x + deltaX / 2;
    const midpointY = startPoint.y + deltaY / 2;
    const normalX = -deltaY / length;
    const normalY = deltaX / length;
    const curveBend = Math.min(Math.max(length * 0.22, 24), 150);
    const verticalLift = Math.min(Math.max(length * 0.16, 12), 96);
    return {
        x: midpointX + normalX * curveBend,
        y: midpointY + normalY * curveBend - verticalLift
    };
}

// Get point on quadratic Bezier curve at given progress
function getQuadraticPoint(startPoint, controlPoint, endPoint, progress) {
    const inverse = 1 - progress;
    return {
        x: inverse * inverse * startPoint.x + 2 * inverse * progress * controlPoint.x + progress * progress * endPoint.x,
        y: inverse * inverse * startPoint.y + 2 * inverse * progress * controlPoint.y + progress * progress * endPoint.y
    };
}

// Build curve copies for wrapped routes (date line handling)
function buildProjectedCurveCopies(route) {
    const baseStartPoint = projectGeoPoint(route.sourceLatitude, route.sourceLongitude);
    const baseTargetPoint = projectGeoPoint(route.targetLatitude, route.targetLongitude);
    const wrappedTargetX = getWrappedTargetX(baseStartPoint.x, baseTargetPoint.x);

    const wrappedStartPoint = { x: baseStartPoint.x, y: baseStartPoint.y };
    const wrappedTargetPoint = { x: wrappedTargetX, y: baseTargetPoint.y };

    const projectionWidth = mapProjectionBounds.width;
    const projectionLeft = mapProjectionBounds.x;
    const projectionRight = mapProjectionBounds.x + projectionWidth;

    const copies = [-projectionWidth, 0, projectionWidth]
        .map(offsetX => {
            const startPoint = { x: wrappedStartPoint.x + offsetX, y: wrappedStartPoint.y };
            const endPoint = { x: wrappedTargetPoint.x + offsetX, y: wrappedTargetPoint.y };
            const controlPoint = buildCurveControlPoint(startPoint, endPoint);
            return { startPoint, controlPoint, endPoint };
        })
        .filter(copy => {
            const minX = Math.min(copy.startPoint.x, copy.controlPoint.x, copy.endPoint.x);
            const maxX = Math.max(copy.startPoint.x, copy.controlPoint.x, copy.endPoint.x);
            return minX <= projectionRight + THREAT_MAP_SETTINGS.curveOverflowPadding &&
                   maxX >= projectionLeft - THREAT_MAP_SETTINGS.curveOverflowPadding;
        });

    return { baseStartPoint, baseTargetPoint, copies };
}

// Rebuild all projected threat routes
function rebuildProjectedThreatRoutes() {
    projectedThreatRoutes = combinedThreatRoutes.map(route => {
        const curveData = buildProjectedCurveCopies(route);
        return {
            ...route,
            ...curveData,
            strokeWidth: THREAT_MAP_SETTINGS.routeStrokeWidth,
            glowWidth: THREAT_MAP_SETTINGS.routeGlowWidth
        };
    });
    rebuildProjectedNodes();
}

// Rebuild projected nodes (source/target points)
function rebuildProjectedNodes() {
    const nodeMap = new Map();
    projectedThreatRoutes.forEach(route => {
        const sourceKey = `source__${route.sourceCountry}`;
        const targetKey = `target__${route.targetCountry}`;

        const sourceNode = nodeMap.get(sourceKey) || {
            key: sourceKey, country: route.sourceCountry, role: 'source',
            x: route.baseStartPoint.x, y: route.baseStartPoint.y, strength: 0
        };
        sourceNode.strength += route.count;
        nodeMap.set(sourceKey, sourceNode);

        const targetNode = nodeMap.get(targetKey) || {
            key: targetKey, country: route.targetCountry, role: 'target',
            x: route.baseTargetPoint.x, y: route.baseTargetPoint.y, strength: 0
        };
        targetNode.strength += route.count;
        nodeMap.set(targetKey, targetNode);
    });

    projectedNodes = [...nodeMap.values()]
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 100)
        .map(node => ({ ...node, radius: Math.min(Math.max(1.6 + node.strength * 0.08, 2), 6.5) }));
}

// Sync canvas size with display size (handles high DPI displays)
function syncCanvasSize() {
    const nextWidth = canvas.clientWidth;
    const nextHeight = canvas.clientHeight;
    const nextPixelRatio = window.devicePixelRatio || 1;

    if (nextWidth === canvasWidth && nextHeight === canvasHeight && nextPixelRatio === pixelRatio) return;

    canvasWidth = nextWidth;
    canvasHeight = nextHeight;
    pixelRatio = nextPixelRatio;

    canvas.width = Math.floor(canvasWidth * pixelRatio);
    canvas.height = Math.floor(canvasHeight * pixelRatio);

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.scale(pixelRatio, pixelRatio);

    rebuildMapProjectionBounds();
    rebuildProjectedThreatRoutes();
}

// Draw a partial route curve with reveal animation
function drawPartialRouteCurve(route, curveCopy, revealProgress, visibilityAlpha) {
    try {
        const curveEndPoint = getQuadraticPoint(curveCopy.startPoint, curveCopy.controlPoint, curveCopy.endPoint, revealProgress);
        const partialControlPoint = {
            x: curveCopy.startPoint.x + (curveCopy.controlPoint.x - curveCopy.startPoint.x) * revealProgress,
            y: curveCopy.startPoint.y + (curveCopy.controlPoint.y - curveCopy.startPoint.y) * revealProgress
        };

        // Get the primary attack type color
        const attackType = Array.from(route.incidentTypes)[0] || 'Unknown';
        const baseColor = ATTACK_TYPE_COLOURS[attackType] || ATTACK_TYPE_COLOURS['Unknown'] || '#808080';
        
        // Convert hex to rgba with visibility alpha for glow and main line
        const glowColor = hexToRgba(baseColor, visibilityAlpha * 0.3);
        const mainColor = hexToRgba(baseColor, visibilityAlpha * 0.9);

        context.save();
        context.lineCap = 'round';
        context.lineJoin = 'round';

        // Draw glow
        context.beginPath();
        context.strokeStyle = glowColor;
        context.lineWidth = route.glowWidth;
        context.moveTo(curveCopy.startPoint.x, curveCopy.startPoint.y);
        context.quadraticCurveTo(partialControlPoint.x, partialControlPoint.y, curveEndPoint.x, curveEndPoint.y);
        context.stroke();

        // Draw main line
        context.beginPath();
        context.strokeStyle = mainColor;
        context.lineWidth = route.strokeWidth;
        context.moveTo(curveCopy.startPoint.x, curveCopy.startPoint.y);
        context.quadraticCurveTo(partialControlPoint.x, partialControlPoint.y, curveEndPoint.x, curveEndPoint.y);
        context.stroke();
        context.restore();
    } catch (error) {
        console.error(`Error drawing route with attack type: ${Array.from(route.incidentTypes)[0]}: ${error.message}`);
    }
}

// Get the current timeline state for a route
function getRouteTimelineState(route, elapsedSeconds) {
    const loopDuration = SIMULATION_DAYS * THREAT_MAP_SETTINGS.timelineSecondsPerDay;

    const revealDuration = THREAT_MAP_SETTINGS.routeRevealDurationSeconds;
    const visibleDuration = THREAT_MAP_SETTINGS.routeVisibleDurationSeconds;
    const routeActivationSecond = route.timelineProgress * loopDuration;
    const secondsSinceActivation = elapsedSeconds - routeActivationSecond;

    if (secondsSinceActivation < 0 || secondsSinceActivation > revealDuration + visibleDuration) {
        return { isVisible: false, revealProgress: 0, visibilityAlpha: 0 };
    }

    const revealProgress = Math.min(Math.max(secondsSinceActivation / revealDuration, 0), 1);
    const fadeOutStart = revealDuration + visibleDuration * 0.68;
    let visibilityAlpha = 1;

    if (secondsSinceActivation > fadeOutStart) {
        const fadeProgress = (secondsSinceActivation - fadeOutStart) / Math.max(revealDuration + visibleDuration - fadeOutStart, 0.001);
        visibilityAlpha = Math.min(Math.max(1 - fadeProgress, 0), 1);
    }

    return { isVisible: visibilityAlpha > 0, revealProgress, visibilityAlpha: Math.min(Math.max(visibilityAlpha, 0), 1) };
}

// Draw the HUD (heads-up display) with stats
function drawMapHud(visibleRoutes, elapsedSeconds) {
    const loopDuration = SIMULATION_DAYS * THREAT_MAP_SETTINGS.timelineSecondsPerDay;

    const loopProgress = loopDuration > 0 ? Math.min(Math.max(elapsedSeconds / loopDuration, 0), 1) : 1;
    const simulatedTimestamp = earliestIncidentTimestamp + (latestIncidentTimestamp - earliestIncidentTimestamp) * loopProgress;
    const simulationDateLabel = earliestIncidentTimestamp
        ? `Simulation Date: ${new Date(simulatedTimestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}`
        : 'Simulation Date: N/A';

    context.save();
    context.font = '12px monospace'; 
    context.textAlign = 'right';
    context.fillStyle = activeThemePalette.labelText;
    context.fillText(simulationDateLabel, canvasWidth - 16, canvasHeight - 16);
    context.restore();
}

// Render a single frame of the threat map
function renderThreatMapFrame(timestamp) {
    if (simulationStartTimestamp === null) simulationStartTimestamp = timestamp;

    const elapsedSeconds = (timestamp - simulationStartTimestamp) / 1000;
    const visibleRoutes = [];
    const loopDuration = SIMULATION_DAYS * THREAT_MAP_SETTINGS.timelineSecondsPerDay;

    const loopProgress = loopDuration > 0 ? Math.min(Math.max(elapsedSeconds / loopDuration, 0), 1) : 1;

    currentSimulatedTimestamp = earliestIncidentTimestamp + (latestIncidentTimestamp - earliestIncidentTimestamp) * loopProgress;

    syncCanvasSize();
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    updateSidebarsForSimulation(currentSimulatedTimestamp);

    projectedThreatRoutes.forEach(route => {
        const timelineState = getRouteTimelineState(route, elapsedSeconds);
        if (!timelineState.isVisible) return;
        visibleRoutes.push(route);
        route.copies.forEach(curveCopy => {
            drawPartialRouteCurve(route, curveCopy, timelineState.revealProgress, timelineState.visibilityAlpha);
        });
    });

    // Log visible attack types once per second
    if (Math.floor(elapsedSeconds) > Math.floor(elapsedSeconds - 0.016)) {
        const visibleAttackTypes = new Set(visibleRoutes.flatMap(r => Array.from(r.incidentTypes)));
        console.log(`Visible routes: ${visibleRoutes.length}, Attack types: ${Array.from(visibleAttackTypes).join(', ')}`);
    }

    projectedNodes.forEach(node => {
        const isNodeActive = visibleRoutes.some(route =>
            (node.role === 'source' && route.sourceCountry === node.country) ||
            (node.role === 'target' && route.targetCountry === node.country)
        );
    });

    drawMapHud(visibleRoutes, elapsedSeconds);

    if (elapsedSeconds >= loopDuration) {
        simulationCompleted = true;
        animationFrameId = null;
        return;
    }

    animationFrameId = window.requestAnimationFrame(renderThreatMapFrame);
}

// Start the threat map animation
function startThreatMapAnimation() {
    if (animationFrameId !== null || simulationCompleted) return;
    animationFrameId = window.requestAnimationFrame(renderThreatMapFrame);
}

// Stop the threat map animation
function stopThreatMapAnimation() {
    if (animationFrameId === null) return;
    window.cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
}

// Handle window resize
window.addEventListener('resize', syncCanvasSize);

refreshThemePalette();
combinedThreatRoutes = buildCombinedThreatRoutes();
console.log(`Combined routes built: ${combinedThreatRoutes.length} routes`);
console.log('Attack types in routes:', new Set(combinedThreatRoutes.flatMap(r => Array.from(r.incidentTypes))));

countryToIncidentsMap = buildCountryToIncidentsMap();
console.log(`Country incidents map built for ${Object.keys(countryToIncidentsMap).length} countries`);

SIMULATION_DAYS = computeSimulationDaysFromData(incidentData);

rebuildProjectedThreatRoutes();
console.log(`Projected routes: ${projectedThreatRoutes.length}`);
updateSidebarsForSimulation(earliestIncidentTimestamp - 1);
syncCanvasSize();
startThreatMapAnimation();