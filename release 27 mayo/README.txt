======================================================================
     SISTEMA DE INVENTARIO - LABORATORIO CLINICO (RELEASE LOCAL)
======================================================================

Este paquete contiene la version ejecutable del sistema lista para
ser utilizada localmente sin instalar entornos de desarrollo ni exponer
el codigo fuente de la aplicacion.

----------------------------------------------------------------------
REQUISITOS DEL SISTEMA
----------------------------------------------------------------------
- Windows 10, 11 o superior.
- Docker Desktop para ejecutar PostgreSQL.
  Descarga: https://www.docker.com/products/docker-desktop/

----------------------------------------------------------------------
COMO USAR EL SISTEMA
----------------------------------------------------------------------
1. Iniciar:
   - Haz doble clic en "INICIAR SERVICIO.bat".
   - Se iniciara PostgreSQL en Docker, luego el servidor de la app.
   - El navegador abrira http://localhost:8080

2. Credenciales iniciales:
   - Si ALLOW_BOOTSTRAP_ADMIN=true, el sistema creara/actualizara el
     administrador configurado en .env.example / .env.
   - Cambia la clave despues del primer inicio de sesion.

3. Detener:
   - Haz doble clic en "DETENER SERVICIO.bat".

----------------------------------------------------------------------
ESTRUCTURA
----------------------------------------------------------------------
- inventario-lab-backend.exe : servidor backend y frontend estatico.
- static/                    : interfaz web compilada.
- migrations/                : migraciones de base de datos.
- docker-compose.yml         : PostgreSQL local.
- .env.example               : variables de entorno de ejemplo.
- README.txt                 : este archivo.
======================================================================
