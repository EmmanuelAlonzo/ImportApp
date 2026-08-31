# ImportApp v4.0 - Enterprise Industrial Solution 🚀

**ImportApp** es una robusta plataforma de control operativo diseñada para entornos industriales de alto rendimiento. Desarrollada con Expo y React Native, esta solución permite la gestión, verificación y auditoría de inventarios en tiempo real, con una sincronización profunda y bidireccional entre Google Sheets y Supabase.

---

## 🖤 Motor Visual: MoodyDark Pristine Engine

La v4.0 introduce el nuevo motor visual **MoodyDark**, diseñado específicamente para pantallas de planta.
- **Contraste Industrial**: Fondo oscuro profundo (#121212) con acentos en Rojo Industrial (#D32F2F) para máxima visibilidad en condiciones de poca luz.
- **Tipografía de Alta Legibilidad**: Enfoque en datos críticos (Lotes, Pesos, Diámetros).
- **Micro-Animaciones**: Feedback visual instantáneo para confirmación de procesos.

---

## ✨ Características Principales (v4.0 Enterprise)

### 🛠️ Control Operativo de Planta
- **Verificación en Tiempo Real**: Validación de productos conforme salen de línea, con marcado instantáneo en la base de datos central.
- **Ingreso Manual Inteligente**: Generación automática de lotes correlativos (`YYMMDDIXXX`) con inyección directa a la nube.
- **Generación Masiva de Etiquetas**: Motor de impresión PDF corporativo (120mm x 80mm) con códigos de barras 128 auto-generados para impresoras térmicas.

### 👥 Gestión de Personal v4.8.2
- **Seguridad por PIN**: Acceso restringido mediante códigos numéricos de 4 dígitos.
- **Sistema de Roles Dinámicos**: Administrador, Verificador, Supervisor, Operador, Digitador y Auxiliar.
- **Baja Administrativa**: Capacidad de suspender el acceso a personal de forma instantánea sin borrar sus registros históricos.

### 📊 Inteligencia de Datos y Reportes
- **Análisis de Avance Industrial**: Dashboard visual de eficiencia por diámetros y lotes verificados.
- **Exportación Gerencial**: Generación de reportes Excel (.xlsx) compatibles con dispositivos móviles para auditorías rápidas.
- **Sincronización Avanzada con Drive**: Sincronización bidireccional completamente delegada al backend. El dispositivo móvil interactúa únicamente con Supabase, mientras que Edge Functions dedicadas (autenticadas mediante Google Service Accounts) gestionan la rápida inserción y escritura directa de estados de verificación hacia Google Drive. Esto elimina el uso del antiguo y lento Google Apps Script, resolviendo problemas de concurrencia y minimizando la carga en el dispositivo del operario.

---

## 🛠️ Stack Tecnológico

- **Frontend Mobile**: React Native (v0.81), Expo (SDK ~54), Expo Router (~v6), Reanimated y AsyncStorage. Implementa el **"MoodyDark Pristine Engine"** con un diseño estandarizado usando áreas de tap ampliadas (para guantes industriales) y prevención de fatiga visual.
- **Backend & Base de Datos**: Supabase (PostgreSQL) para operaciones transaccionales y de lectura de alta velocidad.
- **Transacciones de Estado y Conectividad Drive**: Supabase Edge Functions escritas en TypeScript (Deno). Se interconectan con el API de Google utilizando **Google Service Accounts** para modificar directamente las planillas. Toda la arquitectura anterior de Google Apps Script ha sido deprecada y eliminada para brindar Atomicidad ("Race Conditions" resueltas).
- **Documentación y Reportes**: ExcelJS, Expo-Print, Thermal Barcode Engine.

---

## 🚀 Flujo de Trabajo Industrial

1. **Configuración Global**: El administrador autenticado vincula el link maestro de Google Sheets.
2. **Sincronización**: Se importan dinámicamente las hojas de producción activas.
3. **Operación**: El personal de planta verifica lotes o genera etiquetas según su rol.
4. **Auditoría**: Los supervisores exportan reportes consolidados y monitorean la eficiencia en tiempo real.

---
© 2026 ImportApp Enterprise Solution | **Industrial Reliability Redefined.**
