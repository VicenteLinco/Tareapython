======================================================================
     SISTEMA DE INVENTARIO - LABORATORIO CLINICO (RELEASE LOCAL)
======================================================================

Este paquete contiene la versión ejecutable del sistema lista para
ser utilizada localmente sin necesidad de instalar entornos de desarrollo
o exponer el código fuente de la aplicación.

----------------------------------------------------------------------
REQUISITOS DEL SISTEMA:
----------------------------------------------------------------------
- Sistema Operativo: Windows (10, 11 o superior).
- Docker Desktop: Requerido para ejecutar la base de datos (PostgreSQL).
  * Descárgalo de: https://www.docker.com/products/docker-desktop/
  * Asegúrate de iniciar Docker Desktop antes de arrancar los servicios.

----------------------------------------------------------------------
CÓMO USAR EL SISTEMA:
----------------------------------------------------------------------
1. Para Iniciar el Sistema:
   - Haz doble clic sobre el archivo "INICIAR SERVICIO.bat".
   - Esto iniciará la base de datos en Docker, levantará el servidor
     de la aplicación y abrirá automáticamente tu navegador web en:
     http://localhost:8080

2. Credenciales del Administrador Inicial:
   - Al arrancar por primera vez, el sistema autogenerará una cuenta
     de administrador inicial:
     * Correo: admin@laboratorio.com
     * Contraseña: admin123456789
   - IMPORTANTE: Modifica esta contraseña después del primer inicio
     de sesión desde el módulo de configuración de usuarios.

3. Para Detener el Sistema:
   - Cuando termines de trabajar, haz doble clic sobre el archivo
     "DETENER SERVICIO.bat".
   - Esto detendrá la base de datos de Docker y cerrará el servidor
     liberando los puertos utilizados.

----------------------------------------------------------------------
ESTRUCTURA DE ARCHIVOS (No modificar ni eliminar):
----------------------------------------------------------------------
- inventario-lab-backend.exe : Servidor backend del sistema (Rust).
- static/                     : Archivos de la interfaz web (React).
- docker-compose.yml          : Configuración de la Base de Datos en Docker.
- .env                        : Variables de configuración del sistema.
- README.txt                  : Este archivo de instrucciones.
======================================================================
