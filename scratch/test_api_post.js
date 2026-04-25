// Test API directly via HTTP
const http = require('http');

const data = JSON.stringify({
    name: 'Menu Test HTTP',
    categoryId: 5,
    price: 15000,
    description: 'Test post without image'
});

const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/products',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        // We need a valid JWT token
    }
};

// I will skip this since I don't easily have a valid token
