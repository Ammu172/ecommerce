let token = localStorage.getItem('token') || null;
let cart = JSON.parse(localStorage.getItem('cart')) || [];
let selectedPayment = null;

function showMessage(msg, type) {
    const msgDiv = document.getElementById('message');
    msgDiv.textContent = msg;
    msgDiv.className = `message ${type}`;
    msgDiv.style.display = 'block';
    setTimeout(() => msgDiv.style.display = 'none', 3000);
}

async function fetchAPI(endpoint, options = {}) {
    const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` }),
            ...options.headers
        }
    });
    if (response.status === 401) logout();
    return response;
}

async function login(email, password) {
    try {
        const response = await fetchAPI('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();
        if (response.ok) {
            token = data.token;
            localStorage.setItem('token', token);
            showMessage('Login successful!', 'success');
            showProducts();
            updateAuthUI();
        } else {
            showMessage(data.message, 'error');
        }
    } catch (error) {
        showMessage('Login failed', 'error');
    }
}

async function register(name, email, password) {
    try {
        const response = await fetchAPI('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ name, email, password })
        });
        const data = await response.json();
        if (response.ok) {
            token = data.token;
            localStorage.setItem('token', token);
            showMessage('Registration successful!', 'success');
            showProducts();
            updateAuthUI();
        } else {
            showMessage(data.message, 'error');
        }
    } catch (error) {
        showMessage('Registration failed', 'error');
    }
}

function logout() {
    token = null;
    localStorage.removeItem('token');
    cart = [];
    localStorage.removeItem('cart');
    updateCartUI();
    showAuth();
    updateAuthUI();
    showMessage('Logged out successfully', 'success');
}

function updateAuthUI() {
    const authBtn = document.getElementById('auth-btn');
    const logoutBtn = document.getElementById('logout-btn');
    if (token) {
        authBtn.style.display = 'none';
        logoutBtn.style.display = 'inline';
    } else {
        authBtn.style.display = 'inline';
        logoutBtn.style.display = 'none';
    }
}

async function showProducts() {
    document.getElementById('app').innerHTML = '<div class="loading">Loading products...</div>';
    try {
        const response = await fetchAPI('/products');
        const products = await response.json();
        displayProducts(products);
    } catch (error) {
        document.getElementById('app').innerHTML = '<div class="loading">Error loading products. Make sure backend is running.</div>';
    }
}

function displayProducts(products) {
    if (!products.length) {
        document.getElementById('app').innerHTML = '<div class="loading">No products found</div>';
        return;
    }
    
    document.getElementById('app').innerHTML = `
        <h2>Our Products</h2>
        <div class="products-grid">
            ${products.map(product => `
                <div class="product-card">
                    <img src="${product.image_url || 'https://picsum.photos/200/200'}" alt="${product.name}">
                    <h3>${product.name}</h3>
                    <p>${product.description?.substring(0, 100) || ''}</p>
                    <div class="price">${APP_CONFIG.currency}${parseInt(product.price).toLocaleString()}</div>
                    <div>Stock: ${product.stock}</div>
                    <button onclick="addToCart(${product.id}, '${product.name}', ${product.price})">Add to Cart</button>
                </div>
            `).join('')}
        </div>
    `;
}

function addToCart(id, name, price) {
    const existing = cart.find(item => item.id === id);
    if (existing) {
        existing.quantity++;
    } else {
        cart.push({ id, name, price, quantity: 1 });
    }
    localStorage.setItem('cart', JSON.stringify(cart));
    updateCartUI();
    showMessage(`${name} added to cart`, 'success');
}

function removeFromCart(id) {
    cart = cart.filter(item => item.id !== id);
    localStorage.setItem('cart', JSON.stringify(cart));
    updateCartUI();
    if (cart.length === 0) toggleCart();
}

function updateCartUI() {
    const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    document.getElementById('cart-count').textContent = cartCount;
    document.getElementById('cart-total').textContent = cartTotal.toLocaleString();
    
    const cartItemsDiv = document.getElementById('cart-items');
    if (cartItemsDiv) {
        if (cart.length === 0) {
            cartItemsDiv.innerHTML = '<p style="text-align:center;">Your cart is empty</p>';
        } else {
            cartItemsDiv.innerHTML = cart.map(item => `
                <div class="cart-item">
                    <strong>${item.name}</strong><br>
                    ${APP_CONFIG.currency}${item.price} x ${item.quantity} = ${APP_CONFIG.currency}${(item.price * item.quantity).toLocaleString()}
                    <br><button onclick="removeFromCart(${item.id})">Remove</button>
                </div>
            `).join('');
        }
    }
}

function toggleCart() {
    document.getElementById('cart-sidebar').classList.toggle('open');
}

function openCheckoutModal() {
    if (!token) {
        showMessage('Please login first', 'error');
        showAuth();
        return;
    }
    if (cart.length === 0) {
        showMessage('Cart is empty', 'error');
        return;
    }
    document.getElementById('checkout-modal').style.display = 'block';
}

function closeCheckoutModal() {
    document.getElementById('checkout-modal').style.display = 'none';
    selectedPayment = null;
    document.getElementById('payment-details').style.display = 'none';
}

function selectPayment(method) {
    selectedPayment = method;
    
    document.querySelectorAll('.payment-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    event.currentTarget.classList.add('selected');
    
    const paymentDetailsDiv = document.getElementById('payment-details');
    const paymentFormDiv = document.getElementById('payment-form');
    
    if (method === 'credit_card' || method === 'debit_card') {
        paymentFormDiv.innerHTML = `
            <label>Card Number:</label>
            <input type="text" id="card-number" placeholder="1234 5678 9012 3456">
            <label>Expiry Date:</label>
            <input type="text" id="expiry" placeholder="MM/YY">
            <label>CVV:</label>
            <input type="password" id="cvv" placeholder="123" maxlength="3">
        `;
        paymentDetailsDiv.style.display = 'block';
    } else if (method === 'upi') {
        paymentFormDiv.innerHTML = `
            <label>UPI ID:</label>
            <input type="text" id="upi-id" placeholder="username@okhdfcbank">
        `;
        paymentDetailsDiv.style.display = 'block';
    } else if (method === 'cod') {
        paymentFormDiv.innerHTML = `<p>✅ You will pay ₹${document.getElementById('cart-total').innerText} when your order is delivered.</p>`;
        paymentDetailsDiv.style.display = 'block';
    }
}

async function placeOrder() {
    if (!selectedPayment) {
        showMessage('Please select a payment method', 'error');
        return;
    }
    
    const address = document.getElementById('shipping-address').value;
    if (!address) {
        showMessage('Please enter shipping address', 'error');
        return;
    }
    
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    const confirmBtn = document.querySelector('.confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Processing...';
    
    try {
        const response = await fetchAPI('/orders', {
            method: 'POST',
            body: JSON.stringify({
                items: cart,
                total: total,
                payment_method: selectedPayment,
                shipping_address: address
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage(`✅ Order placed successfully!`, 'success');
            cart = [];
            localStorage.setItem('cart', JSON.stringify(cart));
            updateCartUI();
            closeCheckoutModal();
            showOrders();
        } else {
            showMessage(data.message || 'Order failed', 'error');
        }
    } catch (error) {
        showMessage('Error placing order', 'error');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Place Order';
    }
}

async function showOrders() {
    if (!token) {
        showMessage('Please login to view orders', 'error');
        showAuth();
        return;
    }
    
    document.getElementById('app').innerHTML = '<div class="loading">Loading orders...</div>';
    
    try {
        const response = await fetchAPI('/orders');
        const orders = await response.json();
        
        if (!orders || orders.length === 0) {
            document.getElementById('app').innerHTML = `
                <h2>My Orders</h2>
                <p style="text-align:center; padding:2rem;">No orders yet. Start shopping!</p>
                <button onclick="showProducts()" style="display:block; margin:0 auto; padding:0.75rem 1.5rem;">Browse Products</button>
            `;
            return;
        }
        
        document.getElementById('app').innerHTML = `
            <h2>My Orders (${orders.length})</h2>
            ${orders.map(order => `
                <div class="order-card">
                    <p><strong>Order #${order.id}</strong></p>
                    <p>📅 Date: ${new Date(order.created_at).toLocaleString()}</p>
                    <p>💰 Total: ${APP_CONFIG.currency}${parseInt(order.total_amount).toLocaleString()}</p>
                    <p>💳 Payment: ${order.payment_method}</p>
                    <p>📦 Status: ${order.order_status}</p>
                    <p>📍 Items: ${order.items || 'N/A'}</p>
                    <p>🏠 Shipping: ${order.shipping_address}</p>
                </div>
            `).join('')}
            <button onclick="showProducts()" style="margin-top:1rem; padding:0.75rem 1.5rem;">Continue Shopping</button>
        `;
    } catch (error) {
        document.getElementById('app').innerHTML = '<div class="loading">Error loading orders</div>';
    }
}

function showAuth() {
    let isLoginMode = true;

    const renderAuth = () => {
        document.getElementById('app').innerHTML = `
            <div class="auth-container">
                <h2 id="auth-title">${isLoginMode ? 'Login' : 'Register'}</h2>
                ${!isLoginMode ? '<input type="text" id="name-field" placeholder="Full Name">' : ''}
                <input type="email" id="email" placeholder="Email">
                <input type="password" id="password" placeholder="Password">
                <button onclick="handleAuth(${isLoginMode})">${isLoginMode ? 'Login' : 'Register'}</button>
                <div style="text-align:center; margin-top:1rem; color:#007bff; cursor:pointer;" onclick="toggleMode()">
                    ${isLoginMode ? "Don't have an account? Register" : 'Already have an account? Login'}
                </div>
            </div>
        `;
    };	
    
    window.toggleMode = () => {
        isLoginMode = !isLoginMode;
        renderAuth();
    };
    
    window.handleAuth = (loginMode) => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        if (loginMode) {
            login(email, password);
        } else {
            const name = document.getElementById('name-field').value;
            if (!name) {
                showMessage('Please enter your name', 'error');
                return;
            }
            register(name, email, password);
        }
    };
    
    renderAuth();
}

// Initialize app
updateAuthUI();
updateCartUI();
if (token) {
    showProducts();
} else {
    showAuth();
}

