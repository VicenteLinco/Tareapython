import datetime
import uuid
import random

# Base configuration
base_date = datetime.date(2026, 7, 18)
six_months_ago = base_date - datetime.timedelta(days=180)

# Target SQL file
sql_file = "scratch/seed_dev.sql"

# Random seed for reproducibility
random.seed(42)

sql_lines = []

def add_line(line):
    sql_lines.append(line + "\n")

# Start Transaction
add_line("BEGIN;")

# 1. Truncate transaction tables
add_line("-- Limpiar tablas transaccionales")
add_line("TRUNCATE TABLE recepcion_detalle CASCADE;")
add_line("TRUNCATE TABLE recepciones CASCADE;")
add_line("TRUNCATE TABLE movimientos CASCADE;")
add_line("TRUNCATE TABLE stock CASCADE;")
add_line("TRUNCATE TABLE lotes CASCADE;")
add_line("TRUNCATE TABLE producto_area CASCADE;")
add_line("TRUNCATE TABLE presentaciones CASCADE;")
add_line("TRUNCATE TABLE productos CASCADE;")
add_line("TRUNCATE TABLE proveedores CASCADE;")
add_line("TRUNCATE TABLE audit_log CASCADE;")
add_line("TRUNCATE TABLE idempotency_keys CASCADE;")
add_line("TRUNCATE TABLE solicitudes_compra CASCADE;")
add_line("TRUNCATE TABLE sesiones_conteo CASCADE;")

# Reset sequences
add_line("ALTER SEQUENCE seq_mov_numero RESTART WITH 1;")
add_line("ALTER SEQUENCE seq_rec_numero RESTART WITH 1;")
add_line("ALTER SEQUENCE seq_prd_numero RESTART WITH 1;")
add_line("ALTER SEQUENCE seq_lot_numero RESTART WITH 1;")

# Seed base metadata if not exists
add_line("-- Seed base metadata")
add_line("""
INSERT INTO unidades_basicas (id, nombre, nombre_plural, categoria) VALUES
    (1, 'unidad', 'unidades', 'count'),
    (2, 'mililitro', 'mililitros', 'volume'),
    (3, 'gramo', 'gramos', 'weight'),
    (4, 'prueba', 'pruebas', 'count')
ON CONFLICT (id) DO NOTHING;

INSERT INTO areas (id, nombre, es_bodega) VALUES
    (1, 'Microbiología', false),
    (2, 'PCR', false),
    (3, 'Orinas', false),
    (4, 'Recepción', false),
    (5, 'Laboratorio Central', false),
    (6, 'Bodega Insumos', true),
    (7, 'Bodega Reactivos', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO categorias (id, nombre, descripcion) VALUES
    (1, 'Reactivo', 'Compuestos químicos para reacciones diagnósticas'),
    (2, 'Consumible', 'Material de uso único: tubos, puntas, placas, lancetas'),
    (3, 'Calibrador', 'Materiales de calibración de equipos analíticos'),
    (4, 'Control', 'Sueros y materiales de control de calidad interno'),
    (5, 'Kit diagnóstico', 'Kits completos para pruebas específicas'),
    (6, 'Medio de cultivo', 'Medios sólidos y líquidos para microbiología'),
    (7, 'Material de extracción', 'Tubos vacutainer, agujas, torniquetes'),
    (8, 'Solución / Buffer', 'Diluyentes, soluciones de lavado y fijadores'),
    (9, 'EPP', 'Equipos de protección personal: guantes, mascarillas, lentes')
ON CONFLICT (id) DO NOTHING;
""")

# 2. Insert provider
provider_uuid = 1
add_line(f"INSERT INTO proveedores (id, nombre, contacto, telefono, email, activa) VALUES ({provider_uuid}, 'Global Lab Supplies', 'Ana Rojas', '+56223456789', 'ventas@globallab.cl', true);")

