const path   = require('path');
const multer = require('multer');

/* disk storage: uploads/<timestamp>_<random>.<ext> */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename   : (_req, file, cb) => {
    const unique = Date.now() + '_' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  }
});

/* accept any image or PDF (adjust if you want stricter checks) */
const fileFilter = (_req, file, cb) => {
  cb(null, /^(image\/|application\/pdf$)/.test(file.mimetype));
};

module.exports = multer({ storage, fileFilter });
