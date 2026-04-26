require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2');

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json());

// Database connection
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    ssl: { rejectUnauthorized: false }
});

// CONNECT AND CREATE TABLES IF NOT EXISTS
db.connect((err) => {
    if (err) {
        console.error('Database connection failed:', err);
        process.exit(1);
    }
    console.log('✅ Connected to database:', process.env.DB_NAME);
    
    // Create orders table if not exists
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
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `;
    
    // Create order_items table if not exists
    const createOrderItemsTable = `
        CREATE TABLE IF NOT EXISTS order_items (
            id INT PRIMARY KEY AUTO_INCREMENT,
            order_id INT NOT NULL,
            product_id INT NOT NULL,
            quantity INT NOT NULL,
            price DECIMAL(10, 2) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
    `;
    
    // Execute table creation
    db.query(createOrdersTable, (err) => {
        if (err) {
            console.error('Error creating orders table:', err);
        } else {
            console.log('✅ Orders table verified/created');
            
            // Create order_items table
            db.query(createOrderItemsTable, (err) => {
                if (err) {
                    console.error('Error creating order_items table:', err);
                } else {
                    console.log('✅ Order_items table verified/created');
                }
            });
        }
    });
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server running' });
});

// Login endpoint
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    
    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, users) => {
        if (err) return res.status(500).json({ message: 'Database error' });
        if (users.length === 0) return res.status(401).json({ message: 'Invalid credentials' });
        
        const user = users[0];
        let valid = false;
        
        if (user.password && user.password.startsWith('$2')) {
            valid = await bcrypt.compare(password, user.password);
        } else {
            valid = (password === user.password);
        }
        
        if (!valid) return res.status(401).json({ message: 'Invalid credentials' });
        
        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.name },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({ message: 'Login successful', token, user: { id: user.id, name: user.name, email: user.email } });
    });
});

// Register endpoint
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'All fields required' });
    }
    
    db.query('SELECT id FROM users WHERE email = ?', [email], async (err, results) => {
        if (err) return res.status(500).json({ message: 'Database error' });
        if (results.length > 0) return res.status(400).json({ message: 'User already exists' });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.query('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name, email, hashedPassword], (err, result) => {
            if (err) return res.status(500).json({ message: 'Error creating user' });
            
            const token = jwt.sign({ id: result.insertId, email, name }, process.env.JWT_SECRET, { expiresIn: '24h' });
            res.status(201).json({ message: 'Registration successful', token, user: { id: result.insertId, name, email } });
        });
    });
});

// Get products
app.get('/api/products', (req, res) => {
    db.query('SELECT * FROM products ORDER BY id DESC', (err, products) => {
        if (err) {
            console.error('Products error:', err);
            return res.status(500).json({ message: 'Error fetching products' });
        }
        res.json(products || []);
    });
});

// CREATE ORDER - FIXED VERSION
app.post('/api/orders', authenticateToken, (req, res) => {
    console.log('📦 Creating order for user:', req.user.id);
    
    const { items, total, payment_method, shipping_address } = req.body;
    const userId = req.user.id;
    
    // Validation
    if (!items || items.length === 0) {
        return res.status(400).json({ message: 'Cart is empty' });
    }
    
    if (!payment_method) {
        return res.status(400).json({ message: 'Please select a payment method' });
    }
    
    if (!shipping_address || shipping_address.trim() === '') {
        return res.status(400).json({ message: 'Please provide shipping address' });
    }
    
    // Start transaction
    db.beginTransaction((err) => {
        if (err) {
            console.error('Transaction error:', err);
            return res.status(500).json({ message: 'Transaction error' });
        }
        
        // Insert order
        const orderQuery = `INSERT INTO orders (user_id, total_amount, payment_method, shipping_address, payment_status, order_status) VALUES (?, ?, ?, ?, 'completed', 'confirmed')`;
        
        db.query(orderQuery, [userId, total, payment_method, shipping_address], (err, orderResult) => {
            if (err) {
                console.error('Order insert error:', err);
                return db.rollback(() => {
                    res.status(500).json({ message: 'Error creating order: ' + err.message });
                });
            }
            
            const orderId = orderResult.insertId;
            console.log('Order ID created:', orderId);
            
            // Insert order items
            let completed = 0;
            let hasError = false;
            
            items.forEach((item) => {
                const itemQuery = `INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)`;
                
                db.query(itemQuery, [orderId, item.id, item.quantity, item.price], (err) => {
                    if (err) {
                        console.error('Order item error:', err);
                        hasError = true;
                        return db.rollback(() => {
                            res.status(500).json({ message: 'Error adding order items' });
                        });
                    }
                    
                    // Update stock
                    db.query('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [item.quantity, item.id, item.quantity], (err, updateResult) => {
                        if (err || updateResult.affectedRows === 0) {
                            console.error('Stock update error:', err);
                            hasError = true;
                            return db.rollback(() => {
                                res.status(500).json({ message: 'Insufficient stock for product' });
                            });
                        }
                        
                        completed++;
                        
                        if (completed === items.length && !hasError) {
                            db.commit((err) => {
                                if (err) {
                                    console.error('Commit error:', err);
                                    return db.rollback(() => {
                                        res.status(500).json({ message: 'Error finalizing order' });
                                    });
                                }
                                
                                console.log('✅ Order completed:', orderId);
                                res.json({
                                    success: true,
                                    message: 'Order placed successfully!',
                                    orderId: orderId,
                                    payment_method: payment_method,
                                    total: total
                                });
                            });
                        }
                    });
                });
            });
        });
    });
});

// Get user orders
app.get('/api/orders', authenticateToken, (req, res) => {
    const userId = req.user.id;
    
    const query = `
        SELECT o.*, 
               GROUP_CONCAT(CONCAT(oi.quantity, ' x ', p.name) SEPARATOR ', ') as items
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE o.user_id = ?
        GROUP BY o.id
        ORDER BY o.created_at DESC
    `;
    
    db.query(query, [userId], (err, orders) => {
        if (err) {
            console.error('Fetch orders error:', err);
            return res.status(500).json({ message: 'Error fetching orders' });
        }
        res.json(orders || []);
    });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

