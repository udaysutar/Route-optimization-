// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialize map
    const map = L.map('map').setView([22.5, 78.9], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Global state
    let airportData = [];
    let demandData = {};
    let aircraftData = [];
    let markers = {};
    let currentRouteLayers = new L.FeatureGroup().addTo(map);

    // --- DOM ELEMENT REFERENCES ---
    const csvUpload = document.getElementById('csvUpload');
    const demandUpload = document.getElementById('demandUpload');
    const aircraftUpload = document.getElementById('aircraftUpload'); // ADDED
    const aircraftSelect = document.getElementById('aircraftSelect');
    const windDirInput = document.getElementById('windDir');
    const windSpeedInput = document.getElementById('windSpeed');
    const optModeSelect = document.getElementById('optMode');
    const sourceSelect = document.getElementById('sourceSelect');
    const intermediateSelectsContainer = document.getElementById('intermediateSelects');
    const destinationSelect = document.getElementById('destinationSelect');
    const addIntermediateBtn = document.getElementById('addIntermediateBtn');
    const drawRouteBtn = document.getElementById('drawRouteBtn');
    const optimizeRouteBtn = document.getElementById('optimizeRouteBtn');
    const resetBtn = document.getElementById('resetBtn');
    const infoBox = document.getElementById('infoBox');
    const distanceTableBody = document.querySelector('#distanceTable tbody');
    const totalDistCell = document.getElementById('totalDistanceCell');
    const totalProfitCell = document.getElementById('totalProfitCell');

    // --- EVENT LISTENERS ---
    csvUpload.addEventListener('change', (e) => handleFileUpload(e, 'airports'));
    demandUpload.addEventListener('change', (e) => handleFileUpload(e, 'demand'));
    aircraftUpload.addEventListener('change', (e) => handleFileUpload(e, 'aircraft')); // ADDED
    addIntermediateBtn.addEventListener('click', addIntermediateDropdown);
    drawRouteBtn.addEventListener('click', () => processRoute(false));
    optimizeRouteBtn.addEventListener('click', () => processRoute(true));
    resetBtn.addEventListener('click', resetApplication);

    // --- CORE FUNCTIONS ---

    // Set initial state for dropdown
    aircraftSelect.innerHTML = '<option value="">Upload Aircraft CSV</option>';

    /**
     * Handles parsing of uploaded CSV files.
     * @param {Event} e The file input change event.
     * @param {string} type 'airports', 'demand', or 'aircraft'. // MODIFIED
     */
    function handleFileUpload(e, type) {
        const file = e.target.files[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                if (type === 'airports') {
                    airportData = results.data;
                    populateAirportDropdowns();
                    plotAirports();
                } else if (type === 'demand') {
                    demandData = results.data.reduce((obj, item) => {
                        obj[item.ident] = {
                            demand: parseInt(item.demand, 10),
                            avgFare: parseFloat(item.avgFare)
                        };
                        return obj;
                    }, {});
                    infoBox.textContent = `Demand data for ${Object.keys(demandData).length} airports loaded.`;
                } else if (type === 'aircraft') { // ADDED this block
                    aircraftData = results.data.filter(ac => ac.type && ac.display_name);
                    aircraftSelect.innerHTML = aircraftData
                        .map(ac => `<option value="${ac.type}">${ac.display_name}</option>`)
                        .join('');
                    infoBox.textContent = `${aircraftData.length} aircraft types loaded.`;
                }
            }
        });
    }

    // REMOVED: The old loadAircraftData function is no longer needed.

    /**
     * Populates all airport selection dropdowns.
     */
    function populateAirportDropdowns() {
        const optionsHtml = airportData
            .filter(ap => ap.name && !isNaN(parseFloat(ap.latitude_deg)))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(ap => `<option value="${ap.ident}">${ap.name} (${ap.ident})</option>`)
            .join('');

        sourceSelect.innerHTML = `<option value="">Select Source</option>${optionsHtml}`;
        destinationSelect.innerHTML = `<option value="">Select Destination</option>${optionsHtml}`;
        intermediateSelectsContainer.innerHTML = '';
    }

    /**
     * Adds an airport marker to the map.
     */
    function plotAirports() {
        Object.values(markers).forEach(m => map.removeLayer(m.marker));
        markers = {};
        airportData.forEach(ap => {
            const lat = parseFloat(ap.latitude_deg);
            const lon = parseFloat(ap.longitude_deg);
            if (isNaN(lat) || isNaN(lon)) return;

            const marker = L.circleMarker([lat, lon], {
                radius: 5,
                color: '#003366',
                fillColor: '#0078d7',
                fillOpacity: 0.8
            }).addTo(map);

            marker.bindPopup(`<strong>${ap.name}</strong><br>${ap.municipality} (${ap.ident})`);
            markers[ap.ident] = { ...ap, marker };
        });
    }

    /**
     * Adds a new dropdown for selecting an intermediate airport.
     */
    function addIntermediateDropdown() {
        const container = document.createElement('div');
        container.className = 'intermediate-stop';
        
        const newSelect = document.createElement('select');
        const optionsHtml = airportData
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(ap => `<option value="${ap.ident}">${ap.name} (${ap.ident})</option>`)
            .join('');
        newSelect.innerHTML = `<option value="">Select Intermediate</option>${optionsHtml}`;

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '✕';
        removeBtn.onclick = () => container.remove();

        container.appendChild(newSelect);
        container.appendChild(removeBtn);
        intermediateSelectsContainer.appendChild(container);
    }
    
    /**
     * Main function to trigger route drawing and optimization.
     * @param {boolean} optimize Whether to run an optimization algorithm.
     */
    function processRoute(optimize) {
        const sourceCode = sourceSelect.value;
        const destCode = destinationSelect.value;
        const intermediateCodes = Array.from(intermediateSelectsContainer.querySelectorAll('select'))
            .map(s => s.value)
            .filter(v => v);

        if (!sourceCode || !destCode) {
            alert('Please select a source and a destination.');
            return;
        }

        const aircraft = aircraftData.find(ac => ac.type === aircraftSelect.value);
        if (!aircraft) {
            alert('Please select a valid aircraft. Ensure you have uploaded the aircraft types CSV.');
            return;
        }

        infoBox.textContent = 'Calculating...';
        
        if (optimize) {
            const optimizationMode = optModeSelect.value;
            
            if (optimizationMode === 'ga_profit' && intermediateCodes.length > 1) {
                infoBox.textContent = 'Running Genetic Algorithm for max profit...';
                setTimeout(() => {
                    const { bestRoute } = runGeneticAlgorithm(sourceCode, destCode, intermediateCodes, aircraft);
                    if (bestRoute) {
                        displayRoute(bestRoute, aircraft);
                    } else {
                        infoBox.textContent = 'Could not find a profitable route.';
                    }
                }, 50);

            } else if (optimizationMode === 'dijkstra' && intermediateCodes.length > 0) {
                 infoBox.textContent = 'Finding shortest distance route...';
                 const { bestRoute } = findShortestPath(sourceCode, destCode, intermediateCodes);
                 displayRoute(bestRoute, aircraft);

            } else {
                const route = [sourceCode, ...intermediateCodes, destCode];
                displayRoute(route, aircraft);
            }
        } else {
            const route = [sourceCode, ...intermediateCodes, destCode];
            displayRoute(route, aircraft);
        }
    }

    /**
     * Displays a route on the map and updates the info table.
     * @param {string[]} route - Array of airport IDENT codes in order.
     * @param {object} aircraft - The selected aircraft's data object.
     */
    function displayRoute(route, aircraft) {
        currentRouteLayers.clearLayers();
        distanceTableBody.innerHTML = '';

        if (route.length < 2) {
            infoBox.textContent = 'Not enough points to display a route.';
            return;
        }

        const latlngs = route.map(code => {
            const ap = markers[code];
            return [parseFloat(ap.latitude_deg), parseFloat(ap.longitude_deg)];
        });

        const polyline = L.polyline(latlngs, { color: 'purple', weight: 3 }).addTo(currentRouteLayers);
        map.fitBounds(polyline.getBounds().pad(0.1));

        let totalDistance = 0;
        let totalProfit = 0;
        let isRouteFeasible = true;

        for (let i = 0; i < route.length - 1; i++) {
            const fromAirport = markers[route[i]];
            const toAirport = markers[route[i + 1]];
            const metrics = calculateSegmentMetrics(fromAirport, toAirport, aircraft);
            
            if (!metrics.isFeasible) {
                isRouteFeasible = false;
            }

            totalDistance += metrics.distance;
            totalProfit += metrics.profit;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${fromAirport.ident}</td>
                <td>${toAirport.ident}</td>
                <td>${metrics.distance.toFixed(0)}</td>
                <td style="color:${metrics.profit < 0 ? '#d9534f' : '#5cb85c'};">${metrics.profit.toFixed(0)}</td>
            `;
            distanceTableBody.appendChild(tr);
        }

        totalDistCell.textContent = totalDistance.toFixed(0);
        totalProfitCell.textContent = totalProfit.toFixed(0);
        totalProfitCell.style.color = totalProfit < 0 ? '#d9534f' : '#5cb85c';
        
        let infoText = `Route: ${route.join(' → ')} | Total Profit: $${totalProfit.toFixed(0)}`;
        if (!isRouteFeasible) {
            infoText += "\n\nWARNING: One or more legs exceed aircraft range!";
            infoBox.style.color = '#d9534f';
        } else {
             infoBox.style.color = '#333';
        }
        infoBox.textContent = infoText;
    }

    /**
     * Resets the application state.
     */
    function resetApplication() {
        currentRouteLayers.clearLayers();
        infoBox.textContent = '';
        distanceTableBody.innerHTML = '';
        totalDistCell.textContent = '';
        totalProfitCell.textContent = '';
        sourceSelect.value = '';
        destinationSelect.value = '';
        intermediateSelectsContainer.innerHTML = '';
        // Reset file inputs for re-uploading
        csvUpload.value = '';
        demandUpload.value = '';
        aircraftUpload.value = '';
        aircraftSelect.innerHTML = '<option value="">Upload Aircraft CSV</option>';
        map.setView([22.5, 78.9], 5);
    }

    /**
     * Calculates all metrics for a single flight segment.
     */
    function calculateSegmentMetrics(from, to, aircraft) {
        const lat1 = parseFloat(from.latitude_deg);
        const lon1 = parseFloat(from.longitude_deg);
        const lat2 = parseFloat(to.latitude_deg);
        const lon2 = parseFloat(to.longitude_deg);
        const toRad = deg => deg * Math.PI / 180;

        const COST_PER_HOUR_MULTIPLIER = 25;
        const AVG_LOAD_FACTOR = 0.80;
        const R = 6371;

        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        const cruiseSpeed = parseFloat(aircraft.cruise_speed_kmh);
        let groundSpeed = cruiseSpeed;
        const windDir = parseFloat(windDirInput.value);
        const windSpeed = parseFloat(windSpeedInput.value) * 1.852;

        if (!isNaN(windDir) && !isNaN(windSpeed) && windSpeed > 0) {
            const y = Math.sin(dLon) * Math.cos(toRad(lat2));
            const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
            const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
            const windAngle = Math.abs(bearing - windDir);
            const headwindComponent = Math.cos(toRad(windAngle)) * windSpeed;
            groundSpeed -= headwindComponent;
        }
        
        const flightTimeHours = distance / (groundSpeed > 0 ? groundSpeed : 1);

        const aircraftCapacity = parseInt(aircraft.passenger_capacity.split('-')[0], 10);
        const segmentDemand = demandData[to.ident] || { demand: 0, avgFare: 0 };
        const passengers = Math.min(aircraftCapacity * AVG_LOAD_FACTOR, segmentDemand.demand);
        const revenue = passengers * segmentDemand.avgFare;
        const cost = (aircraftCapacity * COST_PER_HOUR_MULTIPLIER) * flightTimeHours;
        const profit = revenue - cost;
        
        const maxRange = parseFloat(aircraft.typical_range_km);
        const isFeasible = distance <= maxRange;
        
        return { distance, flightTimeHours, revenue, cost, profit: isFeasible ? profit : -Infinity, isFeasible };
    }
    
    function getPermutations(array) {
        if (array.length <= 1) return [array];
        const perms = [];
        for (let i = 0; i < array.length; i++) {
            const current = array[i];
            const remaining = [...array.slice(0, i), ...array.slice(i + 1)];
            const remainingPerms = getPermutations(remaining);
            for (let j = 0; j < remainingPerms.length; j++) {
                perms.push([current, ...remainingPerms[j]]);
            }
        }
        return perms;
    }

    function findShortestPath(source, dest, intermediates) {
        const permutations = getPermutations(intermediates);
        let bestRoute = [];
        let minDistance = Infinity;

        if (permutations.length === 0) {
            return { bestRoute: [source, ...intermediates, dest] };
        }

        permutations.forEach(p => {
            const currentRoute = [source, ...p, dest];
            let currentDistance = 0;
            for (let i = 0; i < currentRoute.length - 1; i++) {
                currentDistance += calculateSegmentMetrics(markers[currentRoute[i]], markers[currentRoute[i+1]], {}).distance;
            }
            if (currentDistance < minDistance) {
                minDistance = currentDistance;
                bestRoute = currentRoute;
            }
        });
        return { bestRoute, minDistance };
    }

    function runGeneticAlgorithm(source, dest, intermediates, aircraft) {
        const POPULATION_SIZE = 50;
        const GENERATIONS = 100;
        const MUTATION_RATE = 0.1;
        
        const shuffle = arr => arr.slice().sort(() => Math.random() - 0.5);
        let population = Array.from({ length: POPULATION_SIZE }, () => shuffle(intermediates));

        for (let gen = 0; gen < GENERATIONS; gen++) {
            const populationWithFitness = population.map(route => {
                const fullRoute = [source, ...route, dest];
                let totalProfit = 0;
                for (let i = 0; i < fullRoute.length - 1; i++) {
                    totalProfit += calculateSegmentMetrics(markers[fullRoute[i]], markers[fullRoute[i+1]], aircraft).profit;
                }
                return { route, fitness: totalProfit };
            });

            const parents = [];
            for (let i = 0; i < POPULATION_SIZE; i++) {
                const p1 = populationWithFitness[Math.floor(Math.random() * POPULATION_SIZE)];
                const p2 = populationWithFitness[Math.floor(Math.random() * POPULATION_SIZE)];
                parents.push(p1.fitness > p2.fitness ? p1 : p2);
            }
            
            const newPopulation = [];
            for (let i = 0; i < POPULATION_SIZE / 2; i++) {
                const parent1 = parents[Math.floor(Math.random() * parents.length)].route;
                const parent2 = parents[Math.floor(Math.random() * parents.length)].route;
                const start = Math.floor(Math.random() * parent1.length);
                const end = Math.floor(Math.random() * (parent1.length - start)) + start;
                let child1 = parent1.slice(start, end);
                parent2.forEach(item => !child1.includes(item) && child1.push(item));
                
                if (Math.random() < MUTATION_RATE) {
                    const idx1 = Math.floor(Math.random() * child1.length);
                    let idx2 = Math.floor(Math.random() * child1.length);
                    [child1[idx1], child1[idx2]] = [child1[idx2], child1[idx1]];
                }
                newPopulation.push(child1);
            }
            population = newPopulation.concat(newPopulation).slice(0, POPULATION_SIZE);
        }

        const finalFitness = population.map(route => {
            const fullRoute = [source, ...route, dest];
            let totalProfit = 0;
            for (let i = 0; i < fullRoute.length - 1; i++) {
                totalProfit += calculateSegmentMetrics(markers[fullRoute[i]], markers[fullRoute[i+1]], aircraft).profit;
            }
            return { route: fullRoute, fitness: totalProfit };
        });

        const bestSolution = finalFitness.sort((a, b) => b.fitness - a.fitness)[0];
        return { bestRoute: bestSolution.route, bestProfit: bestSolution.fitness };
    }
    
    // --- STARTUP ---
    // No initial data loading needed, user will upload files.
});