// ══════════════════════════════════════════════════════════════
//  TPV - Servidor local (Node.js + Express + sql.js)
//  Arrancar con: node server.js
// ══════════════════════════════════════════════════════════════

const express = require('express');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'tpv.db');

app.use(express.json());

let db; // instancia de sql.js

// ── Guardar la BBDD en disco ──────────────────────────────────
function guardarDB() {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── Inicializar BBDD ──────────────────────────────────────────
async function inicializar() {
    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
        console.log('✅ Base de datos cargada desde disco');
    } else {
        db = new SQL.Database();
        console.log('✅ Base de datos nueva creada');
    }

    // Crear tablas
    db.run(`
        CREATE TABLE IF NOT EXISTS Empleado (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT    NOT NULL,
            codigo TEXT    NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS Articulo (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT    NOT NULL,
            precio REAL    NOT NULL,
            tipo   TEXT    NOT NULL
        );
        CREATE TABLE IF NOT EXISTS Mesa (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            numero INTEGER NOT NULL UNIQUE,
            estado TEXT    NOT NULL DEFAULT 'libre'
        );
        CREATE TABLE IF NOT EXISTS Pedido (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            id_mesa     INTEGER NOT NULL,
            id_empleado INTEGER NOT NULL,
            fecha_hora  TEXT    NOT NULL DEFAULT (datetime('now')),
            estado      TEXT    NOT NULL DEFAULT 'abierto'
        );
        CREATE TABLE IF NOT EXISTS LineaPedido (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            id_pedido     INTEGER NOT NULL,
            id_articulo   INTEGER NOT NULL,
            cantidad      INTEGER NOT NULL DEFAULT 1,
            precio_unidad REAL    NOT NULL,
            UNIQUE(id_pedido, id_articulo)
        );
    `);

    // Datos de prueba si está vacío
    const res = db.exec('SELECT COUNT(*) as n FROM Empleado');
    const n = res[0].values[0][0];

    if (n === 0) {
        db.run("INSERT INTO Empleado (nombre, codigo) VALUES ('Admin',  '1234')");
        db.run("INSERT INTO Empleado (nombre, codigo) VALUES ('María',  '2222')");
        db.run("INSERT INTO Empleado (nombre, codigo) VALUES ('Carlos', '3333')");

        const arts = [
            ['Cocacola', 2.5, 'Bebida'], ['Nestea', 2.5, 'Bebida'],
            ['Agua', 1.5, 'Bebida'], ['Zumo naranja', 2.8, 'Bebida'],
            ['Café con leche', 1.8, 'Bebida'], ['Cerveza', 2.0, 'Alcohol'],
            ['Vino tinto', 2.5, 'Alcohol'], ['Copa gin-tonic', 7.0, 'Alcohol'],
            ['Bocadillo calamares', 4.5, 'Comida'], ['Bocadillo jamón', 4.0, 'Comida'],
            ['Tosta mixta', 3.5, 'Comida'], ['Pincho tortilla', 2.5, 'Comida'],
            ['Ensalada mixta', 6.0, 'Comida'], ['Plato del día', 9.5, 'Comida'],
            ['Pan', 0.5, 'Varios'], ['Cubierto', 1.0, 'Varios']
        ];
        arts.forEach(([n, p, t]) =>
            db.run('INSERT INTO Articulo (nombre, precio, tipo) VALUES (?, ?, ?)', [n, p, t])
        );

        for (let i = 1; i <= 10; i++) {
            db.run('INSERT INTO Mesa (numero) VALUES (?)', [i]);
        }

        guardarDB();
        console.log('✅ Datos de prueba insertados');
    }

    // ── Helpers ──────────────────────────────────────────────
    function queryAll(sql, params = []) {
        const res = db.exec(sql, params);
        if (!res.length) return [];
        const { columns, values } = res[0];
        return values.map(row =>
            Object.fromEntries(columns.map((c, i) => [c, row[i]]))
        );
    }

    function queryOne(sql, params = []) {
        const rows = queryAll(sql, params);
        return rows.length ? rows[0] : null;
    }

    // ════════════════════════════════════════════════════════
    //  ENDPOINTS
    // ════════════════════════════════════════════════════════

    // POST /login
    app.post('/login', (req, res) => {
        const { codigo } = req.body;
        const emp = queryOne('SELECT id, nombre FROM Empleado WHERE codigo = ?', [codigo]);
        if (emp) res.json({ ok: true, idEmpleado: emp.id, nombre: emp.nombre });
        else res.json({ ok: false });
    });

    // GET /mesas
    app.get('/mesas', (req, res) => {
        const mesas = queryAll('SELECT numero, estado FROM Mesa ORDER BY numero');
        res.json({ mesas });
    });

    // GET /articulos/:tipo
    app.get('/articulos/:tipo', (req, res) => {
        const articulos = queryAll(
            'SELECT id, nombre, precio FROM Articulo WHERE tipo = ? ORDER BY nombre',
            [req.params.tipo]
        );
        res.json({ articulos });
    });

    // GET /pedido/:numeroMesa
    app.get('/pedido/:numeroMesa', (req, res) => {
        const pedido = queryOne(`
            SELECT p.id FROM Pedido p
            JOIN Mesa m ON m.id = p.id_mesa
            WHERE m.numero = ? AND p.estado IN ('abierto','enviado')
        `, [req.params.numeroMesa]);

        if (!pedido) return res.json({ idPedido: -1, lineas: [] });

        const lineas = queryAll(`
            SELECT a.nombre, lp.cantidad, lp.precio_unidad AS precioUnidad
            FROM LineaPedido lp
            JOIN Articulo a ON a.id = lp.id_articulo
            WHERE lp.id_pedido = ?
            ORDER BY a.nombre
        `, [pedido.id]);

        res.json({ idPedido: pedido.id, lineas });
    });

    // POST /pedido/anadir
    app.post('/pedido/anadir', (req, res) => {
        const { numeroMesa, idEmpleado, idArticulo, precioUnidad } = req.body;

        const mesa = queryOne('SELECT id FROM Mesa WHERE numero = ?', [numeroMesa]);
        if (!mesa) return res.json({ ok: false, error: 'Mesa no encontrada' });

        let pedido = queryOne(
            "SELECT id FROM Pedido WHERE id_mesa = ? AND estado IN ('abierto','enviado')",
            [mesa.id]
        );

        if (!pedido) {
            db.run('INSERT INTO Pedido (id_mesa, id_empleado) VALUES (?, ?)', [mesa.id, idEmpleado]);
            pedido = queryOne('SELECT last_insert_rowid() as id');
            db.run("UPDATE Mesa SET estado = 'ocupada' WHERE id = ?", [mesa.id]);
            guardarDB();
        }

        const linea = queryOne(
            'SELECT id, cantidad FROM LineaPedido WHERE id_pedido = ? AND id_articulo = ?',
            [pedido.id, idArticulo]
        );

        if (linea) {
            db.run('UPDATE LineaPedido SET cantidad = ? WHERE id = ?', [linea.cantidad + 1, linea.id]);
        } else {
            db.run(
                'INSERT INTO LineaPedido (id_pedido, id_articulo, cantidad, precio_unidad) VALUES (?, ?, 1, ?)',
                [pedido.id, idArticulo, precioUnidad]
            );
        }
        guardarDB();
        res.json({ ok: true, idPedido: pedido.id });
    });

    // POST /pedido/enviar
    app.post('/pedido/enviar', (req, res) => {
        const { idPedido } = req.body;
        db.run("UPDATE Pedido SET estado = 'enviado' WHERE id = ?", [idPedido]);
        guardarDB();
        res.json({ ok: true });
    });

    // POST /pedido/cobrar
    app.post('/pedido/cobrar', (req, res) => {
        const { idPedido, numeroMesa } = req.body;
        db.run("UPDATE Pedido SET estado = 'cerrado' WHERE id = ?", [idPedido]);
        db.run("UPDATE Mesa SET estado = 'libre' WHERE numero = ?", [numeroMesa]);
        guardarDB();
        res.json({ ok: true });
    });

    // POST /pedido/vaciar
    app.post('/pedido/vaciar', (req, res) => {
        const { idPedido, numeroMesa } = req.body;
        db.run('DELETE FROM LineaPedido WHERE id_pedido = ?', [idPedido]);
        db.run("UPDATE Pedido SET estado = 'cerrado' WHERE id = ?", [idPedido]);
        db.run("UPDATE Mesa SET estado = 'libre' WHERE numero = ?", [numeroMesa]);
        guardarDB();
        res.json({ ok: true });
    });

    // Mantener servidor activo
    setInterval(() => {
        const https = require('https');
        https.get('https://proyectotpv-production.up.railway.app/mesas', () => { });
    }, 5 * 60 * 1000);

    // Arrancar
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🍽️  Servidor TPV arrancado en puerto ${PORT}\n`);
    });
}

inicializar().catch(console.error);