# 3. Define products
products = [
    {
        "id": str(uuid.uuid4()),
        "nombre": "Guantes de Nitrilo [Alerta: Agotado]",
        "desc": "Guantes descartables sin polvo talla M",
        "cat_id": 9, # EPP
        "unit_id": 1,
        "min_stock": 50.0,
        "control_lote": "con_vto",
        "type": "agotado"
    },
    {
        "id": str(uuid.uuid4()),
        "nombre": "Tubos al Vacío EDTA [Alerta: Stock Crítico]",
        "desc": "Tubos de extracción de tapa lila 4 mL",
        "cat_id": 7, # Material de extracción
        "unit_id": 1,
        "min_stock": 100.0,
        "control_lote": "con_vto",
        "type": "critico"
    },
    {
        "id": str(uuid.uuid4()),
        "nombre": "Reactivo PCR Ampli-Kit [Alerta: Stock Bajo / Reponer]",
        "desc": "Reactivo de PCR multiplex para patógenos respiratorios",
        "cat_id": 5, # Kit diagnóstico
        "unit_id": 4, # prueba
        "min_stock": 100.0,
        "control_lote": "trazable",
        "type": "reponer"
    },
    {
        "id": str(uuid.uuid4()),
        "nombre": "Placas de Agar Sangre Columbia [Alerta: Vencido]",
        "desc": "Placas preparadas para microbiología",
        "cat_id": 6, # Medio de cultivo
        "unit_id": 1,
        "min_stock": 20.0,
        "control_lote": "con_vto",
        "type": "vencido"
    },
    {
        "id": str(uuid.uuid4()),
        "nombre": "Suero Fisiológico 500 mL [Alerta: Por Vencer]",
        "desc": "Solución fisiológica estéril",
        "cat_id": 8, # Solución / Buffer
        "unit_id": 1,
        "min_stock": 50.0,
        "control_lote": "con_vto",
        "type": "por_vencer"
    },
    {
        "id": str(uuid.uuid4()),
        "nombre": "Puntas de Pipeta 1000uL [Alerta: Riesgo Vencimiento]",
        "desc": "Puntas desechables con filtro en gradilla",
        "cat_id": 2, # Consumible
        "unit_id": 1,
        "min_stock": 100.0,
        "control_lote": "con_vto",
        "type": "riesgo_venc"
    },
    {
        "id": str(uuid.uuid4()),
        "nombre": "Alcohol Isopropílico 70% [Alerta: Crítico + Por Vencer]",
        "desc": "Solución desinfectante en bidón de 5L",
        "cat_id": 8, # Solución / Buffer
        "unit_id": 1,
        "min_stock": 200.0,
        "control_lote": "con_vto",
        "type": "critico_por_vencer"
    },
    {
        "id": str(uuid.uuid4()),
        "nombre": "Puntas Amarillas 200uL [Sin Alerta: Normal]",
        "desc": "Puntas de micropipeta estándar",
        "cat_id": 2, # Consumible
        "unit_id": 1,
        "min_stock": 10.0,
        "control_lote": "con_vto",
        "type": "normal"
    }
]

# Fetch admin user ID dynamically in SQL
add_line("DO $$")
add_line("DECLARE")
add_line("    v_user_id uuid;")
add_line("BEGIN")
add_line("    SELECT id INTO v_user_id FROM usuarios WHERE email = 'admin@lab.cl' LIMIT 1;")

# Insert products, presentations, areas mapping
for p in products:
    add_line(f"    -- Producto: {p['nombre']}")
    add_line(f"""    INSERT INTO productos (id, codigo_interno, nombre, descripcion, categoria_id, unidad_base_id, stock_minimo_global, control_lote, activo)
    VALUES ('{p['id']}', generar_codigo_producto(), '{p['nombre']}', '{p['desc']}', {p['cat_id']}, {p['unit_id']}, {p['min_stock']}, '{p['control_lote']}', true);""")
    
    # default presentation
    add_line(f"""    INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion)
    VALUES ('{p['id']}', 'Unidad', 'Unidades', 1.0);""")
    
    # link to areas
    add_line(f"""    INSERT INTO producto_area (producto_id, area_id) VALUES ('{p['id']}', 6); -- Bodega Insumos""")
    add_line(f"""    INSERT INTO producto_area (producto_id, area_id) VALUES ('{p['id']}', 1); -- Microbiologia / Lab""")

