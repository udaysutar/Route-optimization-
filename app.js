// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map').setView([22.5, 78.9], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    let airportData = [];
    let demandData = {};
    let aircraftData = [];
    let markers = {};
    let currentRouteLayers = new L.FeatureGroup().addTo(map);
    let hubAirports = new Set();
    let weatherData = {};
    let weatherLoaded = false;

    const HUB_COUNT = 8;
    const HUB_DEMAND_BOOST = 1.25;

    const csvUpload = document.getElementById('csvUpload');
    const demandUpload = document.getElementById('demandUpload');
    const aircraftUpload = document.getElementById('aircraftUpload');
    const weatherUpload = document.getElementById('weatherUpload');
    const aircraftSelect = document.getElementById('aircraftSelect');
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
    const weatherStatus = document.getElementById('weatherStatus');

    csvUpload.addEventListener('change', (e) => handleFileUpload(e, 'airports'));
    demandUpload.addEventListener('change', (e) => handleFileUpload(e, 'demand'));
    aircraftUpload.addEventListener('change', (e) => handleFileUpload(e, 'aircraft'));
    weatherUpload.addEventListener('change', (e) => handleFileUpload(e, 'weather'));
    addIntermediateBtn.addEventListener('click', addIntermediateDropdown);
    drawRouteBtn.addEventListener('click', () => processRoute(false));
    optimizeRouteBtn.addEventListener('click', () => processRoute(true));
    resetBtn.addEventListener('click', resetApplication);

    aircraftSelect.innerHTML = '<option value="">Upload Aircraft CSV</option>';
    loadWeatherDataset();

    // SMART COST FUNCTION
    function calculateSmartCost(metrics) {
        const w_time = 0.4;
        const w_cost = 0.3;
        const w_demand = 0.2;
        const w_risk = 0.1;

        const delayRisk = typeof metrics.risk === 'number'
            ? metrics.risk
            : Math.random() * 0.3;

        return (
            (w_time * metrics.time) +
            (w_cost * metrics.cost) -
            (w_demand * metrics.passengers) +
            (w_risk * delayRisk)
        );
    }

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
                    updateHubSpoke();
                } 
                else if (type === 'demand') {
                    demandData = results.data.reduce((obj, item) => {
                        obj[item.ident] = {
                            demand: parseInt(item.demand, 10),
                            avgFare: parseFloat(item.avgFare)
                        };
                        return obj;
                    }, {});
                    updateHubSpoke();
                } 
                else if (type === 'aircraft') {
                    aircraftData = results.data.filter(ac => ac.type && ac.display_name);
                    aircraftSelect.innerHTML = aircraftData
                        .map((ac, i) => `<option value="${i}">${ac.display_name}</option>`)
                        .join('');
                } 
                else if (type === 'weather') {
                    loadWeatherFromRows(results.data);
                }
            }
        });
    }

    function updateWeatherStatus(text) {
        if (!weatherStatus) return;
        if (text) {
            weatherStatus.textContent = text;
            return;
        }
        weatherStatus.textContent = weatherLoaded
            ? `Loaded ${Object.keys(weatherData).length} stations`
            : 'Weather dataset not loaded';
    }

    function loadWeatherFromRows(rows) {
        weatherData = rows.reduce((obj, row) => {
            if (!row.ident) return obj;
            obj[row.ident] = {
                windSpeed: parseFloat(row.windSpeed) || 0,
                windDirection: parseFloat(row.windDirection) || 0,
                weatherType: row.weatherType || 'clear',
                visibility: parseFloat(row.visibility) || 10,
                temperature: parseFloat(row.temperature) || 25
            };
            return obj;
        }, {});
        weatherLoaded = true;
        updateWeatherStatus();
    }

    function loadWeatherDataset() {
        if (typeof Papa === 'undefined') {
            updateWeatherStatus('Weather parser not available');
            return;
        }

        Papa.parse('DATASET/generated_weather_dataset.csv', {
            download: true,
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                loadWeatherFromRows(results.data);
            },
            error: () => {
                weatherLoaded = false;
                updateWeatherStatus('Weather dataset not loaded');
            }
        });
    }

    function getWeatherFor(ident) {
        return weatherData[ident] || {
            windSpeed: 0,
            windDirection: 0,
            weatherType: 'clear',
            visibility: 10,
            temperature: 25
        };
    }

    function getWeatherRisk(weather) {
        let risk = 0.1;
        if (weather.weatherType === 'storm') risk = 0.6;
        else if (weather.weatherType === 'cloudy') risk = 0.3;

        if (weather.visibility < 5) risk += 0.2;
        if (weather.windSpeed > 40) risk += 0.2;
        if (weather.temperature > 35) risk += 0.1;

        return Math.min(1, risk);
    }

    function updateHubSpoke() {
        const demandEntries = airportData
            .filter(ap => ap.ident && demandData[ap.ident] && !isNaN(demandData[ap.ident].demand))
            .map(ap => ({ ident: ap.ident, demand: demandData[ap.ident].demand }))
            .sort((a, b) => b.demand - a.demand);

        const hubs = demandEntries.slice(0, HUB_COUNT).map(d => d.ident);
        hubAirports = new Set(hubs);

        plotAirports();
    }

    function buildAirportOptions() {
        return airportData
            .filter(ap => ap.name && !isNaN(parseFloat(ap.latitude_deg)))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(ap => `<option value="${ap.ident}">${ap.name} (${ap.ident})</option>`)
            .join('');
    }

    function getSelectedCodes() {
        const codes = [];
        if (sourceSelect.value) codes.push(sourceSelect.value);
        if (destinationSelect.value) codes.push(destinationSelect.value);
        const intermediateCodes = Array.from(intermediateSelectsContainer.querySelectorAll('select'))
            .map(s => s.value)
            .filter(v => v);
        return codes.concat(intermediateCodes);
    }

    function setSelectValue(selectEl, code) {
        if (!selectEl) return false;
        const optionExists = Array.from(selectEl.options).some(opt => opt.value === code);
        if (!optionExists) return false;
        selectEl.value = code;
        return true;
    }

    function handleMapSelection(code) {
        if (!code) return;

        const alreadySelected = getSelectedCodes().includes(code);
        if (alreadySelected) {
            alert("Airport already selected");
            return;
        }

        if (!sourceSelect.value) {
            setSelectValue(sourceSelect, code);
            return;
        }

        const intermediateSelects = Array.from(intermediateSelectsContainer.querySelectorAll('select'));
        const emptyIntermediate = intermediateSelects.find(s => !s.value);
        if (emptyIntermediate) {
            setSelectValue(emptyIntermediate, code);
            return;
        }

        if (!destinationSelect.value) {
            setSelectValue(destinationSelect, code);
            return;
        }

        // If all are filled, replace destination with latest selection
        setSelectValue(destinationSelect, code);
    }

    function populateAirportDropdowns() {
        const optionsHtml = buildAirportOptions();

        sourceSelect.innerHTML = `<option value="">Select Source</option>${optionsHtml}`;
        destinationSelect.innerHTML = `<option value="">Select Destination</option>${optionsHtml}`;
        intermediateSelectsContainer.innerHTML = '';
    }

    function plotAirports() {
        Object.values(markers).forEach(m => map.removeLayer(m.marker));
        markers = {};

        airportData.forEach(ap => {
            const lat = parseFloat(ap.latitude_deg);
            const lon = parseFloat(ap.longitude_deg);
            if (isNaN(lat) || isNaN(lon)) return;

            const isHub = hubAirports.has(ap.ident);
            const marker = L.circleMarker([lat, lon], {
                radius: isHub ? 8 : 5,
                color: isHub ? '#1e7e34' : '#1f6feb',
                fillColor: isHub ? '#2ecc71' : '#4dabf7',
                fillOpacity: isHub ? 0.9 : 0.7,
                weight: isHub ? 2 : 1
            }).addTo(map);
            if (ap.name && ap.ident) {
                marker.bindTooltip(`${ap.name} (${ap.ident})${isHub ? ' - Hub' : ''}`, {
                    direction: 'top',
                    opacity: 0.9,
                    offset: [0, -6]
                });
            } else if (ap.name) {
                marker.bindTooltip(ap.name, {
                    direction: 'top',
                    opacity: 0.9,
                    offset: [0, -6]
                });
            }
            marker.on('click', () => handleMapSelection(ap.ident));
            markers[ap.ident] = { ...ap, marker };
        });
    }

    function addIntermediateDropdown() {
        if (!airportData.length) {
            alert("Upload Airports CSV first");
            return;
        }

        const container = document.createElement('div');
        container.className = 'intermediate-stop';

        const newSelect = document.createElement('select');
        const removeBtn = document.createElement('button');

        const optionsHtml = buildAirportOptions();
        newSelect.innerHTML = `<option value="">Select Intermediate</option>${optionsHtml}`;

        removeBtn.type = 'button';
        removeBtn.textContent = 'x';
        removeBtn.setAttribute('aria-label', 'Remove intermediate stop');
        removeBtn.addEventListener('click', () => container.remove());

        container.appendChild(newSelect);
        container.appendChild(removeBtn);
        intermediateSelectsContainer.appendChild(container);
    }

    function processRoute(optimize) {
        if (!airportData.length) {
            alert("Upload Airports CSV first");
            return;
        }

        const sourceCode = sourceSelect.value;
        const destCode = destinationSelect.value;

        let intermediateCodes = Array.from(intermediateSelectsContainer.querySelectorAll('select'))
            .map(s => s.value).filter(v => v);

        intermediateCodes = [...new Set(intermediateCodes)];

        const aircraft = aircraftData[aircraftSelect.value];

        if (!aircraft) {
            alert("Select aircraft");
            return;
        }

        if (!sourceCode || !destCode) {
            alert("Select source and destination");
            return;
        }

        if (sourceCode === destCode) {
            alert("Source and destination must be different");
            return;
        }

        if (!markers[sourceCode] || !markers[destCode]) {
            alert("Selected airports are not available on the map");
            return;
        }

        intermediateCodes = intermediateCodes.filter(code => code !== sourceCode && code !== destCode);

        if (!optimize) {
            displayRoute([sourceCode, ...intermediateCodes, destCode], aircraft);
        } else {
            if (optModeSelect.value === 'dijkstra') {
                displayRoute(findBestRoute(sourceCode, destCode, intermediateCodes, aircraft), aircraft);
            } else {
                displayRoute(runGeneticAlgorithm(sourceCode, destCode, intermediateCodes, aircraft), aircraft);
            }
        }
    }

    function displayRoute(route, aircraft) {
        if (!route.length) return;
        if (!route.every(code => markers[code])) {
            alert("Route contains invalid airports");
            return;
        }

        currentRouteLayers.clearLayers();
        distanceTableBody.innerHTML = '';

        const latlngs = route.map(code => [
            parseFloat(markers[code].latitude_deg),
            parseFloat(markers[code].longitude_deg)
        ]);

        const line = L.polyline(latlngs).addTo(currentRouteLayers);
        if (latlngs.length > 1) {
            map.fitBounds(line.getBounds(), { padding: [20, 20] });
        }

        let totalDistance = 0;
        let totalProfit = 0;

        for (let i = 0; i < route.length - 1; i++) {
            const m = calculateSegmentMetrics(markers[route[i]], markers[route[i + 1]], aircraft);

            totalDistance += m.distance;
            totalProfit += m.profit;

            distanceTableBody.innerHTML += `
                <tr>
                    <td>${route[i]}</td>
                    <td>${route[i+1]}</td>
                    <td>${m.distance.toFixed(0)}</td>
                    <td>${m.passengers}</td>
                    <td>${m.revenue.toFixed(0)}</td>
                    <td>${m.cost.toFixed(0)}</td>
                    <td>${m.profit.toFixed(0)}</td>
                </tr>`;
        }

        totalDistCell.textContent = totalDistance.toFixed(0);
        totalProfitCell.textContent = totalProfit.toFixed(0);

        infoBox.textContent = `Route: ${route.join(' -> ')} | Profit: Rs ${totalProfit.toFixed(0)}`;
    }

    function calculateSegmentMetrics(from, to, aircraft) {
        const toRad = d => d * Math.PI / 180;
        const R = 6371;

        const lat1 = toRad(parseFloat(from.latitude_deg));
        const lon1 = toRad(parseFloat(from.longitude_deg));
        const lat2 = toRad(parseFloat(to.latitude_deg));
        const lon2 = toRad(parseFloat(to.longitude_deg));

        const dLat = lat2 - lat1;
        const dLon = lon2 - lon1;

        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

        const distance = R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

        const cruiseSpeed = parseFloat(aircraft.cruise_speed_kmh);

        const fromWeather = getWeatherFor(from.ident);
        const toWeather = getWeatherFor(to.ident);
        const avgWindSpeed = (fromWeather.windSpeed + toWeather.windSpeed) / 2;
        const windPenalty = 1 + (avgWindSpeed / 200);
        const time = (distance / cruiseSpeed) * windPenalty;

        const aircraftCapacity = parseInt(aircraft.passenger_capacity.split('-')[0], 10);
        const segmentDemand = demandData[to.ident] || { demand: 100, avgFare: 6000 };

        const demandBoost = hubAirports.has(to.ident) ? HUB_DEMAND_BOOST : 1;
        const boostedDemand = segmentDemand.demand * demandBoost;
        const passengers = Math.min(aircraftCapacity * 0.85, boostedDemand);
        const revenue = passengers * segmentDemand.avgFare;

        const cost = (aircraftCapacity * 12) * time;
        const profit = revenue - cost;
        const risk = (getWeatherRisk(fromWeather) + getWeatherRisk(toWeather)) / 2;

        return { distance, time, passengers, revenue, cost, profit, risk };
    }

    function findBestRoute(source, dest, intermediates, aircraft) {
        if (!intermediates.length) return [source, dest];

        const permutations = getPermutations(intermediates);
        let bestRoute = [];
        let minCost = Infinity;

        permutations.forEach(p => {
            const route = [source, ...p, dest];
            let totalCost = 0;

            for (let i = 0; i < route.length - 1; i++) {
                const m = calculateSegmentMetrics(markers[route[i]], markers[route[i+1]], aircraft);
                totalCost += calculateSmartCost(m);
            }

            if (totalCost < minCost) {
                minCost = totalCost;
                bestRoute = route;
            }
        });

        return bestRoute;
    }

    function runGeneticAlgorithm(source, dest, intermediates, aircraft) {
        if (!intermediates.length) return [source, dest];

        const shuffle = arr => arr.slice().sort(() => Math.random() - 0.5);
        let population = Array.from({ length: 30 }, () => shuffle(intermediates));

        for (let g = 0; g < 80; g++) {
            population = population.sort((a, b) => {
                const sa = calcSmartScore([source, ...a, dest], aircraft);
                const sb = calcSmartScore([source, ...b, dest], aircraft);
                return sa - sb;
            }).slice(0, 15);

            population = population.concat(population.map(shuffle));
        }

        return [source, ...population[0], dest];
    }

    function calcSmartScore(route, aircraft) {
        let total = 0;
        for (let i = 0; i < route.length - 1; i++) {
            const m = calculateSegmentMetrics(markers[route[i]], markers[route[i + 1]], aircraft);
            total += calculateSmartCost(m);
        }
        return total;
    }

    function getPermutations(arr) {
        if (arr.length <= 1) return [arr];
        return arr.flatMap((x, i) =>
            getPermutations([...arr.slice(0, i), ...arr.slice(i + 1)])
                .map(p => [x, ...p])
        );
    }

    function resetApplication() {
        currentRouteLayers.clearLayers();
        distanceTableBody.innerHTML = '';
        totalDistCell.textContent = '';
        totalProfitCell.textContent = '';
        infoBox.textContent = '';
        sourceSelect.value = '';
        destinationSelect.value = '';
        intermediateSelectsContainer.innerHTML = '';
    }
});
