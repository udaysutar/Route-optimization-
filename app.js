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

    // ✅ SMART COST FUNCTION
    function calculateSmartCost(metrics) {
        const w_time = 0.4;
        const w_cost = 0.3;
        const w_demand = 0.2;
        const w_risk = 0.1;

        const delayRisk = Math.random() * 0.3;

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

        intermediateCodes = [...new Set(intermediateCodes)];

        const aircraft = aircraftData[aircraftSelect.value];

        if (!aircraft) {
            alert("Select aircraft");
            return;
        }

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

        infoBox.textContent = `Route: ${route.join(' → ')} | Profit: ₹${totalProfit.toFixed(0)}`;
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

        const cost = (aircraftCapacity * 12) * time;
        const profit = revenue - cost;

        return { distance, time, passengers, revenue, cost, profit };
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
    }
});