import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import pool from "../db.js";

const router = express.Router();

const DB_NAME = "cusco_reporta";
const TABLE_INCIDENCIAS = "incidencias";
const TABLE_EVIDENCIAS = "evidencias";

// ================== MULTER ==================
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

// ================== HELPERS ==================
function clean(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

async function getTableColumns(schema, table) {
  const [rows] = await pool.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    `,
    [schema, table]
  );
  return new Set(rows.map((r) => r.COLUMN_NAME));
}

function pickFirst(colsSet, candidates) {
  for (const c of candidates) if (colsSet.has(c)) return c;
  return null;
}

// ================== POST /incidencias ==================
router.post("/", upload.single("archivo"), async (req, res) => {
  try {
    const colsInc = await getTableColumns(DB_NAME, TABLE_INCIDENCIAS);
    const colsEv = await getTableColumns(DB_NAME, TABLE_EVIDENCIAS);

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
      tipo_registro, // opcional: "REPORTE" o "DENUNCIA"
    } = req.body;

    // obligatorios mínimos (ajusta si quieres)
    if (!clean(fecha_incidente) || !clean(titulo) || !clean(descripcion)) {
      return res.status(400).json({
        ok: false,
        message: "Faltan campos obligatorios: fecha_incidente, titulo, descripcion",
      });
    }

    // Normalizaciones
    const tipoFinal = String(tipo_registro || "REPORTE").toUpperCase() === "DENUNCIA" ? "DENUNCIA" : "REPORTE";
    const deptoFinal = clean(departamento) || "Cusco";
    const provFinal = clean(provincia) || "Cusco";
    const placaFinal = clean(placa) ? String(placa).trim().toUpperCase() : null;

    const latNum = clean(lat) ? Number(lat) : null;
    const lngNum = clean(lng) ? Number(lng) : null;

    // ---------- INSERT incidencias ----------
    const insertCols = [];
    const insertVals = [];
    const insertSqlVals = []; // para permitir expresiones (ubicacion)

    // tipo_registro
    if (colsInc.has("tipo_registro")) {
      insertCols.push("tipo_registro");
      insertSqlVals.push("?");
      insertVals.push(tipoFinal);
    }

    // estado_id (tu tabla tiene estado_id, NO "estado")
    // Asumimos: 1 = RECIBIDO / REPORTE
    if (colsInc.has("estado_id")) {
      insertCols.push("estado_id");
      insertSqlVals.push("?");
      insertVals.push(1);
    }

    if (colsInc.has("fecha_incidente")) {
      insertCols.push("fecha_incidente");
      insertSqlVals.push("?");
      insertVals.push(clean(fecha_incidente));
    }

    if (colsInc.has("categoria_id")) {
      insertCols.push("categoria_id");
      insertSqlVals.push("?");
      insertVals.push(clean(categoria_id) ? Number(categoria_id) : null);
    }

    if (colsInc.has("placa")) {
      insertCols.push("placa");
      insertSqlVals.push("?");
      insertVals.push(placaFinal);
    }

    if (colsInc.has("titulo")) {
      insertCols.push("titulo");
      insertSqlVals.push("?");
      insertVals.push(clean(titulo));
    }

    if (colsInc.has("descripcion")) {
      insertCols.push("descripcion");
      insertSqlVals.push("?");
      insertVals.push(clean(descripcion));
    }

    if (colsInc.has("departamento")) {
      insertCols.push("departamento");
      insertSqlVals.push("?");
      insertVals.push(deptoFinal);
    }

    if (colsInc.has("provincia")) {
      insertCols.push("provincia");
      insertSqlVals.push("?");
      insertVals.push(provFinal);
    }

    if (colsInc.has("distrito")) {
      insertCols.push("distrito");
      insertSqlVals.push("?");
      insertVals.push(clean(distrito));
    }

    if (colsInc.has("referencia_lugar")) {
      insertCols.push("referencia_lugar");
      insertSqlVals.push("?");
      insertVals.push(clean(referencia_lugar));
    }

    if (colsInc.has("usuario_id")) {
      insertCols.push("usuario_id");
      insertSqlVals.push("?");
      insertVals.push(clean(usuario_id) ? Number(usuario_id) : null);
    }

    // ✅ ubicacion (GEOMETRY). Debe ir como POINT(lng lat)
    if (colsInc.has("ubicacion")) {
      insertCols.push("ubicacion");

      if (latNum != null && lngNum != null && !Number.isNaN(latNum) && !Number.isNaN(lngNum)) {
        // SRID 4326 (WGS84) - si tu tabla no tiene SRID, igual funciona
        insertSqlVals.push("ST_SRID(ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')')), 4326)");
        insertVals.push(lngNum);
        insertVals.push(latNum);
      } else {
        insertSqlVals.push("NULL");
      }
    }

    if (!insertCols.length) {
      return res.status(500).json({ ok: false, message: "No se pudo construir INSERT (sin columnas)" });
    }

    const sqlInsert = `
      INSERT INTO incidencias (${insertCols.map((c) => `\`${c}\``).join(", ")})
      VALUES (${insertSqlVals.join(", ")})
    `;

    const [result] = await pool.query(sqlInsert, insertVals);
    const incidenciaId = result.insertId;

    // ---------- INSERT evidencia (si hay archivo) ----------
    if (req.file) {
      const colIncId = pickFirst(colsEv, ["incidencia_id", "incidencias_id", "id_incidencia"]);
      const colFile = pickFirst(colsEv, ["archivo", "nombre_archivo", "filename", "ruta", "path", "url"]);
      const colMime = pickFirst(colsEv, ["tipo", "mime", "mimetype", "content_type"]);

      if (colIncId && colFile) {
        const evCols = [colIncId, colFile];
        const evVals = [incidenciaId, req.file.filename];

        if (colMime) {
          evCols.push(colMime);
          evVals.push(req.file.mimetype || "application/octet-stream");
        }

        const sqlEv = `
          INSERT INTO evidencias (${evCols.map((c) => `\`${c}\``).join(", ")})
          VALUES (${evCols.map(() => "?").join(", ")})
        `;
        await pool.query(sqlEv, evVals);
      } else {
        // No cortamos el registro principal por evidencia
        console.warn("⚠️ No se pudo guardar evidencia: columnas no compatibles en evidencias");
      }
    }

    return res.status(201).json({
      ok: true,
      message: "Incidencia registrada correctamente",
      id: incidenciaId,
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
