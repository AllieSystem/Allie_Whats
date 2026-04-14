import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage, extensionForMediaMessage } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import multer from 'multer';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// Configuración de multer para uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = crypto.randomBytes(8).toString('hex');
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(uploadDir));

const io = new Server(server);

let sock = null;
let connectionStatus = 'Desconectado';
let qrCodeData = null;
let pairingCode = null;
let pairingPhone = '525556614579';

const chats = new Map();
const jidToPhone = new Map();  // Mapa de JID -> número de teléfono para vincular conversaciones

// Función helper para normalizar números de teléfono
const normalizePhone = (p) => p?.replace(/\D/g, '') || p;

async function initBaileys() {
    const authDir = path.join(__dirname, 'auth');
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'debug' }),
        connectTimeoutMs: 60000,
        keepaliveIntervalMs: 30000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeData = qr;
            connectionStatus = 'Esperando código...';
            io.emit('status', connectionStatus);
            console.log('\n📱 Escanea el código QR con tu WhatsApp o usa el código de emparejamiento');
        }

        if (connection === 'close') {
            const boomError = new Boom(lastDisconnect?.error);
            const reason = boomError?.data?.DISCONNECT_REASON || lastDisconnect?.error?.message;
            const statusCode = boomError?.output?.statusCode;
            console.log('Conexión cerrada:', reason, 'Código:', statusCode);

            // Código 515 = restart required después del emparejamiento (normal)
            if (statusCode === 515 || reason?.includes('restart required')) {
                console.log('🔄 Reinicio requerido después del emparejamiento, reconectando...');
                setTimeout(() => initBaileys(), 2000);
            } else if (statusCode === 401 || reason === 'BadSession' || reason === 'invalid_mechanisms') {
                console.log('🔄 Restaurando sesión...');
                try {
                    await sock.logout();
                } catch (e) {}
                fs.rmSync(authDir, { recursive: true, force: true });
                fs.mkdirSync(authDir, { recursive: true });
                setTimeout(() => initBaileys(), 2000);
            } else {
                connectionStatus = 'Desconectado';
                io.emit('disconnected');
                io.emit('status', connectionStatus);
            }
        } else if (connection === 'open') {
            qrCodeData = null;
            pairingCode = null;
            connectionStatus = 'Conectado';
            io.emit('ready');
            io.emit('status', connectionStatus);
            console.log('✅ Conectado a WhatsApp!');
            
            setTimeout(async () => {
                try {
                    if (sock.chats) {
                        const chatKeys = await sock.chats.keys();
                        console.log(`📋 Chats cargados: ${chatKeys.length}`);
                        for (const jid of chatKeys) {
                            const phone = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
                            if (!chats.has(phone)) {
                                chats.set(phone, {
                                    phone,
                                    name: phone,
                                    messages: [],
                                    lastMessage: null,
                                    timestamp: Date.now()
                                });
                            }
                        }
                        io.emit('chats_loaded', { count: chats.size });
                    }
                } catch (e) {
                    console.log('Error cargando chats:', e.message);
                }
            }, 3000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        console.log(`Messages upsert: ${messages.length}, type: ${type}`);

        for (const msg of messages) {
            if (!msg.message) continue;

            const jid = msg.key.remoteJid;
            const jidClean = jid.split('@')[0];

            // IMPORTANTE: Usar senderPn si está disponible (contiene el número real del remitente)
            // Esto es crucial para mensajes que vienen de JIDs @lid
            let senderPhone = null;
            if (msg.key.senderPn) {
                senderPhone = msg.key.senderPn.split('@')[0];
                console.log(`   📱 Número real del remitente (senderPn): ${senderPhone}`);
            }

            const msgObj = msg.message;
            let text = '';
            let mediaType = null;
            let mediaThumbnail = null;
            let mediaUrl = null;
            let mediaMimeType = null;
            let mediaFileName = null;
            let mediaKey = null;
            let mediaDirectPath = null;
            let mediaFileLength = null;

    if (msgObj.conversation) {
        text = msgObj.conversation;
    } else if (msgObj.extendedTextMessage) {
        text = msgObj.extendedTextMessage.text;
    } else if (msgObj.imageMessage) {
        let caption = msgObj.imageMessage.caption;
        if (caption) {
            try { caption = Buffer.from(caption, 'latin1').toString('utf8'); } catch (e) {}
        }
        text = caption || '[Imagen]';
        mediaType = 'image';
        mediaMimeType = msgObj.imageMessage.mimetype;
        mediaUrl = msgObj.imageMessage.url;
        mediaKey = msgObj.imageMessage.mediaKey;
        mediaDirectPath = msgObj.imageMessage.directPath;
        mediaFileLength = msgObj.imageMessage.fileLength;
        if (msgObj.imageMessage.jpegThumbnail) {
            mediaThumbnail = Buffer.from(msgObj.imageMessage.jpegThumbnail).toString('base64');
        }
        
        if (!mediaFileName) {
            const ext = mediaMimeType?.split('/')[1] || 'jpg';
            mediaFileName = `image-${Date.now()}.${ext}`;
        }
    } else if (msgObj.videoMessage) {
        let caption = msgObj.videoMessage.caption;
        if (caption) {
            try { caption = Buffer.from(caption, 'latin1').toString('utf8'); } catch (e) {}
        }
        text = caption || '[Video]';
        mediaType = 'video';
        mediaMimeType = msgObj.videoMessage.mimetype;
        mediaUrl = msgObj.videoMessage.url;
        mediaKey = msgObj.videoMessage.mediaKey;
        mediaDirectPath = msgObj.videoMessage.directPath;
        mediaFileLength = msgObj.videoMessage.fileLength;
        if (msgObj.videoMessage.jpegThumbnail) {
            mediaThumbnail = Buffer.from(msgObj.videoMessage.jpegThumbnail).toString('base64');
        }
        
        if (!mediaFileName) {
            const ext = mediaMimeType?.split('/')[1] || 'mp4';
            mediaFileName = `video-${Date.now()}.${ext}`;
        }
    } else if (msgObj.documentMessage) {
        let docCaption = msgObj.documentMessage.caption;
        let fileName = msgObj.documentMessage.fileName || msgObj.documentMessage.fileName;
        
        if (!fileName && msgObj.documentMessage) {
            console.log('   📄 DocMessage keys:', Object.keys(msgObj.documentMessage));
        }
        
        function fixEncoding(str) {
            if (!str) return str;
            const original = str;
            try {
                const latin1 = Buffer.from(str, 'latin1').toString('utf8');
                
                const validAccents = ['á','é','í','ó','ú','ñ','Á','É','Í','Ó','Ú','Ñ','ü','Ü','¿','¡','€'];
                const hasValidAccents = latin1.split('').some(c => validAccents.includes(c));
                const hasInvalidChars = latin1.includes('�');
                
                if (hasInvalidChars) return original;
                if (hasValidAccents) return latin1;
                
                return original;
            } catch (e) { return original; }
        }
        
        if (docCaption) docCaption = fixEncoding(docCaption);
        if (fileName) fileName = fixEncoding(fileName);
        
        console.log('   📎 Nombre archivo:', fileName, typeof fileName);
        
        text = docCaption || fileName || '[Documento]';
        mediaType = 'document';
        mediaMimeType = msgObj.documentMessage.mimetype;
        mediaFileName = fileName;
        mediaUrl = msgObj.documentMessage.url;
        mediaKey = msgObj.documentMessage.mediaKey;
        mediaDirectPath = msgObj.documentMessage.directPath;
        mediaFileLength = msgObj.documentMessage.fileLength;
        
        if (!mediaFileName) {
            const ext = mediaMimeType?.split('/')[1] || 'bin';
            mediaFileName = `document-${Date.now()}.${ext}`;
        }
    } else if (msgObj.audioMessage) {
        text = '[Audio]';
        mediaType = 'audio';
        mediaMimeType = msgObj.audioMessage.mimetype;
        mediaUrl = msgObj.audioMessage.url;
        mediaKey = msgObj.audioMessage.mediaKey;
        mediaDirectPath = msgObj.audioMessage.directPath;
        mediaFileLength = msgObj.audioMessage.fileLength;
        
        console.log('   🎤 Audio message received:', { mediaUrl, mediaKey, mediaDirectPath, mediaMimeType });
        
        if (!mediaFileName) {
            // Limpiar el mimetype para obtener solo la extensión
            let ext = mediaMimeType?.split(';')[0]?.split('/')[1] || 'ogg';
            mediaFileName = `audio-${Date.now()}.${ext}`;
        }
    }

    if (!text) text = JSON.stringify(msgObj).substring(0, 30);

            console.log(`📨 Mensaje ${msg.key.fromMe ? 'saliente' : 'entrante'} - JID: ${jid} -> jidClean: ${jidClean}`);
            console.log(`   📝 Tipo de mensaje:`, Object.keys(msgObj));
            console.log(`   🎭 mediaType: ${mediaType}, text: ${text}, mediaFileName: ${mediaFileName}, mediaUrl: ${mediaUrl ? 'YES' : 'NO'}`);
            console.log(`   Mapeo actual:`, Array.from(jidToPhone.entries()));

            // Buscar el chat correcto
            let chatKey = jidClean;

            // Para mensajes entrantes, usar senderPn si está disponible
            if (!msg.key.fromMe && senderPhone) {
                const normalizedSender = normalizePhone(senderPhone);
                
                // Primero buscar en el mapa existente
                for (const [phone, mappedJid] of jidToPhone.entries()) {
                    const normalizedPhone = normalizePhone(phone);
                    const normalizedMappedJid = normalizePhone(mappedJid);
                    
                    if (normalizedPhone === normalizedSender || normalizedMappedJid === normalizedSender) {
                        chatKey = phone;
                        console.log(`   ✅ Usando senderPn mapeado: ${senderPhone} -> ${phone}`);
                        break;
                    }
                }
                
                // Si no encontramos mapeo, usar el senderPhone directamente
                if (chatKey === jidClean) {
                    chatKey = senderPhone;
                    console.log(`   ✅ Usando senderPn directo: ${senderPhone}`);
                }
            } else {
                // Para mensajes salientes o sin senderPn
                const normalizedJidClean = normalizePhone(jidClean);
                
                for (const [phone, mappedJid] of jidToPhone.entries()) {
                    const normalizedPhone = normalizePhone(phone);
                    const normalizedMappedJid = normalizePhone(mappedJid);
                    
                    console.log(`   Comparando: normalizedMappedJid='${normalizedMappedJid}' vs normalizedJidClean='${normalizedJidClean}' vs phone='${normalizedPhone}'`);
                    
                    if (normalizedMappedJid === normalizedJidClean || normalizedMappedJid === normalizePhone(jid) || normalizedPhone === normalizedJidClean) {
                        chatKey = phone;
                        console.log(`   ✅ Encontrado mapeo: ${phone} -> ${jidClean}`);
                        break;
                    }
                }
            }

            // Fallback: si chatKey sigue siendo el JID limpio original (no se encontró mapeo),
            // buscar si hay algún chat existente que coincida con el número
            if (chatKey === jidClean && senderPhone) {
                const normalizedSender = normalizePhone(senderPhone);
                for (const [existingPhone, chat] of chats.entries()) {
                    if (normalizePhone(existingPhone) === normalizedSender) {
                        chatKey = existingPhone;
                        console.log(`   ✅ Encontrado en chats existentes: ${existingPhone}`);
                        break;
                    }
                }
            }

            if (!chats.has(chatKey)) {
                chats.set(chatKey, { phone: chatKey, name: chatKey, messages: [], lastMessage: null, timestamp: Date.now() });
            }

            const chat = chats.get(chatKey);

            // Evitar duplicados: verificar si el mensaje ya existe por ID
            const existingMsg = chat.messages.find(m => m.id === msg.key.id);
            if (existingMsg) {
                console.log(`   ⚠️ Mensaje ya existe, saltando duplicado: ${msg.key.id}`);
                continue;
            }

            const msgData = {
                id: msg.key.id,
                text: text,
                timestamp: msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now(),
                isOutgoing: msg.key.fromMe,
                jid: jid,
                senderPhone: senderPhone,
                mediaType: mediaType,
                mediaThumbnail: mediaThumbnail,
                mediaMimeType: mediaMimeType,
                mediaFileName: mediaFileName,
                mediaUrl: mediaUrl,
                mediaKey: mediaKey,
                mediaDirectPath: mediaDirectPath,
                mediaFileLength: mediaFileLength
            };
            chat.messages.push(msgData);
            chat.lastMessage = msgData;
            chat.timestamp = Date.now();

            // Guardar mapeo bidireccional para futuras respuestas
            const normalizedChatKey = normalizePhone(chatKey);
            const normalizedJidClean = normalizePhone(jidClean);
            
            if (msg.key.fromMe) {
                // Mensaje saliente: guardar el JID del destinatario
                jidToPhone.set(chatKey, jidClean);
                // También guardar versión normalizada
                jidToPhone.set(normalizedChatKey, normalizedJidClean);
            } else if (senderPhone) {
                // Mensaje entrante: guardar el mapeo del número del remitente -> JID
                jidToPhone.set(senderPhone, jidClean);
                const normalizedSender = normalizePhone(senderPhone);
                jidToPhone.set(normalizedSender, normalizedJidClean);
            } else if (jid) {
                // Fallback: usar el JID limpio directamente
                jidToPhone.set(jidClean, jidClean);
            }

            io.emit('new_message', { phone: chatKey, message: msgData, chat });

            console.log(`📤 Emitiendo new_message con phone: ${chatKey} (original: ${senderPhone || jidClean})`);
            
            // También buscar si hay algún chat existente que coincida con el teléfono normalizado
            const chatKeyNormalized = normalizePhone(chatKey);
            let foundChatKey = null;
            
            for (const [existingPhone] of chats.entries()) {
                if (normalizePhone(existingPhone) === chatKeyNormalized) {
                    foundChatKey = existingPhone;
                    break;
                }
            }
            
            // Si encontramos un chat existente con número diferente, también emitir con ese número
            if (foundChatKey && foundChatKey !== chatKey) {
                console.log(`   📱 Emitiendo también para chat existente: ${foundChatKey}`);
                io.emit('new_message', { phone: foundChatKey, message: msgData, chat: chats.get(foundChatKey) });
            }

            if (!msg.key.fromMe) {
                console.log(`📩 Mensaje de ${chatKey}: ${text.substring(0, 30)}`);
            } else {
                console.log(`✅ Mensaje enviado a ${chatKey}: ${text.substring(0, 30)}`);
            }
        }
    });

    // Handle history sync
    sock.ev.on('messaging-history.set', ({ chats: newChats, messages: newMessages }) => {
        console.log(`📥 Historial recibido: ${newChats?.length || 0} chats, ${newMessages?.length || 0} mensajes`);

        // Process chats from history
        for (const chat of newChats || []) {
            const jid = chat.id?._serialized || chat.id;
            if (!jid) continue;

            const phone = jid.split('@')[0];  // Limpiar cualquier sufijo (@s.whatsapp.net, @g.us, @lid, etc.)
            if (!phone) continue;

            if (!chats.has(phone)) {
                chats.set(phone, {
                    phone,
                    name: chat.displayName || chat.name || phone,
                    messages: [],
                    lastMessage: null,
                    timestamp: chat.lastMessageRecv ? chat.lastMessageRecv * 1000 : Date.now()
                });
            }
        }

        // Process messages from history
        for (const msg of newMessages || []) {
            const jid = msg.key?.remoteJid;
            if (!jid || !msg.message) continue;

            const phone = jid.split('@')[0];  // Limpiar cualquier sufijo
            if (!phone) continue;

            const msgObj = msg.message;
            let text = '';
            if (msgObj.conversation) text = msgObj.conversation;
            else if (msgObj.extendedTextMessage) text = msgObj.extendedTextMessage.text;
            else if (msgObj.imageMessage) text = msgObj.imageMessage.caption || '';
            else if (msgObj.videoMessage) text = msgObj.videoMessage.caption || '';

            if (!text) continue;

            if (!chats.has(phone)) {
                chats.set(phone, { phone, name: phone, messages: [], lastMessage: null, timestamp: Date.now() });
            }

            const chat = chats.get(phone);
            const msgData = {
                id: msg.key.id,
                text: text,
                timestamp: msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now(),
                isOutgoing: msg.key.fromMe
            };
            chat.messages.push(msgData);
            chat.lastMessage = msgData;
        }

        console.log(`✅ Chats cargados en memoria: ${chats.size}`);
        io.emit('chats_loaded', { count: chats.size });
    });

    // Monitorear estado de entrega de mensajes
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Este evento ya está manejado arriba, pero aquí podemos ver estados adicionales
        for (const msg of messages) {
            if (msg.key.fromMe && msg.status !== undefined) {
                const statusMap = {
                    0: 'ERROR',
                    1: 'PENDING',
                    2: 'SERVER_ACK',
                    3: 'DELIVERY_ACK',
                    4: 'READ'
                };
                const statusName = statusMap[msg.status] || `UNKNOWN(${msg.status})`;
                const jid = msg.key.remoteJid;
                const phone = jid?.replace('@s.whatsapp.net', '').replace('@g.us', '');
                console.log(`📊 Estado del mensaje a ${phone}: ${statusName}`);
            }
        }
    });

    // Escuchar actualizaciones de estado de mensajes
    sock.ev.on('message-receipt.update', (updates) => {
        for (const { key, receipt } of updates || []) {
            const statusMap = {
                'ERROR': '❌ Error',
                'PENDING': '⏳ Pendiente',
                'SERVER_ACK': '📤 En servidor',
                'DELIVERY_ACK': '✅ Entregado',
                'READ': '👁️ Leído'
            };
            const jid = key?.remoteJid;
            const phone = jid?.replace('@s.whatsapp.net', '').replace('@g.us', '');
            const status = statusMap[receipt?.status] || receipt?.status;
            console.log(`📊 Estado actualizado para mensaje a ${phone}: ${status}`);
        }
    });

    console.log('🔄 Inicializando Baileys...');
}

