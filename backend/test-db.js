const db = require('./db');
require('dotenv').config();

async function testConnection() {
    try {
        const [result] = await db.query('SELECT 1 as test');
        console.log('✅ Database connected successfully!');
        
        const [tables] = await db.query('SHOW TABLES');
        console.log('📊 Tables in database:', tables.map(t => Object.values(t)[0]));
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        process.exit(1);
    }
}

testConnection();
EOF
