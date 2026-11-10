require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const mysql = require("mysql2/promise");
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");

const app = express();
// Behind a local tunnel or reverse proxy every visitor arrives from 127.0.0.1; without this
// the rate limits would count all of them as one person.
app.set("trust proxy", "loopback");
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("Missing JWT_SECRET. Copy .env.example to .env and set a secure secret.");
  process.exit(1);
}
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

const DB_NAME = process.env.DB_NAME || "dreamsounds";
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || ""
};
// decimalNumbers: daily_rate comes back as a number, as it did under SQLite.
const pool = mysql.createPool({ ...dbConfig, database: DB_NAME, decimalNumbers: true });
// Rows for SELECT; { insertId, affectedRows } for writes.
const q = async (sql, params = []) => (await pool.execute(sql, params))[0];
// Express 4 does not catch rejected promises from async handlers.
const h = fn => (req, res, next) => fn(req, res, next).catch(next);

async function initDb() {
  const conn = await mysql.createConnection(dbConfig);
  await conn.query(`CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(DB_NAME)} CHARACTER SET utf8mb4`);
  await conn.end();

  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(50) NOT NULL DEFAULT '', password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'customer', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS equipment (
    id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, category VARCHAR(100) NOT NULL,
    description TEXT, quantity INT NOT NULL DEFAULT 1,
    daily_rate DECIMAL(12,2) NOT NULL DEFAULT 0, active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS bookings (
    id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NULL,
    customer_name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL, phone VARCHAR(50) NOT NULL,
    event_name VARCHAR(255) NOT NULL, event_date VARCHAR(20) NOT NULL, event_time VARCHAR(20) NOT NULL DEFAULT '',
    venue VARCHAR(255) NOT NULL, guest_count INT NOT NULL DEFAULT 0, notes TEXT,
    items_json TEXT, status VARCHAR(20) NOT NULL DEFAULT 'New',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  // Columns added after the first release, so databases created before then get them too.
  for (const col of ["quoted_amount DECIMAL(12,2) NULL", "admin_notes TEXT"]) {
    await pool.query(`ALTER TABLE bookings ADD COLUMN ${col}`).catch(err => { if (err.code !== "ER_DUP_FIELDNAME") throw err; });
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS portfolio (
    id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255) NOT NULL, category VARCHAR(100) NOT NULL,
    description TEXT, image_path VARCHAR(255) NOT NULL, featured TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const adminEmail = (process.env.ADMIN_EMAIL || "admin@dreamsounds.ph").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "ChangeThisBeforeGoingLive123!";
  if (!(await q("SELECT id FROM users WHERE email = ?", [adminEmail])).length) {
    await q("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')",
      ["DreamSounds Administrator", adminEmail, bcrypt.hashSync(adminPassword, 12)]);
  }

  const starterEquipment = [
   ["Professional Audio System","Audio","Professional sound reinforcement packages for live events.",1,0],
   ["Professional Lighting System","Lighting","Stage and event lighting packages.",1,0],
   ["LED Wall","LED Walls","Modular LED display solutions for events.",1,0],
   ["Stage and Roofing","Stage & Roofing","Stage platforms and event roofing solutions.",1,0],
   ["Band Equipment","Band Equipment","Backline and band equipment rentals.",1,0],
   ["Generator Set 100kVA","Generators","100kVA generator set.",1,0],
   ["Generator Set 200kVA","Generators","200kVA generator set.",1,0],
   ["Pyrotechnics","Special Effects","Event pyrotechnics, subject to venue and safety approvals.",1,0],
   ["DJ Services","Entertainment","Professional DJ services for events.",1,0],
   ["MC and Hosting Services","Entertainment","Professional hosting and event emceeing.",1,0]
  ];
  if ((await q("SELECT COUNT(*) AS n FROM equipment"))[0].n === 0) {
    // Bulk "VALUES ?" needs query(), not execute(); one statement, so it is atomic.
    await pool.query("INSERT INTO equipment (name,category,description,quantity,daily_rate) VALUES ?", [starterEquipment]);
  }
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: "draft-7", legacyHeaders: false });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,9)}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 12 },
  fileFilter: (_req, file, cb) => {
    if (!["image/jpeg","image/png","image/webp","image/gif"].includes(file.mimetype)) return cb(new Error("Only JPG, PNG, WEBP and GIF images are allowed."));
    cb(null, true);
  }
});

function tokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}
function requireAuth(req, res, next) {
  const raw = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  try {
    if (!raw) throw new Error("missing");
    req.user = jwt.verify(raw, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: "Please sign in to continue." }); }
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
  next();
}
const clean = v => String(v ?? "").trim();
const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const reference = id => `DS-${String(id).padStart(5,"0")}`;

// Each request emails the team and sends the client a confirmation. Off unless SMTP_HOST and BUSINESS_EMAIL are set.
const smtpPort = Number(process.env.SMTP_PORT) || 587;
const mailer = process.env.SMTP_HOST && process.env.BUSINESS_EMAIL ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: smtpPort, secure: smtpPort === 465,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
}) : null;
// Not awaited: a mail failure must never fail the customer's request.
function sendMail(to, replyTo, subject, text) {
  if (!mailer) return;
  mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, replyTo, subject, text })
    .catch(err => console.error("Email notification failed:", err.message));
}

app.get("/api/health", (_req,res) => res.json({ ok: true, service: "DreamSounds website" }));

// Staff only: there is no registration, and accounts are created by the startup seed.
app.post("/api/auth/login", authLimiter, h(async (req,res) => {
  const email=clean(req.body.email).toLowerCase(), password=String(req.body.password||"");
  const [user]=await q("SELECT * FROM users WHERE email=? AND role='admin'",[email]);
  if (!user || !bcrypt.compareSync(password,user.password_hash)) return res.status(401).json({error:"Incorrect email or password."});
  res.json({token:tokenFor(user),user:{id:user.id,name:user.name,email:user.email,phone:user.phone,role:user.role}});
}));
app.get("/api/auth/me", requireAuth, h(async (req,res) => {
  const [u]=await q("SELECT id,name,email,phone,role FROM users WHERE id=?",[req.user.id]);
  if (!u) return res.status(404).json({error:"Account not found."});
  res.json({user:u});
}));

