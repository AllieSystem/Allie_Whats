# WhatsApp Chat API

API REST para conectar con WhatsApp Web, enviar mensajes y recibir notificaciones en tiempo real mediante WebSockets.

## Tabla de Contenidos

- [Instalación](#instalación)
- [Uso](#uso)
- [API Reference](#api-reference)
- [WebSockets](#websockets)
- [Tipos de Mensajes](#tipos-de-mensajes)
- [Códigos de Error](#códigos-de-error)
- [Formatos](#formatos)

---

## Instalación

```bash
npm install
```

### Desarrollo

```bash
npm run dev
```

### Producción

```bash
npm start
```

La aplicación estará disponible en `http://localhost:3000`

---

## Autenticación

### Conexión QR

1. Abre la aplicación en tu navegador
2. Escanea el código QR con WhatsApp (Ajustes → WhatsApp Web)
3. La sesión se persiste automáticamente

### Código de Emparejamiento

Alternativamente, usa el código de emparejamiento:

```bash
curl -X POST http://localhost:3000/api/pairing \
  -H "Content-Type: application/json" \
  -d '{"phone": "525556614579"}'
```

---

## API Reference

### Conexión

#### GET /api/status

Obtiene el estado actual de la conexión.

**Respuesta:**

```json
{
  "isConnected": true,
  "status": "Conectado",
  "hasQR": false,
  "hasPairing": false,
  "phone": "525556614579"
}
```

---

#### POST /api/pairing

Solicita un código de emparejamiento para conectar sin QR.

**Request Body:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| phone | string | Número de teléfono con código de país |

**Ejemplo:**

```bash
curl -X POST http://localhost:3000/api/pairing \
  -H "Content-Type: application/json" \
  -d '{"phone": "525556614579"}'
```

**Respuesta:**

```json
{
  "success": true,
  "code": "XXX-XXX-XXX",
  "phone": "525556614579"
}
```

---

#### GET /api/check/:phone

Verifica si un número tiene WhatsApp instalado.

**Parámetros:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| phone | string | Número a verificar (sin simbolos) |

**Ejemplo:**

```bash
curl http://localhost:3000/api/check/525556614579
```

**Respuesta - Existe:**

```json
{
  "success": true,
  "exists": true,
  "jid": "525556614579@s.whatsapp.net",
  "phone": "525556614579"
}
```

**Respuesta - No Existe:**

```json
{
  "success": true,
  "exists": false,
  "phone": "525556614579",
  "message": "Este número no está registrado en WhatsApp"
}
```

---

### Mensajería

#### POST /api/send

Envía un mensaje de texto a un número de WhatsApp.

**Request Body:**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| phone | string | Sí | Número con código de país |
| message | string | Sí | Contenido del mensaje |

**Ejemplo:**

```bash
curl -X POST http://localhost:3000/api/send \
  -H "Content-Type: application/json" \
  -d '{"phone": "525556614579", "message": "Hola desde la API"}'
```

**Respuesta:**

```json
{
  "success": true,
  "message": "Mensaje enviado correctamente",
  "phone": "525556614579"
}
```

**Ejemplo JavaScript:**

```javascript
const response = await fetch('/api/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    phone: '525556614579',
    message: 'Hola desde la API'
  })
});
const data = await response.json();
```

**Ejemplo Python:**

```python
import requests

response = requests.post(
    'http://localhost:3000/api/send',
    json={
        'phone': '525556614579',
        'message': 'Hola desde la API'
    }
)
print(response.json())
```

---

#### POST /api/chats/:phone/send

Envía un mensaje a un chat existente.

**Parámetros URL:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| phone | string | Número de teléfono |

**Request Body:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| message | string | Contenido del mensaje |

**Ejemplo:**

```bash
curl -X POST http://localhost:3000/api/chats/525556614579/send \
  -H "Content-Type: application/json" \
  -d '{"message": "Respuesta al chat"}'
```

---

#### POST /api/chats/send-with-files

Envía un mensaje con archivos multimedia.

**Request Body (Multipart):**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| phone | string | Número de teléfono |
| message | string | Mensaje de texto (opcional) |
| files | File[] | Archivos (máximo 10) |

**Ejemplo cURL:**

```bash
curl -X POST http://localhost:3000/api/chats/send-with-files \
  -F "phone=525556614579" \
  -F "message=Descripción de la imagen" \
  -F "files=@/path/to/image.jpg"
```

**Tipos de archivo soportados:**

- Imágenes: `image/jpeg`, `image/png`, `image/webp`
- Videos: `video/mp4`, `video/3gpp`
- Audio: `audio/mp4`, `audio/ogg`
- Documentos: cualquier tipo

---

### Conversaciones

#### GET /api/chats

Lista todas las conversaciones.

**Ejemplo:**

```bash
curl http://localhost:3000/api/chats
```

**Respuesta:**

```json
[
  {
    "phone": "525556614579",
    "name": "525556614579",
    "lastMessage": {
      "id": "abc123",
      "text": "Último mensaje",
      "timestamp": 1704067200000,
      "isOutgoing": false
    },
    "messageCount": 15
  }
]
```

---

#### GET /api/chats/:phone/messages

Obtiene los mensajes de una conversación.

**Parámetros:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| phone | string | Número de teléfono |

**Ejemplo:**

```bash
curl http://localhost:3000/api/chats/525556614579/messages
```

**Respuesta:**

```json
{
  "phone": "525556614579",
  "name": "525556614579",
  "messages": [
    {
      "id": "abc123",
      "text": "Hola",
      "timestamp": 1704067200000,
      "isOutgoing": false,
      "mediaType": null,
      "mediaThumbnail": null,
      "mediaMimeType": null,
      "mediaFileName": null,
      "mediaUrl": null,
      "quotedMsg": null
    }
  ]
}
```

---

### Medios

#### POST /api/download-media

Descarga un archivo multimedia.

**Request Body:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| messageId | string | ID del mensaje con medios |

**Ejemplo:**

```bash
curl -X POST http://localhost:3000/api/download-media \
  -H "Content-Type: application/json" \
  -d '{"messageId": "abc123"}' \
  --output archivo_descargado.jpg
```

**Respuesta:** Binario del archivo

---

## WebSockets

Conecta mediante Socket.io para recibir eventos en tiempo real.

### Conexión

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');
```

---

### Eventos del Servidor

#### status

Estado de la conexión.

```javascript
socket.on('status', (status) => {
  console.log('Estado:', status);
  // Valores: "Desconectado", "Esperando código...", "Esperando emparejamiento...", "Conectado"
});
```

---

#### ready

WhatsApp conectado exitosamente.

```javascript
socket.on('ready', () => {
  console.log('✅ WhatsApp conectado');
});
```

---

#### disconnected

Conexión perdida.

```javascript
socket.on('disconnected', () => {
  console.log('❌ WhatsApp desconectado');
});
```

---

#### pairing_code

Código de emparejamiento generado.

```javascript
socket.on('pairing_code', ({ code, phone }) => {
  console.log(`Código: ${code} para ${phone}`);
});
```

---

#### chats_loaded

Chats cargados desde WhatsApp.

```javascript
socket.on('chats_loaded', ({ count }) => {
  console.log(`Chats cargados: ${count}`);
});
```

---

#### new_message

Nuevo mensaje recibido o enviado.

```javascript
socket.on('new_message', ({ phone, message, chat }) => {
  console.log(`Mensaje de ${phone}:`, message.text);
});
```

**Estructura del mensaje:**

```json
{
  "phone": "525556614579",
  "message": {
    "id": "abc123",
    "text": "Contenido del mensaje",
    "timestamp": 1704067200000,
    "isOutgoing": false,
    "mediaType": "image",
    "mediaThumbnail": "base64...",
    "mediaMimeType": "image/jpeg",
    "mediaFileName": "image.jpg",
    "mediaUrl": "https://...",
    "mediaKey": "...",
    "mediaDirectPath": "/file/...",
    "mediaFileLength": 12345,
    "quotedMsg": {
      "id": "reply123",
      "text": "Mensaje al que responde",
      "sender": "525556614579"
    }
  },
  "chat": { ... }
}
```

---

## Tipos de Mensajes

### Tipos de Media

| Valor | Descripción |
|-------|-------------|
| `image` | Imagen con caption opcional |
| `video` | Video con caption opcional |
| `audio` | Audio (nota de voz) |
| `document` | Documento o archivo |
| `sticker` | Sticker |

### Estados de Mensaje

| Estado | Descripción |
|--------|-------------|
| `PENDING` | Pendiente de envío |
| `SERVER_ACK` | Enviado al servidor |
| `DELIVERY_ACK` | Entregado al destinatario |
| `READ` | Leído por el destinatario |
| `ERROR` | Error en el envío |

---

## Códigos de Error

### Códigos HTTP

| Código | Descripción |
|--------|-------------|
| 200 | Éxito |
| 400 | Solicitud inválida |
| 404 | Recurso no encontrado |
| 500 | Error del servidor |

### Errores de la API

| Error | Descripción |
|-------|-------------|
| `WhatsApp no está conectado` | Debe conectar primero |
| `Número y mensaje son requeridos` | Faltan campos obligatorios |
| `Número inválido` | Formato de teléfono incorrecto |
| `El mensaje no tiene medios` | El mensaje no contiene archivos |
| `Mensaje no encontrado` | ID de mensaje inválido |
| `Número no registrado en WhatsApp` | El destinatario no tiene WhatsApp |

---

## Formatos

### Formato del Teléfono

El número debe incluir el código de país sin espacios ni símbolos:

- ✅ Correcto: `525556614579` (México)
- ✅ Correcto: `34600123456` (España)
- ❌ Incorrecto: `+52 55 5661 4579`
- ❌ Incorrecto: `55-5661-4579`

### Timestamps

Todos los timestamps están en milisegundos Unix:

```javascript
// JavaScript
new Date(message.timestamp).toISOString()

# Python
datetime.fromtimestamp(message['timestamp'] / 1000)
```

---

## Estructura del Proyecto

```
├── server.js          # Servidor Express y lógica de Baileys
├── public/
│   └── index.html     # Interfaz web
├── auth/              # Sesión de autenticación
├── data/
│   └── chats.json     # Chats persistidos
├── uploads/           # Archivos subidos
└── package.json
```

---

## Tecnologías

- [Baileys](https://github.com/WhiskeySockets/Baileys) - Cliente WhatsApp
- [Express](https://expressjs.com/) - Framework web
- [Socket.io](https://socket.io/) - WebSockets
- [Multer](https://github.com/expressjs/multer) - Upload de archivos

---

## Limitaciones

- Esta aplicación no está afiliada con WhatsApp Inc.
- No usar para spam o mensajes no solicitados
- Usar bajo responsabilidad propia

---

## Licencia

MIT
