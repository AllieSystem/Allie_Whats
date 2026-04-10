# WhatsApp Web Sender

Aplicación web para conectar con WhatsApp Web escaneando un código QR y enviar mensajes a números específicos.

## Características

- Escaneo de QR para conectar con WhatsApp Web
- Interfaz web moderna y responsive
- Envío de mensajes a cualquier número
- Estado de conexión en tiempo real
- Persistencia de sesión (no requiere escanear QR cada vez)

## Requisitos

- Node.js 14.x o superior
- npm o yarn
- Google Chrome instalado (para puppeteer)

## Instalación

1. Clona o descarga este repositorio
2. Instala las dependencias:

```bash
npm install
```

## Uso

### Desarrollo

```bash
npm run dev
```

### Producción

```bash
npm start
```

La aplicación estará disponible en `http://localhost:3000`

## Instrucciones de uso

1. Abre la aplicación en tu navegador
2. Espera a que se genere el código QR
3. Abre WhatsApp en tu teléfono
4. Ve a **Ajustes** → **WhatsApp Web** → **Vincular dispositivo**
5. Escanea el código QR que aparece en la pantalla
6. Una vez conectado, ingresa el número de teléfono y mensaje
7. Presiona "Enviar Mensaje"

### Formato del número

El número debe incluir el código de país seguido del número telefónico sin espacios ni símbolos:

- ✅ Correcto: `521234567890` (México)
- ✅ Correcto: `34600123456` (España)
- ❌ Incorrecto: `+52 123 456 7890`
- ❌ Incorrecto: `123-456-7890`

## Estructura del proyecto

```
├── server.js          # Servidor Express y lógica de WhatsApp
├── public/
│   └── index.html     # Interfaz de usuario
├── .wwebjs_auth/      # Sesión de autenticación (se crea automáticamente)
└── package.json
```

## Notas importantes

- **Primera ejecución**: La primera vez que ejecutes la aplicación, descargará automáticamente Chromium (necesario para puppeteer)
- **Sesión persistente**: Una vez que escanees el QR, la sesión se guarda localmente. No necesitarás escanear nuevamente al reiniciar la aplicación
- **Desconexión**: Si cierras sesión desde tu teléfono, deberás escanear el QR nuevamente
- **No oficial**: Esta aplicación usa `whatsapp-web.js`, una librería no oficial. Usa con precaución y nunca para spam

## Solución de problemas

### Error: "Failed to launch browser"

Asegúrate de tener instaladas las dependencias de Chromium:

```bash
# Ubuntu/Debian
sudo apt-get install -y chromium-browser

# Windows
# Asegúrate de tener Chrome instalado
```

### La sesión no persiste

Elimina la carpeta `.wwebjs_auth` y vuelve a escanear el QR:

```bash
rm -rf .wwebjs_auth
```

### Error al enviar mensaje

- Verifica que el número tenga el formato correcto
- Asegúrate de que el número esté registrado en WhatsApp
- Verifica que tienes conexión a internet

## Tecnologías utilizadas

- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) - Librería para conectar con WhatsApp Web
- [Express](https://expressjs.com/) - Framework web
- [Socket.io](https://socket.io/) - Comunicación en tiempo real
- [QRCode.js](https://github.com/davidshimjs/qrcodejs) - Generación de códigos QR
- [Puppeteer](https://pptr.dev/) - Control de navegador para WhatsApp Web

## Licencia

MIT

## Disclaimer

Este proyecto no está afiliado con WhatsApp Inc. Usa esta aplicación bajo tu propia responsabilidad y siempre cumpliendo con los términos de servicio de WhatsApp.
