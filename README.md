# PDF Merger & Signer - Full Stack Application

A secure, high-performance web application to merge multiple PDFs into a single document and digitally sign PDFs with drawings or uploaded images. 

## Architecture

This application is built as a polyglot microservices monorepo:

- **Frontend (`/client`)**: Built with Vanilla JS and Vite. Handles the user interface, drag-and-drop uploads, signature canvas, IndexedDB session persistence, and API communication. Contains no business logic or PDF manipulation code, keeping the client lightweight and secure.
- **Merge API (`/server`)**: A Node.js and Express server. Handles file uploads via `multer` (in memory) and uses `pdf-lib` to execute the PDF merging process entirely on the server.
- **Signature API (`/python-api`)**: A Python-based Flask microservice. Specialized for PDF overlays and image transparency processing using `pypdf`, `reportlab`, and `Pillow`. Handles drawn and uploaded signatures seamlessly.

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm
- Python (3.9 or higher)
- pip

### Installation

1. Install Node.js dependencies for the root workspace, frontend, and Node backend:
   ```bash
   npm run install-all
   ```

2. Install Python dependencies for the Signature API:
   ```bash
   cd python-api
   pip install -r requirements.txt
   ```

3. Environment Variables setup:
   - **Node API (`/server`)**: Copy `.env.example` to `.env` (defaults are fine).
   - **Python API (`/python-api`)**: By default, listens on port `5001`. You can set a `PORT` variable.
   - **Frontend (`/client`)**: Copy `.env.example` to `.env`. Ensure you set both `VITE_API_URL` (Node) and `VITE_PYTHON_API_URL` (Python) if your backends run on different URLs/ports.

### Development

### Development

1. Start both the Node backend and frontend development servers concurrently:
   ```bash
   npm run dev
   ```

2. In a separate terminal, start the Python API:
   ```bash
   cd python-api
   python app.py
   ```

- Frontend runs at: `http://localhost:5173`
- Node Merge API runs at: `http://localhost:5000/api`
- Python Sign API runs at: `http://localhost:5001/api`

## Deployment

### Merge Backend (Node.js)
1. Create a new Node.js service pointing to the `/server` directory.
2. Set the `PORT` environment variable (e.g. 5000).
3. Set the `CLIENT_URL` environment variable to the deployed frontend URL (for CORS).

### Signature Backend (Python - Railway/Render)
1. Create a new Python service pointing to the `/python-api` directory.
2. Ensure the build uses `requirements.txt`.
3. The server uses `gunicorn` or standard flask via `python app.py`. It dynamically binds to the `PORT` environment variable.

### Frontend (Vercel, Netlify, Cloudflare Pages)
1. Create a new static deployment pointing to the `/client` directory.
2. Build command: `npm run build`
3. Output directory: `dist`
4. Set the Environment Variables to point to your live deployed backends:
   - `VITE_API_URL`: e.g. `https://your-node-backend.com/api`
   - `VITE_PYTHON_API_URL`: e.g. `https://your-python-backend.com/api`

## Security Note

All API keys and business logic are securely isolated in the backend. Sensitive credentials should never be committed to the repository and should only live in the backend's `.env` configuration.
