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

    const csvUpload = document.getElementById('csvUpload');
    const demandUpload = document.getElementById('demandUpload');
    const aircraftUpload = document.getElementById('aircraftUpload');
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

    csvUpload.addEventListener('change', (e) => handleFileUpload(e, 'airports'));
    demandUpload.addEventListener('change', (e) => handleFileUpload(e, 'demand'));
    aircraftUpload.addEventListener('change', (e) => handleFileUpload(e, 'aircraft'));
    addIntermediateBtn.addEventListener('click', addIntermediateDropdown);
    drawRouteBtn.addEventListener('click', () => processRoute(false));
    optimizeRouteBtn.addEventListener('click', () => processRoute(true));
    resetBtn.addEventListener('click', resetApplication);

    aircraftSelect.innerHTML = '<option value="">Upload Aircraft CSV</option>';

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
                } 
                else if (type === 'demand') {
                    demandData = results.data.reduce((obj, item) => {
                        obj[item.ident] = {
                            demand: parseInt(item.demand, 10),
                            avgFare: parseFloat(item.avgFare)
                        };
                        return obj;
                    }, {});
                } 
                else if (type === 'aircraft') {
                    aircraftData = results.data.filter(ac => ac.type && ac.display_name);
                    aircraftSelect.innerHTML = aircraftData
                        .map((ac, i) => `<option value="${i}">${ac.display_name}</option>`)
                        .join('');
                }
            }
        });
    }

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

    function plotAirports() {
        Object.values(markers).forEach(m => map.removeLayer(m.marker));
        markers = {};

        airportData.forEach(ap => {
            const lat = parseFloat(ap.latitude_deg);
            const lon = parseFloat(ap.longitude_deg);
            if (isNaN(lat) || isNaN(lon)) return;

            const marker = L.circleMarker([lat, lon], { radius: 5 }).addTo(map);
            markers[ap.ident] = { ...ap, marker };
        });
    }

    function addIntermediateDropdown() {
        const container = document.createElement('div');
        const newSelect = document.createElement('select');

        const optionsHtml = airportData.map(ap =>
            `<option value="${ap.ident}">${ap.name} (${ap.ident})</option>`
        ).join('');

        newSelect.innerHTML = `<option value="">Select Intermediate</option>${optionsHtml}`;
        container.appendChild(newSelect);
        intermediateSelectsContainer.appendChild(container);
    }

    function processRoute(optimize) {
        const sourceCode = sourceSelect.value;
        const destCode = destinationSelect.value;

        let intermediateCodes = Array.from(intermediateSelectsContainer.querySelectorAll('select'))
            .map(s => s.value).filter(v => v);

        // ✅ FIX: remove duplicates INCLUDING consecutive duplicates
        intermediateCodes = [...new Set(intermediateCodes)];
        if (intermediateCodes.includes(sourceCode) || intermediateCodes.includes(destCode)) {
            intermediateCodes = intermediateCodes.filter(x => x !== sourceCode && x !== destCode);
        }

        const aircraft = aircraftData[aircraftSelect.value];

        if (!aircraft) {
            alert("Select aircraft");
            return;
        }

        if (!optimize) {
            displayRoute([sourceCode, ...intermediateCodes, destCode], aircraft);
        } else {
            if (optModeSelect.value === 'dijkstra') {
                displayRoute(findShortestPath(sourceCode, destCode, intermediateCodes).bestRoute, aircraft);
            } else {
                displayRoute(runGeneticAlgorithm(sourceCode, destCode, intermediateCodes, aircraft).bestRoute, aircraft);
            }
        }
    }

    function displayRoute(route, aircraft) {
        currentRouteLayers.clearLayers();
        distanceTableBody.innerHTML = '';

        const latlngs = route.map(code => [
            parseFloat(markers[code].latitude_deg),
            parseFloat(markers[code].longitude_deg)
        ]);

        L.polyline(latlngs).addTo(currentRouteLayers);

        let totalDistance = 0;
        let totalProfit = 0;

        for (let i = 0; i < route.length - 1; i++) {
            const from = markers[route[i]];
            const to = markers[route[i + 1]];

            const m = calculateSegmentMetrics(from, to, aircraft);
            totalDistance += m.distance;
            totalProfit += m.profit;

            console.log("LEG DEBUG:", route[i], "→", route[i + 1], m);

            distanceTableBody.innerHTML += `
                <tr>
                    <td>${from.ident}</td>
                    <td>${to.ident}</td>
                    <td>${m.distance.toFixed(0)}</td>
                    <td>${m.passengers}</td>
                    <td>${m.revenue.toFixed(0)}</td>
                    <td>${m.cost.toFixed(0)}</td>
                    <td>${m.profit.toFixed(0)}</td>
                </tr>`;
        }

        totalDistCell.textContent = totalDistance.toFixed(0);
        totalProfitCell.textContent = totalProfit.toFixed(0);

        infoBox.textContent = `Route: ${route.join(' → ')} | Profit: ₹${totalProfit.toFixed(0)}`;
    }

    function resetApplication() {
        currentRouteLayers.clearLayers();
        distanceTableBody.innerHTML = '';
        totalDistCell.textContent = '';
        totalProfitCell.textContent = '';
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
        const time = distance / cruiseSpeed;

        const aircraftCapacity = parseInt(aircraft.passenger_capacity.split('-')[0], 10);
        const segmentDemand = demandData[to.ident] || { demand: 100, avgFare: 6000 };

        const passengers = Math.min(aircraftCapacity * 0.85, segmentDemand.demand);
        const revenue = passengers * segmentDemand.avgFare;

        // ✅ softened cost for profitability
        const COST_PER_HOUR = 12;
        const cost = (aircraftCapacity * COST_PER_HOUR) * time;

        const profit = revenue - cost;

        return { distance, time, passengers, revenue, cost, profit };
    }

    function findShortestPath(source, dest, intermediates) {
        if (!intermediates.length) return { bestRoute: [source, dest] };
        const permutations = getPermutations(intermediates);
        let bestRoute = [];
        let minDist = Infinity;

        permutations.forEach(p => {
            const r = [source, ...p, dest];
            let d = 0;
            for (let i = 0; i < r.length - 1; i++) {
                d += calculateSegmentMetrics(markers[r[i]], markers[r[i+1]], {}).distance;
            }
            if (d < minDist) {
                minDist = d;
                bestRoute = r;
            }
        });

        return { bestRoute };
    }

    function getPermutations(arr) {
        if (arr.length <= 1) return [arr];
        return arr.flatMap((x, i) =>
            getPermutations([...arr.slice(0, i), ...arr.slice(i + 1)])
                .map(p => [x, ...p])
        );
    }

    function runGeneticAlgorithm(source, dest, intermediates, aircraft) {
        if (!intermediates.length) return { bestRoute: [source, dest] };
        const shuffle = arr => arr.slice().sort(() => Math.random() - 0.5);
        let population = Array.from({ length: 30 }, () => shuffle(intermediates));

        for (let g = 0; g < 80; g++) {
            population = population.sort((a, b) => {
                const pa = calcProfit([source, ...a, dest], aircraft);
                const pb = calcProfit([source, ...b, dest], aircraft);
                return pb - pa;
            }).slice(0, 15);

            population = population.concat(population.map(shuffle));
        }

        return { bestRoute: [source, ...population[0], dest] };
    }

    function calcProfit(route, aircraft) {
        let sum = 0;
        for (let i = 0; i < route.length - 1; i++) {
            sum += calculateSegmentMetrics(markers[route[i]], markers[route[i + 1]], aircraft).profit;
        }
        return sum;
    }
});
