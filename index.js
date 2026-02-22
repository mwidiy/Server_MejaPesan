require('dotenv').config(); // Load environment variables dari .env

// --- SECURITY CHECK ---
if (!process.env.JWT_SECRET) {
  console.error("FATAL ERROR: JWT_SECRET di file .env lu KOSONG BRO!");
  console.error("Server DIMATIKAN PAKSA demi keamanan Kasir lu.");
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const http = require('http'); // Import HTTP
const { Server } = require("socket.io"); // Import Socket.IO
const rateLimit = require('express-rate-limit'); // NEW: Import Rate Limiter

const productRoutes = require('./routes/productRoutes');
const bannerRoutes = require('./routes/bannerRoutes');

const app = express();
const server = http.createServer(app); // Bungkus app express dengan HTTP server
// Inisialisasi Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*", // Izinkan koneksi dari semua origin
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

const PORT = process.env.PORT || 3000;

// --- MIDDLEWARE ---
app.use((req, res, next) => {
  // Hanya nge-log kalau lagi masa development (Biar RAM server production enteng)
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[GLOBAL_LOG] ${req.method} ${req.url}`);
  }
  next();
});

// --- GLOBAL RATE LIMITER (ANTI DDOS & SPAM) ---
// Membatasi maksimal 300 request per 5 menit dari 1 IP
const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 menit
  max: 300, // Limit setiap IP maksimal 300 request per windowMs
  message: {
    success: false,
    message: "Terdeteksi aktivitas spam/DDoS. Anda diblokir sementara selama 5 Menit. Harap tunggu."
  },
  standardHeaders: true, // Kirim info limit di header (RateLimit-*)
  legacyHeaders: false, // Matikan header `X-RateLimit-*` lama
});

// Pasang Satpam (Limiter) HANYA untuk semua jalur API (bukan gambar/assets)
app.use('/api/', globalLimiter);

app.use(cors({
  // CORS Dinamis (Lebih Aman!)
  origin: function (origin, callback) {
    // 1. Kasir Android & Postman (Tanpa Origin) diizinkan karena pake perlindungan JWT
    if (!origin || origin === 'null') return callback(null, true);

    // 2. Baca daftar VIP dari .env (Bisa koma-dipisah kalau lebih dari 1)
    const allowedOrigins = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : [];

    // 3. Tambahkan Localhost otomatis buat testing Lokal lu
    allowedOrigins.push('http://localhost:3000');
    allowedOrigins.push('https://quacxel.my.id');
    allowedOrigins.push('https://www.quacxel.my.id');

    // 4. Cek apakah KTP (Origin) tamu ada di daftar VIP
    if (allowedOrigins.includes(origin)) {
      return callback(null, true); // Masuk!
    }

    // 5. Tendang web jahat
    console.error(`[BLOCKED_BY_CORS] Website asing mencoba akses: ${origin}`);
    return callback(new Error('Akses Ditolak Server (Tidak Sah)'), false);
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

// PRIORITAS 4: Batasi ukuran teks JSON dari 50MB jadi 2MB (Anti Payload Bomb)
// Ingat: Upload Image & AR (.glb) tetap aman karena diproses terpisah oleh Multer!
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));

// DEBUG: Ultimate Serving with res.sendFile
app.use('/ar-assets', (req, res, next) => {
  const requestPath = decodeURIComponent(req.path);
  const cleanRequestPath = requestPath.replace(/^\//, '');
  const filePath = require('path').join(__dirname, 'public', 'ar-assets', cleanRequestPath);

  console.log(`[AR_DEBUG] ${req.method} Request: '${req.originalUrl}'`);
  console.log(`[AR_DEBUG] Target Path: '${filePath}'`);

  // Handle CORS Preflight explicitly for this route
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (require('fs').existsSync(filePath)) {
    // Check if it's a file
    if (require('fs').statSync(filePath).isDirectory()) {
      console.log(`[AR_DEBUG] REJECT: It is a directory.`);
      return res.status(404).send('Not a file');
    }

    // EXPLICIT MIME TYPES (Critical for Mobile/Model-Viewer)
    if (filePath.endsWith('.glb')) {
      res.setHeader('Content-Type', 'model/gltf-binary');
    } else if (filePath.endsWith('.gltf')) {
      res.setHeader('Content-Type', 'model/gltf+json');
    }
    // Disable Cache for debugging to prevent stale 404s
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    console.log(`[AR_DEBUG] Sending File via res.sendFile...`);
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error(`[AR_DEBUG] SendFile Error:`, err);
        if (!res.headersSent) res.status(404).send('Failed to send file');
      } else {
        console.log(`[AR_DEBUG] Success: File sent to client.`);
      }
    });
  } else {
    console.log(`[AR_DEBUG] 404 Not Found (Disk Check Failed)`);
    res.status(404).send('File not found');
  }
});

// --- STATIC SERVING (MUST BE AFTER CUSTOM AR LOGIC) ---
app.use(express.static('public'));
app.use('/uploads', express.static('public/images'));

// Middleware agar io bisa dipakai di controller
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Log ketika ada client connect
io.on('connection', (socket) => {
  console.log(`⚡ Client connected: ${socket.id}`);

  // Client (PWA/Android) join specific Store Room
  socket.on('join_store', (storeId) => {
    if (storeId) {
      const roomName = `store_${storeId}`;
      socket.join(roomName);
      console.log(`🔌 Socket ${socket.id} joined room: ${roomName}`);
    }
  });

  // NEW: Client join specific Transaction Room (for private updates like Payment)
  socket.on('join_room', (roomName) => {
    if (roomName) {
      socket.join(roomName);
      console.log(`🔌 Socket ${socket.id} joined room: ${roomName}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// --- IGNORE FAVICON (Stop 404 noise) ---
app.get('/favicon.ico', (req, res) => res.status(204).end());

// --- ROUTE UTAMA (CEK SERVER) ---
app.get('/', (req, res) => {
  res.send('Server Backend Kasir Siap! 🚀 Silakan akses /api/products');
});

// --- API ROUTES ---
app.use('/api/products', productRoutes);
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/locations', require('./routes/locationRoutes'));
app.use('/api/tables', require('./routes/tableRoutes'));
app.use('/api/banners', bannerRoutes);
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/ar', require('./routes/arRoutes'));
app.use('/api/store', require('./routes/storeRoutes'));
app.use('/api/auth', require('./routes/authRoutes')); // NEW: Google Login Route
app.use('/api/payment', require('./routes/paymentRoutes')); // Duitku Payment
app.use('/api/withdraw', require('./routes/withdrawalRoutes')); // NEW: Withdrawal

// --- PRIORITAS 5: GLOBAL ERROR HANDLER (PENUTUP AIB) ---
// Middleware ini ditaruh PALING BAWAH setelah semua Route.
// Tugasnya nangkep semua error (biar server ngga crash) dan nyembunyiin Traceback dari Hacker.
app.use((err, req, res, next) => {
  console.error(`[CRITICAL_ERROR] ${err.message}`);

  if (process.env.NODE_ENV === 'production') {
    // Mode Production: Kasih pesan general/sopan
    res.status(500).json({
      success: false,
      message: "Terjadi kesalahan sistem internal. Tim IT sedang menanganinya."
    });
  } else {
    // Mode Lokal: Boleh kasih liat error aslinya buat programmer
    res.status(500).json({
      success: false,
      message: err.message,
      stack: err.stack
    });
  }
});

// --- MENJALANKAN SERVER ---
// Ganti app.listen jadi server.listen
// --- SERVER LISTEN WITH AUTO-RECOVERY ---
const startServer = () => {
  const runningServer = server.listen(PORT, () => {
    console.log(`✅ Server berjalan di http://localhost:${PORT}`);
  });

  runningServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️  Port ${PORT} is in use. Attempting to kill occupying process...`);

      const { exec } = require('child_process');
      // Find and kill process occupying the port
      exec(`netstat -ano | findstr :${PORT}`, (error, stdout) => {
        if (stdout) {
          const lines = stdout.trim().split('\n');
          // Extract PIDs (last token in line)
          const pids = lines.map(l => l.trim().split(/\s+/).pop()).filter(pid => pid && pid !== '0');

          if (pids.length > 0) {
            const uniquePids = [...new Set(pids)];
            console.log(`🔫 Killing PIDs: ${uniquePids.join(', ')}`);

            uniquePids.forEach(pid => {
              exec(`taskkill /F /PID ${pid}`, (err) => {
                if (err) console.error(`   Failed to kill ${pid}: ${err.message}`);
                else console.log(`   Killed ${pid}`);
              });
            });

            // Retry after a short delay
            setTimeout(() => {
              console.log('🔄 Retrying server start...');
              runningServer.close(); // Ensure handle is closed
              startServer(); // Recursive retry
            }, 1000);
          } else {
            console.error(`❌ Port ${PORT} is in use but no PID found.`);
            process.exit(1);
          }
        } else {
          console.error(`❌ Port ${PORT} is in use but netstat returned empty.`);
          process.exit(1);
        }
      });
    } else {
      console.error('❌ Server Error:', err);
      process.exit(1);
    }
  });

  return runningServer;
};

const activeServer = startServer();

// --- GRACEFUL SHUTDOWN ---
const gracefulShutdown = () => {
  console.log('Received kill signal, shutting down gracefully');
  runningServer.close(() => {
    console.log('Closed out remaining connections');
    process.exit(0);
  });

  // Force close after 10s
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);