async function requestPairing() {
    if (!sock) {
        throw new Error('Socket no inicializado');
    }

    try {
        const code = await sock.requestPairingCode(pairingPhone);
        pairingCode = code;
        connectionStatus = 'Esperando emparejamiento...';
        io.emit('status', connectionStatus);
        io.emit('pairing_code', { code, phone: pairingPhone });
        console.log(`🔗 Código de emparejamiento para ${pairingPhone}: ${code}`);
        console.log('📱 Abre WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo');
        console.log(`   Ingresa el código: ${code}`);
        return code;
    } catch (error) {
        console.error('Error al solicitar código:', error.message);
        throw error;
    }
}

function phoneToJid(phone) {
    let cleanPhone = phone.replace(/[^0-9]/g, '');

    // Para México (52): si el número empieza con 52 y tiene 12 dígitos,
    // puede necesitar un "1" después del 52 para móviles
    // Ejemplo: 525535000761 -> 5215535000761 (si es móvil)
    if (cleanPhone.startsWith('52') && cleanPhone.length === 12) {
        // Verificar si es un número móvil mexicano (empieza con 55, 33, 81, etc.)
        const areaCode = cleanPhone.substring(2, 4);
        const mobileCodes = ['55', '33', '81', '22', '44', '47', '56', '58', '59', '61', '62', '64', '65', '66', '67', '71', '72', '73', '74', '75', '76', '77', '78', '79', '82', '83', '84', '86', '87', '88', '89', '91', '92', '93', '94', '95', '96', '97', '98', '99'];

        if (mobileCodes.includes(areaCode)) {
            const formattedPhone = '521' + cleanPhone.substring(2);
            console.log(`📱 Número mexicano detectado. Formateando: ${cleanPhone} -> ${formattedPhone}`);
            cleanPhone = formattedPhone;
        }
    }

    return cleanPhone + '@s.whatsapp.net';
}