app.get("/api/equipment", h(async (_req,res) => res.json(await q("SELECT id,name,category,description,quantity,daily_rate FROM equipment WHERE active=1 ORDER BY category,name"))));
// The form is public and emails whatever address is typed in, so cap how fast one visitor can submit.
const bookingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many requests from this device. Please try again in a few minutes." } });
app.post("/api/bookings", bookingLimiter, h(async (req,res) => {
  const b=req.body||{};
  const required=["customer_name","email","phone","event_name","event_date","venue"];
  if (required.some(k=>!clean(b[k])) || !validEmail(clean(b.email))) return res.status(400).json({error:"Please complete all required fields with a valid email."});
  const items=Array.isArray(b.items) ? b.items.slice(0,30).map(x=>({id:Number(x.id),name:clean(x.name)})) : [];
  const result=await q(`INSERT INTO bookings (customer_name,email,phone,event_name,event_date,event_time,venue,guest_count,notes,items_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,[clean(b.customer_name),clean(b.email),clean(b.phone),clean(b.event_name),clean(b.event_date),clean(b.event_time),clean(b.venue),Math.max(0,Number(b.guest_count)||0),clean(b.notes),JSON.stringify(items)]);
  const ref=reference(result.insertId);
  sendMail(process.env.BUSINESS_EMAIL, clean(b.email), `New quotation request ${ref}: ${clean(b.event_name)}`, [
    `Reference: ${ref}`, `Customer: ${clean(b.customer_name)}`, `Email: ${clean(b.email)}`, `Phone: ${clean(b.phone)}`,
    `Event: ${clean(b.event_name)}`, `Date: ${clean(b.event_date)} ${clean(b.event_time)}`, `Venue: ${clean(b.venue)}`,
    `Guests: ${Math.max(0,Number(b.guest_count)||0)}`, `Requested: ${items.map(x=>x.name).join(", ")||"Not specified"}`, "", clean(b.notes)
  ].join("\n"));
  // Deliberately contains nothing the visitor typed: the address is unverified, so the form
  // must not be usable to send someone else a message of the sender's choosing.
  sendMail(clean(b.email), process.env.BUSINESS_EMAIL, `We received your quotation request ${ref}`, [
    "Hello,", "", "Thank you for contacting DreamSounds Audio and Lighting Rentals. We have received your quotation request.", "",
    `Reference number: ${ref}`, "",
    "Our team will review your event details and get back to you. To add anything, just reply to this email and mention your reference number.", "",
    "If you did not send this request, you can ignore this email.", "",
    "DreamSounds Audio and Lighting Rentals", "The Sound of Quality. The Light of Excellence."
  ].join("\n"));
  res.status(201).json({message:"Your quotation request has been received. Our team will review your event details.",reference:ref});
}));

app.get("/api/portfolio", h(async (_req,res) => res.json(await q("SELECT id,title,category,description,image_path,featured,created_at FROM portfolio ORDER BY featured DESC,id DESC"))));

app.get("/api/admin/overview", requireAuth, requireAdmin, h(async (_req,res) => {
  const count=async (table,where="")=>(await q(`SELECT COUNT(*) AS n FROM ${table} ${where}`))[0].n;
  res.json({
    inquiries:await count("bookings"),
    newInquiries:await count("bookings","WHERE status='New'"),
    portfolio:await count("portfolio")
  });
}));
app.get("/api/admin/bookings", requireAuth, requireAdmin, h(async (_req,res) => {
  res.json((await q("SELECT * FROM bookings ORDER BY id DESC")).map(b=>({...b,items:JSON.parse(b.items_json||"[]")})));
}));
app.patch("/api/admin/bookings/:id", requireAuth, requireAdmin, h(async (req,res) => {
  const allowed=["New","Reviewing","Quoted","Confirmed","Completed","Cancelled"];
  const {status,quoted_amount,admin_notes}=req.body||{};
  const sets=[], vals=[];
  if (status!==undefined) {
    if (!allowed.includes(status)) return res.status(400).json({error:"Invalid booking status."});
    sets.push("status=?"); vals.push(status);
  }
  if (quoted_amount!==undefined) {
    const amount=quoted_amount===null||quoted_amount==="" ? null : Number(quoted_amount);
    if (amount!==null && !(amount>=0)) return res.status(400).json({error:"Quoted amount must be a positive number."});
    sets.push("quoted_amount=?"); vals.push(amount);
  }
  if (admin_notes!==undefined) { sets.push("admin_notes=?"); vals.push(clean(admin_notes)); }
  if (!sets.length) return res.status(400).json({error:"Nothing to update."});
  // mysql2 reports matched rows as affectedRows, so re-saving the same values is not a 404.
  const result=await q(`UPDATE bookings SET ${sets.join(",")} WHERE id=?`,[...vals,req.params.id]);
  if (!result.affectedRows) return res.status(404).json({error:"Booking not found."});
  res.json({ok:true});
}));
app.post("/api/admin/portfolio", requireAuth, requireAdmin, upload.array("images",12), h(async (req,res) => {
  const title=clean(req.body.title), category=clean(req.body.category), description=clean(req.body.description);
  if (!title || !category || !req.files?.length) return res.status(400).json({error:"Add a title, category, and at least one image."});
  const featured=req.body.featured==="true"?1:0;
  await pool.query("INSERT INTO portfolio (title,category,description,image_path,featured) VALUES ?",
    [req.files.map(f=>[title,category,description,`/uploads/${f.filename}`,featured])]);
  res.status(201).json({message:`${req.files.length} image(s) added to the portfolio.`});
}));
app.delete("/api/admin/portfolio/:id", requireAuth, requireAdmin, h(async (req,res) => {
  const [row]=await q("SELECT image_path FROM portfolio WHERE id=?",[req.params.id]);
  if (!row) return res.status(404).json({error:"Image not found."});
  await q("DELETE FROM portfolio WHERE id=?",[req.params.id]);
  const file=path.join(__dirname,row.image_path.replace(/^\//,""));
  if (file.startsWith(UPLOAD_DIR) && fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ok:true});
}));

app.use((err,_req,res,_next)=>{
  console.error(err);
  res.status(400).json({error:err.message || "Something went wrong."});
});
app.get("*", (_req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

initDb()
  .then(()=>app.listen(PORT,()=>console.log(`DreamSounds website running at http://localhost:${PORT}`)))
  .catch(err=>{
    console.error(`Could not connect to MySQL at ${dbConfig.host}:${dbConfig.port} as ${dbConfig.user}. Is the server running, and are the DB_* values in .env correct?`);
    console.error(err.code || err.message);
    process.exit(1);
  });
