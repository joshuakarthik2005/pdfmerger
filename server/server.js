require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Configure CORS
app.use(cors({
  origin: CLIENT_URL,
  methods: ['POST'],
}));

app.use(express.json());

// Configure Multer for file uploads in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed.'), false);
    }
  }
});

app.post('/api/merge', upload.array('files'), async (req, res) => {
  try {
    const files = req.files;

    if (!files || files.length < 2) {
      return res.status(400).json({ error: 'Please upload at least 2 PDF files to merge.' });
    }

    const mergedPdf = await PDFDocument.create();
    
    // Order of files array from multer matches the order of upload
    for (const file of files) {
      try {
        const pdf = await PDFDocument.load(file.buffer, { ignoreEncryption: true });
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        copiedPages.forEach((page) => {
          mergedPdf.addPage(page);
        });
      } catch (err) {
        console.error(`Failed to process file ${file.originalname}:`, err);
        // Continue merging other files even if one is corrupt, or we could reject entirely
        // Based on previous frontend logic, it skipped corrupt files but we should probably 
        // return an error if it's completely invalid.
      }
    }

    const mergedPdfBytes = await mergedPdf.save();
    
    if (mergedPdfBytes.length === 0) {
      return res.status(500).json({ error: 'Failed to generate merged PDF.' });
    }

    const mergedBuffer = Buffer.from(mergedPdfBytes);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=merged_document.pdf');
    res.setHeader('Content-Length', mergedBuffer.length);
    
    return res.end(mergedBuffer);

  } catch (error) {
    console.error('Merge API Error:', error);
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File size exceeds the 50MB limit.' });
      }
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Internal server error during PDF merge.' });
  }
});

// Basic error handling middleware for multer fileFilter errors
app.use((err, req, res, next) => {
  if (err) {
    res.status(400).json({ error: err.message });
  } else {
    next();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Allowing CORS from: ${CLIENT_URL}`);
});
