// ══════════════════════════════════════════════════════════════
//  TPV - Servidor local (Node.js + Express + SQLite)
//  Arrancar con: node server.js
//  Puerto: 3000
// ══════════════════════════════════════════════════════════════

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ── Base de datos ─────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'tpv.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Crear tablas ──────────────────────────────────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS Empleado (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT    NOT NULL,
        codigo TEXT    NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS Articulo (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT    NOT NULL,
        precio REAL    NOT NULL,
        tipo   TEXT    NOT NULL CHECK(tipo IN ('Bebida','Comida','Alcohol','Varios'))
    );

    CREATE TABLE IF NOT EXISTS Mesa (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        numero INTEGER NOT NULL UNIQUE,
        estado TEXT    NOT NULL DEFAULT 'libre' CHECK(estado IN ('libre','ocupada'))
    );

    CREATE TABLE IF NOT EXISTS Pedido (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        id_mesa     INTEGER NOT NULL REFERENCES Mesa(id),
        id_empleado INTEGER NOT NULL REFERENCES Empleado(id),
        fecha_hora  TEXT    NOT NULL DEFAULT (datetime('now')),
        estado      TEXT    NOT NULL DEFAULT 'abierto'
                    CHECK(estado IN ('abierto','enviado','cerrado'))
    );

    CREATE TABLE IF NOT EXISTS LineaPedido (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        id_pedido     INTEGER NOT NULL REFERENCES Pedido(id),
        id_articulo   INTEGER NOT NULL REFERENCES Articulo(id),
        cantidad      INTEGER NOT NULL DEFAULT 1,
        precio_unidad REAL    NOT NULL,
        UNIQUE(id_pedido, id_articulo)
    );
