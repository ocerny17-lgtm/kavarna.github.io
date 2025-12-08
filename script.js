// Remote sync constants (public, no auth; fallback to local when offline)
const REMOTE_STORE_URL = 'https://jsonbase.com/kavarna-ondry-anet/active-orders';
const REMOTE_SYNC_INTERVAL = 8000; // ms

// Uložené objednávky (migrace na nový formát)
let orders = normalizeOrders(JSON.parse(localStorage.getItem('cafeOrders')) || []);
let currentBarista = sessionStorage.getItem('currentBarista') || null;
let orderTimers = {};
let remoteSyncTimer = null;

document.addEventListener('DOMContentLoaded', initializeApp);

async function initializeApp() {
    displayOrders();
    setupOrderButtons();
    setupMilkToggle();
    setupLoginHandling();
    applyRoleUi();
    await pullRemoteOrders(); // načíst sdílené objednávky, pokud jsou
    startAllTimers();
    startRemoteSync();
}

function setupOrderButtons() {
    document.querySelectorAll('.order-btn').forEach(btn => {
        btn.addEventListener('click', () => handleDrinkOrder(btn.dataset.coffee));
    });
}

function setupMilkToggle() {
    const toggleContainer = document.getElementById('milkToggle');
    if (!toggleContainer) return;

    toggleContainer.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const value = btn.dataset.milk === 'true';
            document.getElementById('withMilk').value = value ? 'true' : 'false';

            toggleContainer.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

function setupLoginHandling() {
    document.getElementById('loginBtn').addEventListener('click', openLoginModal);
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.querySelector('.close').addEventListener('click', closeLoginModal);

    window.addEventListener('click', (e) => {
        const modal = document.getElementById('loginModal');
        if (e.target === modal) {
            closeLoginModal();
        }
    });

    if (currentBarista) {
        enableBaristaMode();
    }
}

function handleDrinkOrder(coffeeType) {
    if (currentBarista) {
        showNotification('Baristé nemohou zadávat nové objednávky.');
        return;
    }

    const customerName = document.getElementById('customerName').value.trim();
    const extraWishes = document.getElementById('extraWishes').value.trim();
    const withMilk = document.getElementById('withMilk').value === 'true';
    const sugarSpoons = Math.max(0, parseInt(document.getElementById('sugarSpoons').value, 10) || 0);

    if (!customerName) {
        alert('Prosím vyplňte jméno, abychom věděli, komu nápoj patří.');
        return;
    }

    const order = {
        id: Date.now(),
        customerName,
        coffeeType,
        extraWishes,
        withMilk,
        sugarSpoons,
        status: 'new',
        barista: null,
        date: new Date().toLocaleString('cs-CZ'),
        timestamp: Date.now(),
        updatedAt: Date.now()
    };

    orders.push(order);
    persistOrders();

    document.getElementById('extraWishes').value = '';
    document.getElementById('sugarSpoons').value = '0';
    document.getElementById('withMilk').value = 'true';
    setupMilkToggle(); // reset active state
    displayOrders();
    startTimer(order.id);
    showNotification('Objednávka byla úspěšně odeslána! ☕');
}

function displayOrders() {
    const ordersList = document.getElementById('ordersList');
    const activeOrders = orders.filter(order => order.status !== 'done');

    if (activeOrders.length === 0) {
        ordersList.innerHTML = '<p class="no-orders">Zatím žádné objednávky</p>';
        return;
    }

    ordersList.innerHTML = activeOrders.map(order => createOrderCard(order)).join('');

    activeOrders.forEach(order => {
        const claimBtn = document.getElementById(`claim-${order.id}`);
        const deliverBtn = document.getElementById(`deliver-${order.id}`);

        if (claimBtn) {
            claimBtn.addEventListener('click', () => claimOrder(order.id));
        }
        if (deliverBtn) {
            deliverBtn.addEventListener('click', () => markDelivering(order.id));
        }
    });

    startAllTimers();
}

function createOrderCard(order) {
    const statusText = {
        new: 'Čeká na baristu',
        claimed: `Připravuje: ${order.barista || '—'}`,
        delivering: `Nesu do obýváku: ${order.barista || '—'}`
    }[order.status] || 'Stav neznámý';

    const statusClass = {
        new: 'status-new',
        claimed: 'status-claimed',
        delivering: 'status-delivering'
    }[order.status] || '';

    const isMyOrder = currentBarista && order.barista === currentBarista;

    const actions = [];
    if (currentBarista && order.status === 'new') {
        actions.push(`<button class="complete-btn visible" id="claim-${order.id}">Převzít</button>`);
    }
    if (currentBarista && order.status === 'claimed' && isMyOrder) {
        actions.push(`<button class="complete-btn visible" id="deliver-${order.id}">Nesu do obýváku</button>`);
    }

    return `
        <div class="order-card" id="order-${order.id}">
            <div class="order-header">
                <div>
                    <div class="order-name">${escapeHtml(order.customerName)}</div>
                    <div class="order-time">${order.date}</div>
                </div>
                <span class="status-badge ${statusClass}">${escapeHtml(statusText)}</span>
            </div>
            <div class="order-details">
                <div class="order-detail-item">
                    <strong>Nápoj:</strong> ${escapeHtml(order.coffeeType)}
                </div>
                <div class="order-detail-item">
                    <strong>Mléko:</strong> ${order.withMilk ? 'Ano' : 'Ne'}
                </div>
                <div class="order-detail-item">
                    <strong>Cukr:</strong> ${order.sugarSpoons || 0} ${order.sugarSpoons === 1 ? 'lžička' : (order.sugarSpoons >= 2 && order.sugarSpoons <= 4 ? 'lžičky' : 'lžiček')}
                </div>
                ${order.extraWishes ? `<div class="order-detail-item"><strong>Poznámka:</strong> ${escapeHtml(order.extraWishes)}</div>` : ''}
                <div class="timer" id="timer-${order.id}">Čas: 0:00</div>
            </div>
            ${actions.join('')}
        </div>
    `;
}

function claimOrder(orderId) {
    if (!currentBarista) {
        alert('K převzetí se musíte přihlásit jako barista.');
        return;
    }

    const order = orders.find(o => o.id === orderId);
    if (!order || order.status !== 'new') return;

    order.status = 'claimed';
    order.barista = currentBarista;
    order.updatedAt = Date.now();
    persistOrders();
    displayOrders();
    showNotification(`Objednávku převzal/a ${currentBarista}.`);
}

function markDelivering(orderId) {
    if (!currentBarista) {
        alert('K označení doručení se musíte přihlásit jako barista.');
        return;
    }

    const order = orders.find(o => o.id === orderId);
    if (!order || order.barista !== currentBarista || order.status !== 'claimed') return;

    order.status = 'delivering';
    order.updatedAt = Date.now();
    persistOrders();
    displayOrders();
    showNotification(`Objednávku nese do obýváku ${currentBarista}.`);
}

function startTimer(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === 'done') return;

    if (orderTimers[orderId]) {
        clearInterval(orderTimers[orderId]);
    }

    updateTimer(orderId);

    orderTimers[orderId] = setInterval(() => {
        updateTimer(orderId);
    }, 1000);
}