# Generate movements for each product over 6 months
for p in products:
    p_id = p["id"]
    p_type = p["type"]
    
    # Create lote configurations
    lote_id = str(uuid.uuid4())
    lote_number = f"LOT-{random.randint(10000, 99999)}"
    
    # Default expiry dates based on type
    if p_type == "vencido":
        expiry_date_str = f"'{base_date - datetime.timedelta(days=14)}'"
    elif p_type == "por_vencer" or p_type == "critico_por_vencer":
        expiry_date_str = f"'{base_date + datetime.timedelta(days=45)}'"
    elif p_type == "riesgo_venc":
        expiry_date_str = f"'{base_date + datetime.timedelta(days=15)}'"
    else:
        expiry_date_str = f"'{base_date + datetime.timedelta(days=500)}'" # Far away
        
    add_line(f"    -- Lote para {p['nombre']}")
    add_line(f"""    INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, costo_unitario)
    VALUES ('{lote_id}', '{p_id}', {provider_uuid}, '{lote_number}', {expiry_date_str}, 10.0);""")
    
    # Generate daily/weekly flow of movements
    current_stock = 0
    
    # Initial load 6 months ago
    initial_qty = 500
    if p_type == "normal":
        initial_qty = 200
    elif p_type == "vencido":
        initial_qty = 100
        
    current_stock += initial_qty
    date_str = (six_months_ago).strftime('%Y-%m-%d %H:%M:%S')
    add_line(f"""    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
    VALUES ('{lote_id}', 6, 'CARGA_INICIAL', {initial_qty}, {current_stock}, v_user_id, '{date_str}Z', 'Carga inicial del sistema');""")
    
    # Periodic consumption and replenishment
    day = 1
    while day < 180:
        # Every 3 days, simulate a consumption
        if day % 3 == 0:
            if p_type == "normal":
                consume_qty = 2
            elif p_type == "agotado":
                consume_qty = 8
            elif p_type == "critico" or p_type == "critico_por_vencer":
                consume_qty = 12
            else:
                consume_qty = 6
                
            if current_stock >= consume_qty:
                current_stock -= consume_qty
                m_date = six_months_ago + datetime.timedelta(days=day)
                date_str = m_date.strftime('%Y-%m-%d %H:%M:%S')
                add_line(f"""    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('{lote_id}', 6, 'CONSUMO', {consume_qty}, {current_stock}, v_user_id, '{date_str}Z', 'Consumo rutinario');""")
                
        # Every 30 days, simulate a replenishment (INGRESO)
        if day % 30 == 0:
            replenish_qty = 200
            if p_type == "normal":
                replenish_qty = 50
            elif p_type == "vencido":
                replenish_qty = 0 # No replenishment for expired product to keep stock low
                
            if replenish_qty > 0:
                current_stock += replenish_qty
                m_date = six_months_ago + datetime.timedelta(days=day)
                date_str = m_date.strftime('%Y-%m-%d %H:%M:%S')
                add_line(f"""    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('{lote_id}', 6, 'INGRESO', {replenish_qty}, {current_stock}, v_user_id, '{date_str}Z', 'Reabastecimiento mensual');""")
                
        day += 1

    # Final adjustment to match desired status on base_date (today)
    target_stock = 0
    if p_type == "agotado":
        target_stock = 0
    elif p_type == "critico":
        target_stock = 10  # Very low days of cover
    elif p_type == "reponer":
        target_stock = 150 # Stock bajo
    elif p_type == "vencido":
        target_stock = 15
    elif p_type == "por_vencer":
        target_stock = 100
    elif p_type == "riesgo_venc":
        target_stock = 200
    elif p_type == "critico_por_vencer":
        target_stock = 15
    elif p_type == "normal":
        target_stock = 150
        
    diff = target_stock - current_stock
    adjust_date = base_date - datetime.timedelta(days=1)
    date_str = adjust_date.strftime('%Y-%m-%d %H:%M:%S')
    
    if diff > 0:
        current_stock += diff
        add_line(f"""    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
        VALUES ('{lote_id}', 6, 'AJUSTE_POSITIVO', {diff}, {current_stock}, v_user_id, '{date_str}Z', 'Ajuste de inventario final');""")
    elif diff < 0:
        consume_val = abs(diff)
        current_stock -= consume_val
        add_line(f"""    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
        VALUES ('{lote_id}', 6, 'AJUSTE_NEGATIVO', {consume_val}, {current_stock}, v_user_id, '{date_str}Z', 'Ajuste de inventario final');""")

add_line("END $$;")
add_line("COMMIT;")

with open(sql_file, "w", encoding="utf-8") as f:
    f.writelines(sql_lines)

print(f"Generated {len(sql_lines)} lines of SQL seed in {sql_file}")