`);

// ── Datos de prueba ───────────────────────────────────────────
const hayEmpleados = db.prepare('SELECT COUNT(*) as n FROM Empleado').get();
if (hayEmpleados.n === 0) {
    const insEmp = db.prepare('INSERT INTO Empleado (nombre, codigo) VALUES (?, ?)');
    insEmp.run('Admin', '1234');
    insEmp.run('María', '2222');
    insEmp.run('Carlos', '3333');

    const insArt = db.prepare('INSERT INTO Articulo (nombre, precio, tipo) VALUES (?, ?, ?)');
    insArt.run('Cocacola', 2.5, 'Bebida');
    insArt.run('Nestea', 2.5, 'Bebida');
    insArt.run('Agua', 1.5, 'Bebida');
    insArt.run('Zumo naranja', 2.8, 'Bebida');
    insArt.run('Café con leche', 1.8, 'Bebida');
    insArt.run('Cerveza', 2.0, 'Alcohol');
    insArt.run('Vino tinto', 2.5, 'Alcohol');
    insArt.run('Copa gin-tonic', 7.0, 'Alcohol');
    insArt.run('Bocadillo calamares', 4.5, 'Comida');
    insArt.run('Bocadillo jamón', 4.0, 'Comida');
    insArt.run('Tosta mixta', 3.5, 'Comida');
    insArt.run('Pincho tortilla', 2.5, 'Comida');
    insArt.run('Ensalada mixta', 6.0, 'Comida');
    insArt.run('Plato del día', 9.5, 'Comida');
    insArt.run('Pan', 0.5, 'Varios');
    insArt.run('Cubierto', 1.0, 'Varios');

    const insMesa = db.prepare('INSERT INTO Mesa (numero) VALUES (?)');
    for (let i = 1; i <= 10; i++) insMesa.run(i);

    console.log('✅ Datos de prueba insertados');
}

// ════════════════════════════════════════════════════════════
//  ENDPOINTS — todos devuelven objetos JSON, nunca arrays sueltos
// ════════════════════════════════════════════════════════════

// ── POST /login ──────────────────────────────────────────────
// Body:     { "codigo": "1234" }
// Éxito:    { "ok": true,  "idEmpleado": 1, "nombre": "Admin" }
// Fallo:    { "ok": false }
app.post('/login', (req, res) => {
    const { codigo } = req.body;
    const emp = db.prepare(
        'SELECT id, nombre FROM Empleado WHERE codigo = ?'
    ).get(codigo);

    if (emp) {
        res.json({ ok: true, idEmpleado: emp.id, nombre: emp.nombre });
    } else {
        res.json({ ok: false });
    }
});

// ── GET /mesas ───────────────────────────────────────────────
// Respuesta: { "mesas": [ { "numero": 1, "estado": "libre" }, ... ] }
app.get('/mesas', (req, res) => {
    const mesas = db.prepare(
        'SELECT numero, estado FROM Mesa ORDER BY numero'
    ).all();
    res.json({ mesas });
});

// ── GET /articulos/:tipo ─────────────────────────────────────
// Respuesta: { "articulos": [ { "id": 1, "nombre": "Cocacola", "precio": 2.5 }, ... ] }
app.get('/articulos/:tipo', (req, res) => {
    const articulos = db.prepare(
        'SELECT id, nombre, precio FROM Articulo WHERE tipo = ? ORDER BY nombre'
    ).all(req.params.tipo);
    res.json({ articulos });
});

// ── GET /pedido/:numeroMesa ──────────────────────────────────
// Respuesta: { "idPedido": 5, "lineas": [ { "nombre", "cantidad", "precioUnidad" } ] }
//         ó  { "idPedido": -1, "lineas": [] }
app.get('/pedido/:numeroMesa', (req, res) => {
    const pedido = db.prepare(`
        SELECT p.id FROM Pedido p
        JOIN Mesa m ON m.id = p.id_mesa
        WHERE m.numero = ? AND p.estado = 'abierto'
    `).get(req.params.numeroMesa);

    if (!pedido) return res.json({ idPedido: -1, lineas: [] });

    const lineas = db.prepare(`
        SELECT a.nombre, lp.cantidad, lp.precio_unidad AS precioUnidad
        FROM LineaPedido lp
        JOIN Articulo a ON a.id = lp.id_articulo
        WHERE lp.id_pedido = ?
        ORDER BY a.nombre
    `).all(pedido.id);

    res.json({ idPedido: pedido.id, lineas });
});

// ── POST /pedido/anadir ──────────────────────────────────────
// Body:     { "numeroMesa": 1, "idEmpleado": 1, "idArticulo": 3, "precioUnidad": 2.5 }
// Respuesta: { "ok": true, "idPedido": 5 }
app.post('/pedido/anadir', (req, res) => {
    const { numeroMesa, idEmpleado, idArticulo, precioUnidad } = req.body;

    const mesa = db.prepare('SELECT id FROM Mesa WHERE numero = ?').get(numeroMesa);
    if (!mesa) return res.json({ ok: false, error: 'Mesa no encontrada' });

    let pedido = db.prepare(
        "SELECT id FROM Pedido WHERE id_mesa = ? AND estado = 'abierto'"
    ).get(mesa.id);

    if (!pedido) {
        const info = db.prepare(
            'INSERT INTO Pedido (id_mesa, id_empleado) VALUES (?, ?)'
        ).run(mesa.id, idEmpleado);
        pedido = { id: info.lastInsertRowid };
        db.prepare("UPDATE Mesa SET estado = 'ocupada' WHERE id = ?").run(mesa.id);
    }

    const linea = db.prepare(
        'SELECT id, cantidad FROM LineaPedido WHERE id_pedido = ? AND id_articulo = ?'
    ).get(pedido.id, idArticulo);

    if (linea) {
        db.prepare('UPDATE LineaPedido SET cantidad = ? WHERE id = ?')
            .run(linea.cantidad + 1, linea.id);
    } else {
        db.prepare(
            'INSERT INTO LineaPedido (id_pedido, id_articulo, cantidad, precio_unidad) VALUES (?, ?, 1, ?)'
        ).run(pedido.id, idArticulo, precioUnidad);
    }

    res.json({ ok: true, idPedido: pedido.id });
});

// ── POST /pedido/enviar ──────────────────────────────────────
// Body:     { "idPedido": 5, "numeroMesa": 1 }
// Respuesta: { "ok": true }
app.post('/pedido/enviar', (req, res) => {
    const { idPedido } = req.body;
    db.prepare("UPDATE Pedido SET estado = 'enviado' WHERE id = ?").run(idPedido);
    // Mesa sigue ocupada — no liberamos
    res.json({ ok: true });
});

// ── POST /pedido/cobrar ──────────────────────────────────────
// Body:     { "idPedido": 5, "numeroMesa": 1 }
// Respuesta: { "ok": true }
app.post('/pedido/cobrar', (req, res) => {
    const { idPedido, numeroMesa } = req.body;
    db.prepare("UPDATE Pedido SET estado = 'cerrado' WHERE id = ?").run(idPedido);
    db.prepare("UPDATE Mesa SET estado = 'libre' WHERE numero = ?").run(numeroMesa);
    res.json({ ok: true });
});

// ── POST /pedido/vaciar ──────────────────────────────────────
// Body:     { "idPedido": 5, "numeroMesa": 1 }
// Respuesta: { "ok": true }
app.post('/pedido/vaciar', (req, res) => {
    const { idPedido, numeroMesa } = req.body;
    db.prepare('DELETE FROM LineaPedido WHERE id_pedido = ?').run(idPedido);
    db.prepare("UPDATE Pedido SET estado = 'cerrado' WHERE id = ?").run(idPedido);
    db.prepare("UPDATE Mesa SET estado = 'libre' WHERE numero = ?").run(numeroMesa);
    res.json({ ok: true });
});

// Mantener servidor activo en Railway
setInterval(() => {
    const http = require('https');
    http.get('https://proyectotpv-production.up.railway.app/mesas', () => { });
}, 5 * 60 * 1000);

// ── Arrancar servidor ─────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🍽️  Servidor TPV arrancado`);
    console.log(`📡 Escuchando en http://0.0.0.0:${PORT}`);
    console.log(`\n👉 Desde los móviles usa: http://192.168.0.15:${PORT}\n`);
});