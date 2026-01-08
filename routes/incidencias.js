import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import pool from "../db.js";

const router = express.Router();

const DB_NAME = "cusco_reporta";
const TABLE_INCIDENCIAS = "incidencias";
const TABLE_EVIDENCIAS = "evidencias";

// =====================
// MULTER (uploads)
// =====================
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const name = `ev_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 }, // 6MB
});

// =====================
// HELPERS
// =====================
function clean(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function normalizePlaca(p) {
  return String(p || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9-]/g, "");
}

async function getColumns(tableName) {
  const [rows] = await pool.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    `,
    [DB_NAME, tableName]
  );
  return new Set(rows.map((r) => r.COLUMN_NAME));
}

function parseNumOrNull(v) {
  const s = clean(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// =====================
// GET /incidencias
// (para lista_incidencias)
// Usa vw_incidencias_panel + JOIN incidencias para traer placa
// =====================
router.get("/", async (req, res) => {
  try {
    const { desde, hasta, estado } = req.query;

    const where = [];
    const params = [];

    if (desde) {
      where.push("DATE(v.fecha_incidente) >= ?");
      params.push(desde);
    }
    if (hasta) {
      where.push("DATE(v.fecha_incidente) <= ?");
      params.push(hasta);
    }

    // Filtro estado (usa estado_codigo del view)
    if (estado && estado !== "todos") {
      const map = {
        reporte: "RECIBIDO",
        proceso: "EN_PROCESO",
        solucionado: "SOLUCIONADO",
      };
      const estadoDb = map[String(estado).toLowerCase()];
      if (estadoDb) {
        where.push("v.estado_codigo = ?");
        params.push(estadoDb);
      }
    }

    const sql = `
      SELECT
        v.id,
        v.tipo_registro,
        i.placa,
        v.categoria,
        v.estado_codigo,
        v.estado_nombre,
        v.titulo,
        v.descripcion,
        v.fecha_incidente,
        v.departamento,
        v.provincia,
        v.distrito,
        v.referencia_lugar,
        v.longitud,
        v.latitud,
        ST_AsText(v.ubicacion) AS ubicacion_wkt
      FROM vw_incidencias_panel v
      JOIN incidencias i ON i.id = v.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY v.id DESC
    `;

    const [rows] = await pool.query(sql, params);
    return res.json({ ok: true, incidencias: rows, total: rows.length });
  } catch (err) {
    console.error("INCIDENCIAS LIST ERROR:", err);
    return res.status(500).json({ ok: false, message: err?.sqlMessage || "Error interno al listar incidencias" });
  }
});

// =====================
// GET /incidencias/placa/:placa
// Devuelve detalle por placa
// =====================
router.get("/placa/:placa", async (req, res) => {
  try {
    const placa = normalizePlaca(req.params.placa);

    if (!placa) {
      return res.status(400).json({ ok: false, message: "Placa inválida" });
    }

    // Trae detalle desde incidencias + joins del view
    // (View NO tiene placa, por eso hacemos join con incidencias)
    const sql = `
      SELECT
        v.id,
        v.tipo_registro,
        i.placa,
        v.categoria,
        v.estado_codigo,
        v.estado_nombre,
        v.titulo,
        v.descripcion,
        v.fecha_incidente,
        v.departamento,
        v.provincia,
        v.distrito,
        v.referencia_lugar,
        v.longitud,
        v.latitud,
        ST_AsText(v.ubicacion) AS ubicacion_wkt
      FROM vw_incidencias_panel v
      JOIN incidencias i ON i.id = v.id
      WHERE i.placa = ?
      ORDER BY v.id DESC
      LIMIT 50
    `;

    const [rows] = await pool.query(sql, [placa]);

    return res.json({
      ok: true,
      reportado: rows.length > 0,
      total: rows.length,
      placa,
      incidencias: rows,
    });
  } catch (err) {
    console.error("CONSULTA PLACA ERROR:", err);
    return res.status(500).json({ ok: false, message: err?.sqlMessage || "Error interno al consultar placa" });
  }
});

// =====================
// POST /incidencias
// Inserta incidencia + evidencia opcional
// Guarda ubicacion GEOMETRY (POINT(lng lat))
// =====================
router.post("/", upload.single("archivo"), async (req, res) => {
  try {
    const colsInc = await getColumns(TABLE_INCIDENCIAS);
    const colsEv = await getColumns(TABLE_EVIDENCIAS);

    const {
      fecha_incidente,
      categoria_id,
      placa,
      titulo,
      referencia_lugar,
      distrito,
      departamento,
      provincia,
      descripcion,
      lat,
      lng,
      usuario_id,
      modo,         // incognito | identificado
      tipo_registro // opcional
    } = req.body;

    // validación mínima
    if (!clean(fecha_incidente) || !clean(titulo) || !clean(descripcion) || !clean(categoria_id)) {
      return res.status(400).json({
        ok: false,
        message: "Faltan campos obligatorios: fecha_incidente, categoria_id, titulo, descripcion",
      });
    }

    // coords: ubicacion es GEOMETRY y NO debe quedar vacío -> ponemos default Cusco si falta
    const latNum = parseNumOrNull(lat) ?? -13.53195;
    const lngNum = parseNumOrNull(lng) ?? -71.96746;

    // tipo_registro
    let tr = String(tipo_registro || "").trim().toUpperCase();
    if (!tr) tr = (modo === "identificado" ? "DENUNCIA" : "REPORTE");
    if (tr !== "DENUNCIA") tr = "REPORTE";

    // placa normalizada
    const placaNorm = normalizePlaca(placa);

    // Construir insert dinámico
    const insertCols = [];
    const insertVals = [];

    if (colsInc.has("tipo_registro")) { insertCols.push("tipo_registro"); insertVals.push(tr); }
    if (colsInc.has("estado_id")) { insertCols.push("estado_id"); insertVals.push(1); } // 1=Recibido

    if (colsInc.has("fecha_incidente")) { insertCols.push("fecha_incidente"); insertVals.push(fecha_incidente); }
    if (colsInc.has("categoria_id")) { insertCols.push("categoria_id"); insertVals.push(Number(categoria_id)); }

    if (colsInc.has("placa")) { insertCols.push("placa"); insertVals.push(placaNorm || null); }
    if (colsInc.has("titulo")) { insertCols.push("titulo"); insertVals.push(clean(titulo)); }
    if (colsInc.has("descripcion")) { insertCols.push("descripcion"); insertVals.push(clean(descripcion)); }

    if (colsInc.has("departamento")) { insertCols.push("departamento"); insertVals.push(clean(departamento) || "Cusco"); }
    if (colsInc.has("provincia")) { insertCols.push("provincia"); insertVals.push(clean(provincia) || "Cusco"); }
    if (colsInc.has("distrito")) { insertCols.push("distrito"); insertVals.push(clean(distrito)); }
    if (colsInc.has("referencia_lugar")) { insertCols.push("referencia_lugar"); insertVals.push(clean(referencia_lugar)); }

    // ✅ ubicacion GEOMETRY: POINT(lng lat)
    if (colsInc.has("ubicacion")) {
      insertCols.push("ubicacion");
      insertVals.push(lngNum);
      insertVals.push(latNum);
    }

    if (colsInc.has("usuario_id")) {
      insertCols.push("usuario_id");
      insertVals.push(clean(usuario_id) ? Number(usuario_id) : null);
    }

    const placeholders = insertCols.map((c) => {
      if (c === "ubicacion") return "ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'), 4326)";
      return "?";
    });

    const sqlInsert = `
      INSERT INTO incidencias (${insertCols.map((c) => `\`${c}\``).join(", ")})
      VALUES (${placeholders.join(", ")})
    `;

    const [result] = await pool.query(sqlInsert, insertVals);
    const incidenciaId = result.insertId;

    // =====================
    // Evidencias (si hay archivo)
    // Evita error "Unknown column archivo"
    // =====================
    if (req.file) {
      const evCols = [];
      const evVals = [];

      // incidencia_id
      if (colsEv.has("incidencia_id")) {
        evCols.push("incidencia_id");
        evVals.push(incidenciaId);
      } else {
        // si no existe, no podemos asociar evidencia
        console.warn("Tabla evidencias no tiene incidencia_id");
      }

      // columna nombre archivo (probables)
      const fileCol =
        (colsEv.has("archivo") && "archivo") ||
        (colsEv.has("nombre_archivo") && "nombre_archivo") ||
        (colsEv.has("filename") && "filename") ||
        (colsEv.has("ruta") && "ruta") ||
        null;

      if (fileCol) {
        evCols.push(fileCol);
        evVals.push(req.file.filename);
      }

      // mime/tipo
      const mimeCol =
        (colsEv.has("tipo") && "tipo") ||
        (colsEv.has("mime") && "mime") ||
        (colsEv.has("mimetype") && "mimetype") ||
        null;

      if (mimeCol) {
        evCols.push(mimeCol);
        evVals.push(req.file.mimetype);
      }

      if (evCols.length >= 2) {
        const evSql = `
          INSERT INTO evidencias (${evCols.map((c) => `\`${c}\``).join(", ")})
          VALUES (${evCols.map(() => "?").join(", ")})
        `;
        await pool.query(evSql, evVals);
      } else {
        console.warn("No se insertó evidencia: columnas no compatibles en tabla evidencias.");
      }
    }

    return res.json({
      ok: true,
      message: "Incidencia registrada correctamente",
      id: incidenciaId,
      placa: placaNorm || null,
    });
  } catch (err) {
    console.error("ERROR REGISTRANDO INCIDENCIA:", err);
    return res.status(500).json({
      ok: false,
      message: err?.sqlMessage || "Error interno al registrar incidencia",
    });
  }
});

export default router;