// Rutas API
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/status', (req, res) => {
    res.json({
        isConnected: connectionStatus === 'Conectado',
        status: connectionStatus,
        hasQR: !!qrCodeData,
        hasPairing: !!pairingCode,
        phone: pairingPhone
    });
});

app.post('/api/download-media', async (req, res) => {
    try {
        const { messageId } = req.body;
        
        if (!messageId) {
            return res.status(400).json({ success: false, error: 'Se requiere messageId' });
        }

        let message = null;
        for (const [phone, chat] of chats.entries()) {
            const found = chat.messages.find(m => m.id === messageId);
            if (found) {
                message = found;
                break;
            }
        }

        if (!message) {
            return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
        }

        if (!message.mediaType) {
            return res.status(400).json({ success: false, error: 'El mensaje no tiene medios' });
        }

        console.log('   ⬇️ Descarga - mediaFileName:', message.mediaFileName);

        const mediaMessageTypes = {
            'image': 'imageMessage',
            'video': 'videoMessage', 
            'audio': 'audioMessage',
            'document': 'documentMessage',
            'sticker': 'stickerMessage'
        };

        const msgKeyType = mediaMessageTypes[message.mediaType];
        
        const mockMessage = {
            key: { id: message.id },
            message: {
                [msgKeyType]: {
                    url: message.mediaUrl,
                    mediaKey: message.mediaKey,
                    directPath: message.mediaDirectPath,
                    mimetype: message.mediaMimeType,
                    fileLength: message.mediaFileLength,
                    fileName: message.mediaFileName
                }
            }
        };

try {
            const buffer = await downloadMediaMessage(mockMessage, 'buffer', {});
            const ext = extensionForMediaMessage(mockMessage.message);
            let fileName = message.mediaFileName || `media-${message.id}.${ext}`;
            
            const safeFileName = fileName.replace(/"/g, '""');

            res.setHeader('Content-Type', `${message.mediaMimeType || 'application/octet-stream'}; charset=utf-8`);
            res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"; filename*=utf-8''${encodeURIComponent(fileName)}`);
            res.send(buffer);
        } catch (downloadError) {
            console.error('❌ Error en descarga de media:', downloadError.message);
            
            if (message.mediaDirectPath) {
                try {
                    const { downloadContentFromMessage, getMediaKeys } = await import('@whiskeysockets/baileys');
                    const keys = await getMediaKeys(message.mediaKey, message.mediaType);
                    const mediaUrl = `https://mmg.whatsapp.net${message.mediaDirectPath}`;
                    const buffer = await downloadContentFromMessage(
                        { mediaKey: message.mediaKey, directPath: message.mediaDirectPath },
                        message.mediaType,
                        {}
                    );
                    
                    const ext = extensionForMediaMessage(mockMessage.message);
                    let fileName = message.mediaFileName || `media-${message.id}.${ext}`;
                    
                    const safeFileName = fileName.replace(/"/g, '""');
                    
                    res.setHeader('Content-Type', `${message.mediaMimeType || 'application/octet-stream'}; charset=utf-8`);
                    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"; filename*=utf-8''${encodeURIComponent(fileName)}`);
                    res.send(Buffer.from(buffer));
                    return;
                } catch (retryError) {
                    console.error('❌ Error en retry:', retryError.message);
                }
            }
            
            throw downloadError;
        }

    } catch (error) {
        console.error('❌ Error descargando media:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/pairing', async (req, res) => {
    try {
        const phone = req.body.phone || pairingPhone;
        pairingPhone = phone;
        const code = await requestPairing();
        res.json({ success: true, code, phone });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/chats', (req, res) => {
    const chatList = Array.from(chats.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .map(chat => ({
            phone: chat.phone,
            name: chat.name,
            lastMessage: chat.lastMessage,
            messageCount: chat.messages.length
        }));
    res.json(chatList);
});

app.get('/api/chats/:phone/messages', (req, res) => {
    const requestedPhone = req.params.phone.replace(/[^0-9]/g, '');
    
    // Buscar chat con comparación normalizada
    let chat = null;
    for (const [phone, c] of chats.entries()) {
        if (normalizePhone(phone) === requestedPhone || normalizePhone(c.phone) === requestedPhone) {
            chat = c;
            break;
        }
    }

    if (!chat) {
        return res.json({ phone: requestedPhone, name: requestedPhone, messages: [] });
    }

    res.json({
        phone: chat.phone,
        name: chat.name,
        messages: chat.messages
    });
});

// Verificar si un número tiene WhatsApp
app.get('/api/check/:phone', async (req, res) => {
    const phone = req.params.phone.replace(/[^0-9]/g, '');

    if (connectionStatus !== 'Conectado') {
        return res.status(400).json({ success: false, error: 'WhatsApp no está conectado' });
    }

    try {
        const jid = phoneToJid(phone);
        console.log(`🔍 Verificando si ${jid} tiene WhatsApp...`);

        // Intentar obtener el perfil del usuario
        const result = await sock.onWhatsApp(jid);
        console.log(`🔍 Resultado onWhatsApp:`, JSON.stringify(result));

        if (result && result.length > 0 && result[0]) {
            console.log(`✅ Número ${phone} TIENE WhatsApp:`, result[0]);
            res.json({
                success: true,
                exists: true,
                jid: result[0].jid,
                phone: phone
            });
        } else {
            console.log(`❌ Número ${phone} NO tiene WhatsApp`);
            res.json({
                success: true,
                exists: false,
                phone: phone,
                message: 'Este número no está registrado en WhatsApp'
            });
        }
    } catch (error) {
        console.error('❌ Error verificando número:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/send', async (req, res) => {
    const { phone, message } = req.body;

    if (connectionStatus !== 'Conectado') {
        return res.status(400).json({ success: false, error: 'WhatsApp no está conectado' });
    }

    if (!phone || !message) {
        return res.status(400).json({ success: false, error: 'Número y mensaje son requeridos' });
    }

    // Limpiar número y validar formato
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 8 || cleanPhone.length > 15) {
        return res.status(400).json({
            success: false,
            error: `Número inválido: "${phone}". Use formato: código país + número (ej: 521234567890 para México)`
        });
    }

    try {
        const jid = phoneToJid(cleanPhone);
        console.log(`📤 Enviando mensaje a ${jid}`);

        // Enviar mensaje y esperar confirmación
        const sent = await sock.sendMessage(jid, { text: message });

        console.log(`📤 Respuesta de sendMessage:`, JSON.stringify({
            key: sent?.key,
            status: sent?.status
        }));

        // Verificar si hubo error en el envío
        if (sent?.status === 'ERROR') {
            throw new Error('WhatsApp rechazó el mensaje. ¿El número tiene WhatsApp?');
        }

        // Guardar mapeo entre el número de teléfono y el JID real de WhatsApp
        const remoteJid = sent?.key?.remoteJid;
        if (remoteJid) {
            const jidClean = remoteJid.split('@')[0];
            // Guardar mapeo con el número original y también con versión normalizada
            jidToPhone.set(cleanPhone, jidClean);
            
            // También guardar con versión normalizada (solo dígitos)
            const normalizedPhone = cleanPhone.replace(/\D/g, '');
            if (normalizedPhone !== cleanPhone) {
                jidToPhone.set(normalizedPhone, jidClean);
            }
            
            console.log(`📍 Mapeo guardado: ${cleanPhone} -> ${jidClean}`);
        }

        // Crear/Asegurar que el chat existe
        if (!chats.has(cleanPhone)) {
            chats.set(cleanPhone, {
                phone: cleanPhone,
                name: cleanPhone,
                messages: [],
                lastMessage: null,
                timestamp: Date.now()
            });
        }

        // Notificar que el mensaje fue enviado (el mensaje real llegará por messages.upsert)
        const chatData = chats.get(cleanPhone);

        console.log(`✅ Mensaje enviado a ${jid}: ${message.substring(0, 30)}...`);
        res.json({ success: true, message: 'Mensaje enviado correctamente', phone: cleanPhone });
    } catch (error) {
        console.error('❌ Error al enviar mensaje:', error.message);
        console.error('   Stack:', error.stack);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/chats/:phone/send', async (req, res) => {
    const phone = req.params.phone.replace(/[^0-9]/g, '');
    const { message } = req.body;

    if (connectionStatus !== 'Conectado') {
        return res.status(400).json({ success: false, error: 'WhatsApp no está conectado' });
    }

    if (!message) {
        return res.status(400).json({ success: false, error: 'Mensaje requerido' });
    }

    if (phone.length < 8 || phone.length > 15) {
        return res.status(400).json({ success: false, error: 'Número de teléfono inválido' });
    }

    try {
        const jid = phoneToJid(phone);
        console.log(`📤 Enviando mensaje a ${jid} (${phone})`);

        const sent = await sock.sendMessage(jid, { text: message });

        console.log(`📤 Respuesta de sendMessage:`, JSON.stringify({
            key: sent?.key,
            status: sent?.status
        }));

        if (sent?.status === 'ERROR') {
            throw new Error('WhatsApp rechazó el mensaje. ¿El número tiene WhatsApp?');
        }

        // Guardar mapeo entre el número de teléfono y el JID real de WhatsApp
        const remoteJid = sent?.key?.remoteJid;
        if (remoteJid) {
            const jidClean = remoteJid.split('@')[0];
            jidToPhone.set(phone, jidClean);
            console.log(`📍 Mapeo guardado: ${phone} -> ${jidClean}`);
        }

        // Crear/Asegurar que el chat existe
        if (!chats.has(phone)) {
            chats.set(phone, {
                phone,
                name: phone,
                messages: [],
                lastMessage: null,
                timestamp: Date.now()
            });
        }

        // El mensaje real llegará por messages.upsert, solo respondemos éxito
        console.log(`✅ Mensaje enviado a ${jid}: ${message.substring(0, 30)}...`);
        res.json({ success: true, message: 'Mensaje enviado', phone });
    } catch (error) {
        console.error('❌ Error al enviar mensaje:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/chats/send-with-files', upload.array('files', 10), async (req, res) => {
    const phone = req.body.phone?.replace(/[^0-9]/g, '') || '';
    const message = req.body.message || '';
    const files = req.files || [];

    if (connectionStatus !== 'Conectado') {
        return res.status(400).json({ success: false, error: 'WhatsApp no está conectado' });
    }

    if (!phone || phone.length < 8 || phone.length > 15) {
        return res.status(400).json({ success: false, error: 'Número de teléfono inválido' });
    }

    if (files.length === 0 && !message) {
        return res.status(400).json({ success: false, error: 'Se requiere al menos un archivo o mensaje' });
    }

    try {
        const jid = phoneToJid(phone);
        console.log(`📤 Enviando mensaje con ${files.length} archivo(s) a ${jid}`);

        let messageContent = {};

        if (files.length === 1) {
            const file = files[0];
            const mimeType = file.mimetype;
            const filePath = file.path;

            if (mimeType.startsWith('image/')) {
                messageContent = { image: { url: filePath }, caption: message };
            } else if (mimeType.startsWith('video/')) {
                messageContent = { video: { url: filePath }, caption: message };
            } else if (mimeType.startsWith('audio/')) {
                messageContent = { audio: { url: filePath } };
            } else {
                messageContent = { document: { url: filePath }, fileName: file.originalname, caption: message };
            }
        } else if (files.length > 1) {
            messageContent = { document: { url: files[0].path }, caption: message };
            console.log('⚠️ WhatsApp solo soporta 1 archivo, se enviará el primero');
        } else {
            messageContent = { text: message };
        }

        const sent = await sock.sendMessage(jid, messageContent);

        if (sent?.status === 'ERROR') {
            throw new Error('WhatsApp rechazó el mensaje');
        }

        const remoteJid = sent?.key?.remoteJid;
        if (remoteJid) {
            const jidClean = remoteJid.split('@')[0];
            jidToPhone.set(phone, jidClean);
            const normalizedPhone = phone.replace(/\D/g, '');
            if (normalizedPhone !== phone) {
                jidToPhone.set(normalizedPhone, jidClean);
            }
        }

        if (!chats.has(phone)) {
            chats.set(phone, {
                phone,
                name: phone,
                messages: [],
                lastMessage: null,
                timestamp: Date.now()
            });
        }

        console.log(`✅ Mensaje con archivos enviado a ${phone}`);
        res.json({ success: true, message: 'Mensaje enviado correctamente', phone });

        // Limpiar archivos subidos después de enviar
        files.forEach(file => {
            try {
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            } catch (e) {
                console.log('⚠️ Error limpiando archivo:', e.message);
            }
        });

    } catch (error) {
        console.error('❌ Error al enviar mensaje con archivos:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/logout', async (req, res) => {
    try {
        if (sock) {
            await sock.logout();
            sock = null;
        }
        
        const authDir = path.join(__dirname, 'auth');
        if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
            fs.mkdirSync(authDir, { recursive: true });
        }

        connectionStatus = 'Desconectado';
        qrCodeData = null;
        pairingCode = null;
        
        io.emit('disconnected');
        io.emit('status', connectionStatus);
        
        res.json({ success: true, message: 'Sesión cerrada' });
        
        setTimeout(() => initBaileys(), 1000);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

io.on('connection', (socket) => {
    console.log('Cliente web conectado');
    socket.emit('status', connectionStatus);
    
    if (qrCodeData) {
        socket.emit('qr', qrCodeData);
    }
    if (pairingCode) {
        socket.emit('pairing_code', { code: pairingCode, phone: pairingPhone });
    }
    if (connectionStatus === 'Conectado') {
        socket.emit('ready');
    }
});

const PORT = process.env.PORT || 3000;

async function start() {
    await initBaileys();
    server.listen(PORT, () => {
        console.log(`\n🟢 Servidor corriendo en http://localhost:${PORT}`);
    });
}

start().catch(console.error);