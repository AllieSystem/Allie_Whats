const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

let qrCodeData = null;
let isConnected = false;
let connectionStatus = 'Desconectado';

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    qrCodeData = qr;
    connectionStatus = 'Esperando QR...';
    io.emit('qr', qr);
    io.emit('status', connectionStatus);
    console.log('QR Code generado. Escanea con tu WhatsApp.');
});

client.on('ready', () => {
    isConnected = true;
    qrCodeData = null;
    connectionStatus = 'Conectado';
    io.emit('ready');
    io.emit('status', connectionStatus);
    console.log('Cliente de WhatsApp listo!');
});

client.on('disconnected', () => {
    isConnected = false;
    connectionStatus = 'Desconectado';
    io.emit('disconnected');
    io.emit('status', connectionStatus);
    console.log('Cliente desconectado');
    client.destroy().then(() => client.initialize());
});

client.on('auth_failure', (msg) => {
    connectionStatus = 'Error de autenticación';
    io.emit('status', connectionStatus);
    console.error('Error de autenticación:', msg);
});

client.initialize();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/status', (req, res) => {
    res.json({
        isConnected,
        status: connectionStatus,
        hasQR: !!qrCodeData
    });
});

app.post('/api/send', async (req, res) => {
    const { phone, message } = req.body;

    if (!isConnected) {
        return res.status(400).json({ success: false, error: 'WhatsApp no está conectado' });
    }

    if (!phone || !message) {
        return res.status(400).json({ success: false, error: 'Número y mensaje son requeridos' });
    }

    try {
        const number = phone.replace(/[^0-9]/g, '');

        // Verificar si el número existe en WhatsApp y obtener el ID correcto
        const numberDetails = await client.getNumberId(number);

        if (!numberDetails) {
            return res.status(400).json({
                success: false,
                error: 'El número no está registrado en WhatsApp o es inválido'
            });
        }

        // Usar el ID obtenido de getNumberId
        await client.sendMessage(numberDetails._serialized, message);
        res.json({ success: true, message: 'Mensaje enviado correctamente' });
    } catch (error) {
        console.error('Error al enviar mensaje:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/logout', async (req, res) => {
    try {
        await client.logout();
        isConnected = false;
        qrCodeData = null;
        connectionStatus = 'Desconectado';
        io.emit('disconnected');
        io.emit('status', connectionStatus);
        res.json({ success: true, message: 'Sesión cerrada' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

io.on('connection', (socket) => {
    console.log('Cliente web conectado');
    socket.emit('status', connectionStatus);
    if (qrCodeData && !isConnected) {
        socket.emit('qr', qrCodeData);
    }
    if (isConnected) {
        socket.emit('ready');
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log('Inicializando cliente de WhatsApp...');
});