function updateTimer(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === 'done') {
        if (orderTimers[orderId]) {
            clearInterval(orderTimers[orderId]);
            delete orderTimers[orderId];
        }
        return;
    }

    const timerElement = document.getElementById(`timer-${orderId}`);
    if (!timerElement) return;

    const elapsed = Date.now() - order.timestamp;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);

    timerElement.textContent = `Čas: ${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function startAllTimers() {
    orders.forEach(order => {
        if (order.status !== 'done') {
            startTimer(order.id);
        }
    });
}

function openLoginModal() {
    document.getElementById('loginModal').style.display = 'block';
    document.getElementById('loginError').textContent = '';
}

function closeLoginModal() {
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('loginForm').reset();
    document.getElementById('loginError').textContent = '';
}

function handleLogin(e) {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    const credentials = {
        'Ondrej': '1711',
        'Anet': 'Sunny'
    };

    if (credentials[username] && credentials[username] === password) {
        currentBarista = username;
        sessionStorage.setItem('currentBarista', username);
        enableBaristaMode();
        closeLoginModal();
        showNotification(`Přihlášen barista ${username}.`);
        displayOrders();
    } else {
        document.getElementById('loginError').textContent = 'Nesprávné jméno nebo heslo.';
    }
}

function enableBaristaMode() {
    document.body.classList.add('barista-mode');
    const loginBtn = document.getElementById('loginBtn');
    loginBtn.textContent = `Odhlásit se (${currentBarista})`;
    loginBtn.onclick = handleLogout;
}

function applyRoleUi() {
    if (currentBarista) {
        document.body.classList.add('barista-mode');
        const loginBtn = document.getElementById('loginBtn');
        loginBtn.textContent = `Odhlásit se (${currentBarista})`;
        loginBtn.onclick = handleLogout;
    } else {
        document.body.classList.remove('barista-mode');
        const loginBtn = document.getElementById('loginBtn');
        loginBtn.textContent = 'Přihlásit se (Barista)';
        loginBtn.onclick = openLoginModal;
    }
}

function handleLogout() {
    currentBarista = null;
    sessionStorage.removeItem('currentBarista');
    applyRoleUi();
    displayOrders();
    showNotification('Byl jste odhlášen.');
}

function persistOrders() {
    localStorage.setItem('cafeOrders', JSON.stringify(orders));
    pushRemoteOrders();
}

function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 15px 25px;
        border-radius: 10px;
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
        z-index: 2000;
        animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function normalizeOrders(list) {
    return (list || []).map(order => ({
        ...order,
        status: order?.status || (order?.completed ? 'done' : 'new'),
        barista: order?.barista || null,
        withMilk: typeof order?.withMilk === 'boolean' ? order.withMilk : true,
        sugarSpoons: Number.isFinite(order?.sugarSpoons) ? order.sugarSpoons : 0,
        timestamp: order?.timestamp || Date.now(),
        updatedAt: order?.updatedAt || order?.timestamp || Date.now(),
        completed: false
    }));
}

async function pullRemoteOrders() {
    try {
        const res = await fetch(REMOTE_STORE_URL, { cache: 'no-store' });
        if (!res.ok) return;
        const remoteData = await res.json();
        if (!Array.isArray(remoteData)) return;
        mergeOrdersFromRemote(normalizeOrders(remoteData));
    } catch (err) {
        console.warn('Remote sync (pull) failed', err);
    }
}

async function pushRemoteOrders() {
    try {
        await fetch(REMOTE_STORE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orders)
        });
    } catch (err) {
        console.warn('Remote sync (push) failed', err);
    }
}

function mergeOrdersFromRemote(remoteOrders) {
    const map = new Map();
    normalizeOrders(orders).forEach(o => map.set(o.id, o));
    remoteOrders.forEach(ro => {
        const existing = map.get(ro.id);
        if (!existing || (ro.updatedAt || ro.timestamp || 0) > (existing.updatedAt || existing.timestamp || 0)) {
            map.set(ro.id, ro);
        }
    });
    orders = Array.from(map.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    localStorage.setItem('cafeOrders', JSON.stringify(orders));
    displayOrders();
    startAllTimers();
}

function startRemoteSync() {
    if (remoteSyncTimer) clearInterval(remoteSyncTimer);
    remoteSyncTimer = setInterval(() => {
        pullRemoteOrders();
    }, REMOTE_SYNC_INTERVAL);
}

// Animace notifikací
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

