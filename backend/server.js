const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// ============ SETUP ENDPOINTS ============

app.post('/api/setup/create-tables', async (req, res) => {
    try {
        const createOrdersTable = `
            CREATE TABLE IF NOT EXISTS orders (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                total_amount DECIMAL(10, 2) NOT NULL,
                payment_method VARCHAR(50) NOT NULL,
                payment_status VARCHAR(50) DEFAULT 'completed',
                order_status VARCHAR(50) DEFAULT 'confirmed',
                shipping_address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `;
        
        const createOrderItemsTable = `
            CREATE TABLE IF NOT EXISTS order_items (
                id INT PRIMARY KEY AUTO_INCREMENT,
                order_id INT NOT NULL,
                product_id INT NOT NULL,
                quantity INT NOT NULL,
                price DECIMAL(10, 2) NOT NULL,
                FOREIGN KEY (order_id) REFERENCES orders(id),
                FOREIGN KEY (product_id) REFERENCES products(id)
            )
        `;
        
        await db.query(createOrdersTable);
        await db.query(createOrderItemsTable);
        
        res.json({ message: 'Tables created successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ HEALTH CHECK ============

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running', database: process.env.DB_NAME });
});

// ============ AUTH ENDPOINTS ============

app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'All fields are required' });
    }
    
    try {
        const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ message: 'User already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.query(
            'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
            [name, email, hashedPassword]
        );
        
        const token = jwt.sign(
            { id: result.insertId, email, name },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: { id: result.insertId, name, email }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password required' });
    }
    
    try {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        
        if (users.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        
        const user = users[0];
        
        let valid = false;
        if (user.password && (user.password.startsWith('$2a$') || user.password.startsWith('$2b$'))) {
            valid = await bcrypt.compare(password, user.password);
        } else {
            valid = (password === user.password);
        }
        
        if (!valid) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.name },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            message: 'Login successful',
            token,
            user: { id: user.id, name: user.name, email: user.email }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// ============ PRODUCT ENDPOINTS ============

app.get('/api/products', async (req, res) => {
    try {
        const [products] = await db.query('SELECT * FROM products ORDER BY id DESC');
        res.json(products);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching products' });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const [products] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
        if (products.length === 0) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json(products[0]);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching product' });
    }
});

// ============ ORDER ENDPOINTS ============

app.post('/api/orders', authenticateToken, async (req, res) => {
    const { items, total, payment_method, shipping_address } = req.body;
    const userId = req.user.id;
    
    if (!items || items.length === 0) {
        return res.status(400).json({ message: 'Cart is empty' });
    }
    
    if (!payment_method) {
        return res.status(400).json({ message: 'Please select a payment method' });
    }
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    
    try {
        const [orderResult] = await connection.query(
            'INSERT INTO orders (user_id, total_amount, payment_method, shipping_address) VALUES (?, ?, ?, ?)',
            [userId, total, payment_method, shipping_address]
        );
        
        const orderId = orderResult.insertId;
        
        for (const item of items) {
            await connection.query(
                'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
                [orderId, item.id, item.quantity, item.price]
            );
            
            await connection.query(
                'UPDATE products SET stock = stock - ? WHERE id = ?',
                [item.quantity, item.id]
            );
        }
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Order placed successfully!',
            orderId: orderId,
            payment_method: payment_method
        });
    } catch (error) {
        await connection.rollback();
        console.error('Order error:', error);
        res.status(500).json({ message: 'Error processing order' });
    } finally {
        connection.release();
    }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    
    try {
        const query = `
            SELECT o.*, 
                   GROUP_CONCAT(CONCAT(oi.quantity, 'x ', p.name) SEPARATOR ', ') as items
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE o.user_id = ?
            GROUP BY o.id
            ORDER BY o.created_at DESC
        `;
        
        const [orders] = await db.query(query, [userId]);
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching orders' });
    }
});

// ============ START SERVER ============

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Backend server running on port ${PORT}`);
    console.log(`📊 Database: ${process.env.DB_NAME}`);
    console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
});
EOF


